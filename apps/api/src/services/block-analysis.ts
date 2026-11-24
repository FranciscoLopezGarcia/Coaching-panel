import {
  ANALYSIS_VERSION,
  compareAdjacentBlocks,
  evaluateAthlete,
  knownAt,
  latestFrom,
  LIFTS,
  orderedBlocks,
  type ActualSet,
  type ChangeEvent,
  type Lift,
  type PlannedSet,
  type SessionFeedback,
  type MetricSource,
  type RuleResult,
} from '@coaching/engine';
import type {
  BlockAnalysisResult,
  ExpressionSignal,
  PlanChangeMark,
  SessionFatiguePoint,
  SignalSide,
} from '@coaching/contracts';
import type { HistoryRepo } from '../repositories/history.js';
import type { DataLoader } from './data.js';

function side(r: RuleResult | undefined): SignalSide {
  if (!r)
    return {
      state: 'sin_benchmarks',
      nativeStatus: 'sin_resultado',
      evidence: [],
      missing: [],
      dataUntil: null,
    };
  const fav = r.status === 'ventana_expresion';
  const state: SignalSide['state'] = fav
    ? 'favorable'
    : r.missing.length || r.status === 'datos_insuficientes'
      ? 'indeterminado_por_faltantes'
      : 'no_favorable';
  return {
    state,
    nativeStatus: r.status,
    evidence: r.evidence,
    missing: r.missing,
    dataUntil: r.dataUntil || null,
  };
}

function planChanges(events: ChangeEvent[], from: string, asOf: string): PlanChangeMark[] {
  return events
    .filter(
      (e) =>
        e.status === 'aplicado' && e.effectiveOn !== null && e.effectiveOn >= from && e.effectiveOn <= asOf,
    )
    .map((e) => ({
      id: e.id,
      date: e.effectiveOn as string,
      classes: [...new Set(e.changes.map((c) => c.classification))],
      estimated: e.effectiveEstimated,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
}

function sessionFatigue(
  planned: PlannedSet[],
  actual: ActualSet[],
  feedback: SessionFeedback[],
  from: string,
  asOf: string,
): SessionFatiguePoint[] {
  const first = new Map<string, PlannedSet>();
  for (const s of planned) if (!first.has(s.sessionKey)) first.set(s.sessionKey, s);
  const doneOn = new Map<string, string>();
  const bySet = new Map(planned.map((s) => [s.id, s.sessionKey]));
  for (const a of actual) {
    const sk = bySet.get(a.plannedSetId);
    if (!sk || a.status !== 'done' || !a.performedOn) continue;
    if ((doneOn.get(sk) ?? '') < a.performedOn) doneOn.set(sk, a.performedOn);
  }
  return feedback
    .flatMap((f) => {
      const p = first.get(f.sessionKey);
      const date = doneOn.get(f.sessionKey) ?? p?.plannedDate;
      if (!p || !date || f.endFatigue === null || date < from || date > asOf) return [];
      return [{ sessionKey: f.sessionKey, date, blockKey: p.blockKey, value: f.endFatigue }];
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sessionKey < b.sessionKey ? -1 : 1));
}

/**
 * Analizador integral de bloques: ventana móvil (actual + 3 previos), deltas vecinos, e1RM por variante y contraste A/B.
 * SOLO LECTURA: no persiste nada ni toca la programación. Todo se calcula con lo conocido al corte (`asOf`).
 */
export class BlockAnalysisService {
  constructor(
    private loader: DataLoader,
    private history: HistoryRepo,
  ) {}

  async build(
    athleteId: string,
    o: { asOf: string; block?: string; source: MetricSource; lift: Lift | 'ALL' },
  ): Promise<BlockAnalysisResult | null> {
    const d = await this.loader.load(athleteId, o.asOf);
    const k = knownAt(
      {
        plannedSets: d.planned,
        actualSets: d.actual,
        snapshots: await this.history.listVersions(athleteId),
        sessionFeedback: d.feedback,
        coachReviews: d.reviews,
        changeEvents: d.events,
      },
      o.asOf,
    );
    const blocks = orderedBlocks(k.plannedSets, o.asOf);
    if (!blocks.length) return null;
    // Por defecto: el bloque en curso al corte; si no hay, el último que ya empezó; si ninguno, el primero.
    const started = blocks.filter((b) => b.start <= o.asOf);
    const current =
      o.block ??
      (blocks.find((b) => b.start <= o.asOf && b.end >= o.asOf) ?? started.at(-1) ?? blocks[0])?.blockKey;
    if (!current) return null;
    const cmp = compareAdjacentBlocks({
      planned: k.plannedSets,
      actual: k.actualSets,
      currentBlockKey: current,
      asOf: o.asOf,
      source: o.source,
      lift: o.lift,
      zoneCuts: d.athlete.params.intensityCuts,
    });
    if (!cmp) return null;
    return {
      ...cmp,
      athleteId,
      asOf: o.asOf,
      availableBlocks: blocks.map((b) => ({ blockKey: b.blockKey, start: b.start, end: b.end })),
      expression: this.expression(d, k, o.asOf, o.lift),
      planChanges: planChanges(k.changeEvents, cmp.window.blocks[0]?.start ?? '', o.asOf),
      sessionFatigue: sessionFatigue(
        k.plannedSets,
        k.actualSets,
        k.sessionFeedback,
        cmp.window.blocks[0]?.start ?? '',
        o.asOf,
      ),
      thresholds: {
        fatigue: d.params.fatigueThreshold,
        compliance: d.params.minCompliance,
        pain: d.params.painBlock,
        rpeTolerance: d.params.rpeTolerance,
      },
      generatedFrom: { planRevisionCutoff: o.asOf, analysisVersion: ANALYSIS_VERSION },
    };
  }

  private expression(
    d: Awaited<ReturnType<DataLoader['load']>>,
    k: ReturnType<typeof knownAt>,
    asOf: string,
    lift: Lift | 'ALL',
  ): ExpressionSignal[] {
    try {
      const ev = evaluateAthlete({
        cutoff: asOf,
        params: d.params,
        plannedSets: k.plannedSets,
        actualSets: k.actualSets,
        readiness: latestFrom(d.readinessHistory, asOf),
        readinessHistory: d.readinessHistory.filter((r) => r.date <= asOf),
        sessionFeedback: k.sessionFeedback,
        coachReviews: k.coachReviews,
        families: d.families,
        changeEvents: k.changeEvents,
        competitionExercises: d.competitionExercises,
      });
      return LIFTS.filter((l) => lift === 'ALL' || l === lift).flatMap((l) => {
        const res = ev.lifts[l]?.results ?? [];
        const a = res.find((r) => r.ruleId === 'R-EXPRESSION-A');
        const b = res.find((r) => r.ruleId === 'R-EXPRESSION-B');
        if (!a && !b) return [];
        const sa = side(a);
        const sb = side(b);
        const agreement: ExpressionSignal['agreement'] =
          sa.state === 'indeterminado_por_faltantes' || sb.state === 'indeterminado_por_faltantes'
            ? 'no_comparable'
            : sa.state === sb.state
              ? 'coinciden'
              : 'difieren';
        return [{ lift: l, principal: 'B' as const, a: sa, b: sb, agreement }];
      });
    } catch {
      return []; // la señal es complementaria: un fallo del motor de reglas no debe tumbar el análisis de bloques
    }
  }
}
