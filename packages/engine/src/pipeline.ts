import { summarizeBlocks, summarizeFamilies, type BlockSummary, type FamilyMeta } from './blocks.js';
import { daysBetween } from './dates.js';
import type { ChangeEvent } from './diff.js';
import { assess, evidenceItemsFor, type CompatState, type EvidenceEnv } from './evidence-build.js';
import type { Comparability, EvidenceAssessment } from './evidence.js';
import { buildExplanation } from './explain.js';
import { buildExposures, emptyQuality, nextPlanned } from './exposures.js';
import { f } from './format.js';
import { observedFromPlan } from './observed.js';
import { PARAMS_VERSION, RULES_VERSION, paramsText, missingConfig, type EngineParams } from './params.js';
import { OFFENSIVE } from './priority.js';
import { ruleEnd } from './rules/end.js';
import { ruleExpressionA, ruleExpressionB } from './rules/expression.js';
import { frequencyPattern, ruleFrequency } from './rules/frequency.js';
import { ruleLoad } from './rules/load.js';
import { rulePR } from './rules/pr.js';
import { ruleProgress } from './rules/progress.js';
import { result } from './rules/result.js';
import { ruleVolume } from './rules/volume.js';
import type { RuleCtx } from './rules/ctx.js';
import { actionOf, resolvePrincipal, ruleKey, type DimensionState, type LiftState } from './state.js';
import type {
  ActualSet,
  AthleteEvaluation,
  CoachReview,
  Exposure,
  Lift,
  LiftEvaluation,
  PlannedSet,
  Readiness,
  RuleResult,
  SessionFeedback,
} from './types.js';

export interface LiftInput {
  lift: Lift;
  /** Ejercicio de competencia usado como benchmark (criterio fijado ANTES de ver los resultados). */
  exerciseName: string;
  plannedSets: PlannedSet[];
  actualSets: ActualSet[];
  /** Último check-in completo (para mostrar la vigencia). */
  readiness: Readiness | null;
  readinessHistory?: Readiness[];
  sessionFeedback?: SessionFeedback[];
  coachReviews?: CoachReview[];
  blocks?: BlockSummary[];
  /** Cambios de programación detectados: permiten advertir que el estímulo cambió dentro de una ventana. */
  changeEvents?: ChangeEvent[];
  /** Objetivo declarado del bloque vigente (familia). null/ausente = no disponible. */
  objective?: string | null;
  cutoff: string;
  params: EngineParams;
}

/** Molestia máxima (0–10) de series hechas del lift en los 7 días hasta el corte. null = sin registros (≠ 0). */
export function maxPain(
  planned: PlannedSet[],
  actual: Map<string, ActualSet>,
  lift: Lift,
  cutoff: string,
  days = 7,
): number | null {
  let mx: number | null = null;
  for (const s of planned) {
    if (s.lift !== lift) continue;
    const a = actual.get(s.id);
    if (!a || a.pain === null || !a.performedOn) continue;
    const d = daysBetween(cutoff, a.performedOn);
    if (d < 0 || d >= days) continue;
    if (mx === null || a.pain > mx) mx = a.pain;
  }
  return mx;
}

/** Datos semanales reales del lift más recientes (series y días con exposición), para proponer la redistribución. */
function lastWeekly(c: RuleCtx): { sets: number; freq: number } | null {
  const done = c.liftPlanned.filter(
    (s) =>
      !s.isWarmup &&
      c.actual.get(s.id)?.status === 'done' &&
      (c.actual.get(s.id)?.performedOn ?? '9') <= c.cutoff,
  );
  if (!done.length) return null;
  const last = done
    .map((s) => `${s.blockKey}|${s.weekNo}`)
    .sort()
    .pop() as string;
  const w = done.filter((s) => `${s.blockKey}|${s.weekNo}` === last);
  return { sets: w.length, freq: new Set(w.map((s) => s.sessionKey)).size };
}

/**
 * Segmenta las exposiciones de UNA identidad por variante/protocolo. Compartir identidad NO implica comparabilidad:
 * un cambio de variante corta la serie y solo el último segmento contiguo es comparable entre sí.
 */
