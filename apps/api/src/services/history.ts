import {
  segmentKeyOf,
  blockMetrics,
  buildExposures,
  compareBlocks,
  emptyQuality,
  executionDeviations,
  followUps,
  summarizeBlocks,
  summarizeFamilies,
  toViews,
  type BlockMetrics,
  type BlockSummary,
  type Comparison,
  type Deviation,
  type Exposure,
  type FamilySummary,
  type Lift,
} from '@coaching/engine';
import type { CompareQuery, EventWithFollowUp, PlanVersionRow, SessionRow } from '@coaching/contracts';
import type { HistoryRepo } from '../repositories/history.js';
import type { AthleteData, DataLoader } from './data.js';

/** Lecturas derivadas para las pestañas del perfil. Solo lee; nunca escribe ni modifica la programación. */
export class HistoryService {
  constructor(
    private loader: DataLoader,
    private history: HistoryRepo,
  ) {}

  private inputs(d: AthleteData, cutoff: string) {
    return {
      planned: d.planned,
      actual: d.actual,
      readiness: d.readinessHistory,
      competitionExercises: d.competitionExercises,
      cutoff,
      params: d.params,
    };
  }

  async versions(athleteId: string): Promise<PlanVersionRow[]> {
    return (await this.history.listVersions(athleteId)).map((v) => ({
      id: v.id,
      seq: v.seq,
      status: v.status,
      detectedOn: v.detectedOn,
      effectiveOn: v.effectiveOn,
      label: v.label,
      sets: v.sets.length,
    }));
  }

  async events(
    athleteId: string,
    cutoff: string,
  ): Promise<{ events: EventWithFollowUp[]; deviations: Deviation[] }> {
    const d = await this.loader.load(athleteId);
    const events = await this.history.listEvents(athleteId);
    const inp = { ...this.inputs(d, cutoff), events };
    return {
      events: events.map((event) => ({ event, outcomes: followUps(event, inp) })).reverse(),
      deviations: executionDeviations(d.planned, d.actual, cutoff, d.params.minCompliance),
    };
  }

  async blocks(
    athleteId: string,
    cutoff: string,
  ): Promise<{ blocks: BlockSummary[]; families: FamilySummary[] }> {
    const d = await this.loader.load(athleteId);
    const blocks = summarizeBlocks({ ...this.inputs(d, cutoff), events: d.events });
    return { blocks, families: summarizeFamilies(blocks, d.families, d.params) };
  }

  async compare(athleteId: string, q: CompareQuery, cutoff: string): Promise<Comparison> {
    const d = await this.loader.load(athleteId);
    return compareBlocks(
      { ...this.inputs(d, cutoff), families: d.families },
      { lift: q.lift, blockKey: q.a },
      { lift: q.lift, blockKey: q.b },
      q.universe,
      q.scope,
    );
  }

  /** Carga por bloque y semana, PLANIFICADA y REALIZADA por separado. */
  async load(
    athleteId: string,
    cutoff: string,
  ): Promise<{ planned: BlockMetrics[]; actual: BlockMetrics[] }> {
    const d = await this.loader.load(athleteId);
    const out = { planned: [] as BlockMetrics[], actual: [] as BlockMetrics[] };
    for (const universe of ['planned', 'actual'] as const) {
      const views = toViews(d.planned, d.actual, universe, cutoff);
      const keys = new Set(views.map((v) => `${v.lift}|${v.blockKey}`));
      for (const k of [...keys].sort()) {
        const [lift, block] = k.split('|') as [Lift, string];
        const m = blockMetrics(views, lift, block);
        if (m) out[universe].push(m);
      }
    }
    return out;
  }