export function comparableTail(all: Exposure[]): {
  current: Exposure[];
  breaks: { at: string; from: string; to: string }[];
} {
  const breaks: { at: string; from: string; to: string }[] = [];
  let start = 0;
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1] as Exposure;
    const b = all[i] as Exposure;
    if (a.variantKey !== b.variantKey) {
      breaks.push({ at: b.date, from: a.variantKey, to: b.variantKey });
      start = i;
    }
  }
  return { current: all.slice(start), breaks };
}

/**
 * Pipeline por lift: calidad → métricas → reglas → conflictos → conclusión → evidencia y evaluación → explicación.
 * Determinista y sin fuga del futuro: mismos inputs + mismo corte + misma versión ⇒ misma salida. No escribe nada ni cambia la programación.
 */
export function evaluateLift(input: LiftInput): LiftEvaluation {
  const { lift, params: p, cutoff } = input;
  const cfg = p.perLift[lift];
  const quality = emptyQuality();
  const actual = new Map(input.actualSets.map((a) => [a.plannedSetId, a]));
  const liftPlanned = input.plannedSets.filter((s) => s.lift === lift);
  const bench = liftPlanned.filter((s) => s.exerciseName === input.exerciseName);

  const r = input.readiness;
  const readiness = !r
    ? 'sin check-in reciente'
    : `${daysBetween(cutoff, r.date) >= 0 && daysBetween(cutoff, r.date) <= p.readinessValidityDays ? 'vigente' : 'vencido'} (${r.date}, disposición ${f(r.value, 1)}/10)`;

  const stimulusChanges = (input.changeEvents ?? [])
    .filter((e) => e.status === 'aplicado' && e.effectiveOn)
    .flatMap((e) =>
      e.changes
        .filter(
          (ch) =>
            ch.lift === lift &&
            !['bloque_nuevo', 'bloque_retirado', 'sin_cambios'].includes(ch.classification),
        )
        .map((ch) => ({ id: e.id, effectiveOn: e.effectiveOn as string, classification: ch.classification })),
    );

  const c: RuleCtx = {
    lift,
    cfg,
    p,
    cutoff,
    actual,
    bench,
    liftPlanned,
    allPlanned: input.plannedSets,
    allActual: input.actualSets,
    readinessHistory: input.readinessHistory ?? (r ? [r] : []),
    reviews: input.coachReviews ?? [],
    feedback: new Map((input.sessionFeedback ?? []).map((x) => [x.sessionKey, x.endFatigue])),
    blocks: (input.blocks ?? []).filter((b) => b.lift === lift),
    observed: observedFromPlan(input.plannedSets, input.actualSets, cutoff).filter((o) => o.lift === lift),
    objective: input.objective ?? null,
    stimulusChanges,
  };

  const results: RuleResult[] = [];
  const pain = maxPain(input.plannedSets, actual, lift, cutoff);
  const painBlock = pain !== null && pain >= p.painBlock;
  const lastReview = c.reviews
    .filter((x) => x.lift === lift && x.date <= cutoff)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const techBlock =
    !!lastReview && lastReview.verdict === 'no_comparable' && daysBetween(cutoff, lastReview.date) <= 28;
  const blocked = painBlock || techBlock;
  const comparability = new Map<string, CompatState>();
  const bySession = new Map<string, Exposure>();

  if (!bench.length) {
    results.push(
      result({
        ruleId: 'R-PROGRESS',
        exposureId: '',
        status: 'datos_insuficientes',
        summary: `No hay series planificadas del ejercicio de competencia “${input.exerciseName}”.`,
        missing: [`Ejercicio de competencia de ${lift} presente en el plan.`],
      }),
    );
  } else {
    const exps = buildExposures(bench, actual, cutoff, quality);
    for (const e of exps) bySession.set(e.sessionKey, e);
    if (painBlock) {
      results.push(
        result({
          ruleId: 'B-DOLOR',
          exposureId: '',
          status: 'revision_coach',
          sufficiency: 'suficiente',
          dataUntil: cutoff,
          summary: `Molestia relevante registrada (máx. ${pain}/10 en los últimos 7 días): revisión del coach antes de cualquier progresión.`,
          evidence: [`Molestia máxima de ${lift} en 7 días: ${pain}/10 (umbral de revisión ${p.painBlock})`],
          alternatives: [
            'R-LOAD, R-PR, ventana de expresión y los ensayos de volumen/frecuencia quedan suspendidos mientras dure la molestia.',
          ],
          proposal: 'Revisión del coach. No es un diagnóstico ni un tratamiento.',
          reviewWhen: 'Con el próximo registro de molestia.',
          facts: [
            {
              key: 'pain_max',
              label: 'Molestia máxima en 7 días',
              value: pain,
              unit: '0–10',
              source: 'metrica',
            },
            {
              key: 'pain_threshold',
              label: 'Umbral de revisión',
              value: p.painBlock,
              source: 'parametro',
              sourceId: 'painBlock',
            },
          ],
        }),
      );
    }
    if (techBlock && lastReview) {
      results.push(
        result({
          ruleId: 'B-TECNICA',
          exposureId: '',
          status: 'revision_coach',
          sufficiency: 'suficiente',
          dataUntil: lastReview.date,
          summary:
            'El coach marcó la técnica como no comparable: las comparaciones y las propuestas ofensivas quedan suspendidas hasta una nueva revisión.',
          evidence: [
            `Revisión técnica del ${lastReview.date}: no comparable${lastReview.note ? ` — ${lastReview.note}` : ''}`,
          ],
          proposal: 'Revisión del coach (el material técnico se consulta fuera de la app).',
          reviewWhen: 'Con una nueva revisión técnica.',
        }),
      );
    }
    const compAll = exps.filter((e) => e.e !== null);
    const byId = new Map<string, Exposure[]>();
    for (const e of exps) byId.set(e.exposureId, [...(byId.get(e.exposureId) ?? []), e]);
    for (const id of [...new Set(bench.map((s) => s.exposureId))].sort()) {
      const everyone = byId.get(id) ?? [];
      const { current: all, breaks } = comparableTail(everyone);
      const comp = all.filter((e) => e.e !== null);
      const reasons: string[] = [];
      let state: Comparability = everyone.length ? 'comparable' : 'desconocida';
      if (breaks.length) {
        state = 'parcial';
        reasons.push(
          `Cambió la variante/protocolo dentro de la misma exposición (${breaks.map((b) => `${b.from} → ${b.to} el ${b.at}`).join('; ')}): solo se comparan las exposiciones posteriores al último cambio.`,
        );
      }
      const inWin = stimulusChanges.filter(
        (x) => everyone.length && x.effectiveOn >= (all[0]?.date ?? '9') && x.effectiveOn <= cutoff,
      );
      if (inWin.length) {
        state = state === 'comparable' ? 'parcial' : state;
        reasons.push(
          `Cambió el estímulo del plan dentro del período analizado (${inWin.map((x) => `${x.classification.replace(/_/g, ' ')} el ${x.effectiveOn}`).join('; ')}).`,
        );
      }
      comparability.set(id, { state, reasons });
      if (!all.length) {
        results.push(
          result({
            ruleId: 'R-PROGRESS',
            exposureId: id,
            status: 'datos_insuficientes',
            summary: `Sin exposiciones registradas en esta exposición hasta ${cutoff}.`,
            missing: ['Series hechas con kg, reps, RPE y fecha real.'],
          }),
        );
        continue;
      }
      results.push(ruleProgress(comp, cfg, p, cutoff, id));
      const end = ruleEnd(comp, cfg, p, cutoff, id, c);
      if (end) results.push(end);
      if (blocked) continue;
      const next = nextPlanned(bench, actual, cutoff, id);
      const load = ruleLoad(comp, all, cfg, p, cutoff, id, next, actual, lift);
      if (load) results.push(load);
      const pr = rulePR(comp, id, next, c);
      if (pr) results.push(pr);
      const endFall = end?.tag === 'caida';
      const fp = frequencyPattern(all, c);
      results.push(ruleExpressionB(comp, endFall || fp.pattern, id, c));
      const vol = ruleVolume(comp, endFall, fp.pattern, id, c);
      if (vol) results.push(vol);
      const freq = ruleFrequency(all, id, c, lastWeekly(c));
      if (freq) results.push(freq);
    }
    if (!blocked) {
      const exprA = ruleExpressionA(compAll, c);
      results.push(exprA);
      // A y B pueden discrepar: se muestra, no se esconde
      const Bs = results.filter((x) => x.ruleId === 'R-EXPRESSION-B');
      const fired = (x: RuleResult) => x.status === 'ventana_expresion';
      if (Bs.some(fired) !== fired(exprA)) {
        const note = fired(exprA)
          ? 'El modo B (motor propio) no confirma la ventana: ver sus condiciones.'
          : 'El modo A (reglas de PRG reconstruidas) no confirma la ventana: ver sus condiciones.';
        for (const x of [exprA, ...Bs].filter(fired))
          x.alternatives.push(`Discrepancia entre modos: ${note}`);
      }
    }
  }

  // --- evidencia, evaluación y conclusión principal
  const rd =
    (input.readinessHistory ?? (r ? [r] : []))
      .filter((x) => x.date <= cutoff)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
  const env: EvidenceEnv = {
    lift,
    cutoff,
    params: p,
    bySession,
    latestReadiness: rd,
    reviews: c.reviews,
    feedback: input.sessionFeedback ?? [],
    comparability,
    pain: {
      max: pain,
      refs: liftPlanned
        .filter((s) => {
          const a = actual.get(s.id);
          return (
            !!a &&
            a.pain !== null &&
            !!a.performedOn &&
            daysBetween(cutoff, a.performedOn) >= 0 &&
            daysBetween(cutoff, a.performedOn) < 7
          );
        })
        .map((s) => ({ kind: 'set' as const, id: s.id, date: actual.get(s.id)?.performedOn ?? undefined })),
    },
  };
  for (const x of results) {
    x.dataUntil ||= '';
    x.evidenceItems = evidenceItemsFor(x, env);
    x.assessment = assess(x, env);
  }
  const resolution = resolvePrincipal(results);
  const principal = resolution.principal;
  for (const x of results) x.isPrincipal = x === principal;
  const secondary = results.filter((x) => x !== principal);
  if (principal) {
    for (const d of resolution.deferred)
      principal.alternatives.push(`Acción diferida (${d.key}): ${d.reason}`);
    const offensive = secondary.filter(
      (x) => OFFENSIVE.includes(x.status) && !resolution.deferred.some((d) => d.key === ruleKey(x)),
    );
    for (const x of offensive)
      principal.alternatives.push(
        `${OFFENSIVE.includes(principal.status) ? 'Alternativa a revisar' : 'Señal secundaria'} (${x.ruleId}, ${x.exposureId || 'lift'}): ${x.proposal || x.summary}`,
      );
  }
  const deferredReasons = new Map(resolution.deferred.map((d) => [d.key, d.reason]));
  for (const x of results)
    x.explanation = buildExplanation(x, {
      lift,
      cutoff,
      params: p,
      objective: c.objective,
      others: results,
      deferredReasons,
    });
  const state = buildLiftState({
    lift,
    cutoff,
    results,
    resolution,
    principal,
    quality,
    readiness,
    blocked,
    pain,
    objective: c.objective,
    params: p,
    comparability,
  });
  return { lift, results, principal, secondary, quality, readiness, blocked, state };
}

/** Estado multidimensional: rendimiento, recuperación, respuesta, oportunidades y calidad de datos, SIN colapsarlas en un solo semáforo. */
function buildLiftState(a: {
  lift: Lift;
  cutoff: string;
  results: RuleResult[];
  resolution: ReturnType<typeof resolvePrincipal>;
  principal: RuleResult | null;
  quality: LiftEvaluation['quality'];
  readiness: string;
  blocked: boolean;
  pain: number | null;
  objective: string | null;
  params: EngineParams;
  comparability: Map<string, CompatState>;
}): LiftState {
  const { results } = a;
  const progress = results.filter((x) => x.ruleId === 'R-PROGRESS' && x.trend);
  const trend = progress.some((x) => x.trend === 'baja')
    ? 'baja'
    : progress.some((x) => x.trend === 'mejora')
      ? 'mejora'
      : progress.some((x) => x.trend === 'estable')
        ? 'estable'
        : null;
  const miss = missingConfig(a.params, [a.lift]);
  const assessOf = (x: RuleResult | undefined): EvidenceAssessment | null => x?.assessment ?? null;
  const perf: DimensionState = {
    id: 'rendimiento',
    status: trend ?? (miss.length ? 'sin_clasificar' : 'sin_datos'),
    summary: trend
      ? `Rendimiento (e1RM por curva): ${trend}.`
      : miss.length
        ? 'Hay datos, pero falta el cambio mínimo relevante: no se clasifica la tendencia.'
        : 'No hay datos suficientes para describir la tendencia.',
    signals: progress.map(ruleKey),
    assessment: assessOf(progress[0]),
  };
  const fat = results.find((x) => x.ruleId === 'R-FREQUENCY');
  const recStatus = a.blocked
    ? 'revisar'
    : fat?.status === 'candidato_frecuencia'
      ? 'revisar'
      : a.readiness.startsWith('vigente')
        ? 'sin_alertas'
        : a.readiness.startsWith('vencido')
          ? 'dato_desactualizado'
          : 'sin_datos';
  const recovery: DimensionState = {
    id: 'recuperacion',
    status: recStatus,
    summary: `Recuperación reportada: ${a.readiness}.${a.pain !== null ? ` Molestia máxima en 7 días: ${a.pain}/10.` : ''}${fat?.status === 'candidato_frecuencia' ? ' Hay deterioro dentro de la sesión con fatiga reportada.' : ''}`,
    signals: [
      ...results.filter((x) => ['B-DOLOR', 'B-TECNICA', 'R-FREQUENCY'].includes(x.ruleId)).map(ruleKey),
    ],
    assessment: assessOf(results.find((x) => x.ruleId === 'B-DOLOR')),
  };
  const end = results.find((x) => x.ruleId === 'R-END');
  const response: DimensionState = {
    id: 'respuesta',
    status:
      end?.status === 'posible_fin_respuesta'
        ? end.tag === 'caida'
          ? 'posible_agotamiento'
          : 'posible_meseta'
        : end?.status === 'estabilidad_observada'
          ? 'estabilidad_observada'
          : trend === 'mejora'
            ? 'respondiendo'
            : trend
              ? trend
              : 'sin_datos',
    summary: end
      ? end.summary
      : trend === 'mejora'
        ? 'El e1RM mejora: el estímulo parece estar produciendo respuesta (observación, no causalidad).'
        : 'Sin datos suficientes sobre la respuesta al estímulo.',
    signals: end ? [ruleKey(end)] : progress.map(ruleKey),
    assessment: assessOf(end ?? progress[0]),
  };
  const opp = results.filter((x) => OFFENSIVE.includes(x.status));
  const opportunities: DimensionState = {
    id: 'oportunidades',
    status: opp.length ? 'hay_oportunidades' : 'ninguna',
    summary: opp.length
      ? `Oportunidades a revisar: ${opp.map((x) => x.status.replace(/_/g, ' ')).join(', ')} (no son órdenes: ver conflictos).`
      : 'Sin oportunidades detectadas.',
    signals: opp.map(ruleKey),
    assessment: assessOf(opp[0]),
  };
  const q = a.quality;
  const noted = [
    q.setsWithoutRpe && `${q.setsWithoutRpe} serie(s) sin RPE real`,
    q.setsWithoutTargetRpe && `${q.setsWithoutTargetRpe} sin RPE objetivo`,
    q.doneWithoutDate && `${q.doneWithoutDate} sin fecha`,
    q.outsideTable && `${q.outsideTable} fuera de la tabla`,
    q.sessionsWithoutRecord && `${q.sessionsWithoutRecord} sesiones sin registro`,
  ].filter(Boolean) as string[];
  const cmpWorst = [...a.comparability.values()].some(
    (x) => x.state === 'parcial' || x.state === 'no_comparable',
  );
  const qualityState: DimensionState = {
    id: 'calidad_datos',
    status:
      miss.length || noted.length || cmpWorst
        ? 'parcial'
        : results.every((x) => x.status === 'datos_insuficientes')
          ? 'insuficiente'
          : 'completa',
    summary:
      `${noted.length ? `Limitaciones: ${noted.join('; ')}. ` : ''}${miss.length ? `Configuración faltante: ${miss.map((m) => m.label).join('; ')} (suspende: ${miss[0]?.suspends.slice(0, 3).join(', ')}…). ` : ''}${cmpWorst ? 'Hay cambios de variante o de estímulo que limitan la comparabilidad.' : ''}`.trim() ||
      'Datos completos para las reglas evaluadas.',
    signals: [],
    assessment: null,
  };
  const pr = a.principal;
  const compat: string[] = [];
  for (const x of results.filter((y) => y.status === 'ventana_expresion'))
    compat.push(`${ruleKey(x)} (ventana favorable) es compatible con la dimensión de rendimiento actual.`);
  return {
    lift: a.lift,
    cutoff: a.cutoff,
    objective: {
      value: a.objective,
      available: a.objective !== null,
      note: a.objective
        ? 'Objetivo declarado del bloque.'
        : 'Objetivo no disponible: limita la interpretación de la estabilidad y de las tendencias.',
    },
    dimensions: [perf, recovery, response, opportunities, qualityState],
    principal: pr
      ? {
          key: ruleKey(pr),
          status: pr.status,
          headline: pr.summary,
          action: actionOf(pr),
          actionText: pr.proposal || null,
          assessment: pr.assessment ?? null,
        }
      : null,
    conflicts: a.resolution.conflicts,
    deferred: a.resolution.deferred,
    sequence: a.resolution.sequence,
    compatibleSignals: compat,
  };
}