  /** E por exposición (benchmark = ejercicio de competencia) y récords REALES de kg por repeticiones, claramente separados del e1RM. */
  async performance(
    athleteId: string,
    cutoff: string,
  ): Promise<
    Partial<Record<Lift, { exposures: Exposure[]; records: { reps: number; kg: number; date: string }[] }>>
  > {
    const d = await this.loader.load(athleteId);
    const amap = new Map(d.actual.map((a) => [a.plannedSetId, a]));
    const out: Partial<
      Record<Lift, { exposures: Exposure[]; records: { reps: number; kg: number; date: string }[] }>
    > = {};
    for (const lift of Object.keys(d.competitionExercises) as Lift[]) {
      const bench = d.planned.filter(
        (s) => s.lift === lift && s.exerciseName === d.competitionExercises[lift] && !s.isWarmup,
      );
      const exposures = buildExposures(bench, amap, cutoff, emptyQuality()).map((e) => ({
        ...e,
        plannedSets: [],
      }));
      const best = new Map<number, { kg: number; date: string }>();
      for (const s of bench) {
        const a = amap.get(s.id);
        if (
          a?.status !== 'done' ||
          a.kg === null ||
          a.reps === null ||
          !a.performedOn ||
          a.performedOn > cutoff
        )
          continue;
        const cur = best.get(a.reps);
        if (!cur || a.kg > cur.kg) best.set(a.reps, { kg: a.kg, date: a.performedOn });
      }
      out[lift] = {
        exposures,
        records: [...best.entries()].sort((x, y) => x[0] - y[0]).map(([reps, v]) => ({ reps, ...v })),
      };
    }
    return out;
  }

  /** Sesiones completas: toda la prescripción (incluye aproximaciones) con ids estables, protocolo y ejecución vinculada por serie. */
  async sessions(athleteId: string): Promise<SessionRow[]> {
    const d = await this.loader.load(athleteId);
    const amap = new Map(d.actual.map((a) => [a.plannedSetId, a]));
    const fat = new Map(d.feedback.map((f) => [f.sessionKey, f.endFatigue]));
    const by = new Map<string, SessionRow>();
    for (const s of d.planned) {
      const row = by.get(s.sessionKey) ?? {
        sessionKey: s.sessionKey,
        date: s.plannedDate,
        lift: s.lift,
        exerciseName: s.exerciseName,
        blockKey: s.blockKey,
        weekNo: s.weekNo,
        dayNo: s.dayNo,
        endFatigue: fat.get(s.sessionKey) ?? null,
        exercises: [],
        segments: [],
        sets: [],
      };
      if (!row.exercises.some((e) => e.exposureId === s.exposureId))
        row.exercises.push({
          exposureId: s.exposureId,
          exerciseName: s.exerciseName,
          lift: s.lift,
          variantKey: s.variantKey,
          exposureRole: s.exposureRole,
          priority: s.priority,
        });
      const segmentKey = segmentKeyOf(s);
      const seg = row.segments.find((x) => x.segmentKey === segmentKey);
      if (seg) seg.setIds.push(s.id);
      else
        row.segments.push({
          segmentKey,
          exposureId: s.exposureId,
          segment: s.protocol?.segment ?? 'work',
          setIds: [s.id],
        });
      const a = amap.get(s.id);
      row.sets.push({
        plannedSetId: s.id,
        exposureId: s.exposureId,
        exerciseName: s.exerciseName,
        lift: s.lift,
        variantKey: s.variantKey,
        segmentKey,
        isWarmup: s.isWarmup,
        retired: d.retiredIds.has(s.id),
        priority: s.priority,
        refKg: s.refKg,
        copiedFrom: s.copiedFrom,
        plannedKgSource: s.plannedKgSource,
        protocol: s.protocol,
        setNo: s.setNo,
        planned: { reps: s.reps, targetRpe: s.targetRpe, kg: s.plannedKg },
        actual: a
          ? { status: a.status, kg: a.kg, reps: a.reps, rpe: a.rpe, pain: a.pain, performedOn: a.performedOn }
          : null,
      });
      by.set(s.sessionKey, row);
    }
    return [...by.values()]
      .map((r) => ({ ...r, sets: r.sets.sort((a, b) => a.setNo - b.setNo) }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }
}