export interface AthleteInput {
  cutoff: string;
  params: EngineParams;
  plannedSets: PlannedSet[];
  actualSets: ActualSet[];
  readiness: Readiness | null;
  readinessHistory?: Readiness[];
  sessionFeedback?: SessionFeedback[];
  coachReviews?: CoachReview[];
  families?: Record<string, FamilyMeta>;
  changeEvents?: ChangeEvent[];
  /** Nombre del ejercicio de competencia por lift. */
  competitionExercises: Partial<Record<Lift, string>>;
}

export function evaluateAthlete(a: AthleteInput): AthleteEvaluation {
  const history = a.readinessHistory ?? (a.readiness ? [a.readiness] : []);
  const blocks = summarizeBlocks({
    planned: a.plannedSets,
    actual: a.actualSets,
    readiness: history,
    competitionExercises: a.competitionExercises,
    cutoff: a.cutoff,
    params: a.params,
    events: a.changeEvents,
  });
  const lifts: AthleteEvaluation['lifts'] = {};
  for (const l of Object.keys(a.competitionExercises) as Lift[]) {
    const latest = blocks.filter((b) => b.lift === l).sort((x, y) => (x.endDate < y.endDate ? 1 : -1))[0];
    const objective = latest ? (a.families?.[latest.familyKey]?.objective ?? null) : null;
    lifts[l] = evaluateLift({
      lift: l,
      exerciseName: a.competitionExercises[l] as string,
      plannedSets: a.plannedSets,
      actualSets: a.actualSets,
      readiness: a.readiness,
      readinessHistory: history,
      sessionFeedback: a.sessionFeedback,
      coachReviews: a.coachReviews,
      blocks,
      changeEvents: a.changeEvents,
      objective,
      cutoff: a.cutoff,
      params: a.params,
    });
  }
  return {
    cutoff: a.cutoff,
    rulesVersion: RULES_VERSION,
    paramsVersion: PARAMS_VERSION,
    lifts,
    blocks,
    families: summarizeFamilies(blocks, a.families, a.params),
  };
}

export { paramsText };
