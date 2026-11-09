import { buildExposures, emptyQuality } from './exposures.js';
import { median } from './format.js';
import { evaluateAthlete } from './pipeline.js';
import { PARAMS_VERSION, RULES_VERSION, type EngineParams } from './params.js';
import type { PlanSnapshot } from './snapshot.js';
import type { ChangeEvent } from './diff.js';
import type {
  ActualSet,
  CoachReview,
  Exposure,
  Lift,
  PlannedSet,
  Readiness,
  SessionFeedback,
} from './types.js';
import type { FamilyMeta } from './blocks.js';

/**
 * REPLAY histórico: reevalúa al atleta en cada fecha de corte usando ÚNICAMENTE lo que se conocía en ese momento.
 *  - Ejecución: solo series con fecha ≤ corte. Check-ins, revisiones y cambios detectados: solo los ≤ corte.
 *  - Programación: la última versión APLICADA con `detectedOn` ≤ corte. Sin versiones, se asume el plan completo (y se declara: puede incluir
 *    programación que se escribió después, una limitación de la reconstrucción).
 *  - Lo posterior al corte se usa SOLO para describir lo observado después; nunca para decidir.
 * El resultado posterior es una OBSERVACIÓN, no una prueba de acierto ni de causalidad: no hay datos de lesión, no todas las recomendaciones se
 * aplicaron y un PR no intentado no es un falso positivo.
 */
export interface ReplayInput {
  plannedSets: PlannedSet[];
  actualSets: ActualSet[];
  snapshots?: PlanSnapshot[];
  readinessHistory: Readiness[];
  sessionFeedback?: SessionFeedback[];
  coachReviews?: CoachReview[];
  changeEvents?: ChangeEvent[];
  families?: Record<string, FamilyMeta>;
  competitionExercises: Partial<Record<Lift, string>>;
  params: EngineParams;
  from: string;
  to: string;
  /** 'weekly' = cada domingo; 'sessions' = cada fecha con una serie hecha. */
  step?: 'weekly' | 'sessions';
  /** Horizonte (exposiciones comparables posteriores) para describir lo observado después. */
  horizonN?: number;
}

export interface ReplayLiftPoint {
  lift: Lift;
  principalStatus: string | null;
  principalKey: string | null;
  statuses: string[];
  /** Reglas que se abstuvieron y por qué. */
  abstentions: { ruleId: string; reason: string }[];
  /** ¿La conclusión principal pudo formarse con datos (no es "datos insuficientes")? */
  evaluable: boolean;
}

export interface ReplayPoint {
  cutoff: string;
  planKnowledge: 'snapshot' | 'plan_completo_asumido';
  snapshotId: string | null;
  lifts: ReplayLiftPoint[];
}

export interface FollowStat {
  status: string;
  lift: Lift;
  occurrences: number;
  /** Ocurrencias con suficientes exposiciones posteriores para describir el cambio. */
  withOutcome: number;
  medianChangePct: number | null;
  shareImproved: number | null;
}

export interface PrAttempt {
  cutoff: string;
  lift: Lift;
  candidateKg: number;
  reps: number;
  /** 'no_intentado' NO es un error de la recomendación. */
  result: 'no_intentado' | 'intentado_igualado_o_superado' | 'intentado_sin_alcanzar';
}

export interface ReplayReport {
  method: {
    rulesVersion: string;
    paramsVersion: string;
    step: string;
    from: string;
    to: string;
    cutoffs: number;
    horizonN: number;
  };
  planKnowledge: { snapshots: number; assumedComplete: number; note: string };
  points: ReplayPoint[];
  coverage: Record<
    string,
    {
      cutoffs: number;
      evaluable: number;
      evaluableFraction: number;
      topAbstentionReasons: { reason: string; count: number }[];
    }
  >;
  alertFrequency: { lift: Lift; status: string; cutoffs: number; fraction: number }[];
  persistence: { lift: Lift; status: string; runs: number; meanRunLength: number; maxRunLength: number }[];
  transitions: { lift: Lift; from: string; to: string; count: number }[];
  followUp: FollowStat[];
  baseline: {
    lift: Lift;
    cutoffs: number;
    withOutcome: number;
    medianChangePct: number | null;
    shareImproved: number | null;
  }[];
  prAttempts: PrAttempt[];
  limitations: string[];
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function cutoffsOf(inp: ReplayInput): string[] {
  if (inp.step === 'sessions') {
    return [
      ...new Set(
        inp.actualSets
          .filter(
            (a) =>
              a.status === 'done' && a.performedOn && a.performedOn >= inp.from && a.performedOn <= inp.to,
          )
          .map((a) => a.performedOn as string),
      ),
    ].sort();
  }
  const out: string[] = [];
  let d = inp.from;
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) d = addDays(d, 1);
  for (; d <= inp.to; d = addDays(d, 7)) out.push(d);
  return out;
}

/** Plan conocido en una fecha de corte. */
export function planKnownAt(
  inp: Pick<ReplayInput, 'plannedSets' | 'snapshots'>,
  cutoff: string,
): { sets: PlannedSet[]; knowledge: ReplayPoint['planKnowledge']; snapshotId: string | null } {
  const snaps = (inp.snapshots ?? [])
    .filter((s) => s.status === 'aplicado' && s.detectedOn <= cutoff)
    .sort((a, b) => b.seq - a.seq);
  if (inp.snapshots?.length) {
    const s = snaps[0];
    return s
      ? { sets: s.sets, knowledge: 'snapshot', snapshotId: s.id }
      : { sets: [], knowledge: 'snapshot', snapshotId: null };
  }
  return { sets: inp.plannedSets, knowledge: 'plan_completo_asumido', snapshotId: null };
}

export function runReplay(inp: ReplayInput): ReplayReport {
  const N = inp.horizonN ?? inp.params.nExposures;
  const cuts = cutoffsOf(inp);
  const amapAll = new Map(inp.actualSets.map((a) => [a.plannedSetId, a]));
  const sessionDate = new Map(inp.plannedSets.map((s) => [s.sessionKey, s.plannedDate]));
  const points: ReplayPoint[] = [];
  for (const cutoff of cuts) {
    const known = planKnownAt(inp, cutoff);
    const ev = evaluateAthlete({
      cutoff,
      params: inp.params,
      plannedSets: known.sets,
      actualSets: inp.actualSets.filter((a) => !a.performedOn || a.performedOn <= cutoff),
      readiness: null,
      readinessHistory: inp.readinessHistory.filter((r) => r.date <= cutoff),
      sessionFeedback: (inp.sessionFeedback ?? []).filter(
        (f) => (sessionDate.get(f.sessionKey) ?? '9') <= cutoff,
      ),
      coachReviews: (inp.coachReviews ?? []).filter((r) => r.date <= cutoff),
      changeEvents: (inp.changeEvents ?? []).filter((e) => e.detectedOn <= cutoff),
      families: inp.families,
      competitionExercises: inp.competitionExercises,
    });
    points.push({
      cutoff,
      planKnowledge: known.knowledge,
      snapshotId: known.snapshotId,
      lifts: (Object.keys(ev.lifts) as Lift[]).map((lift) => {
        const le = ev.lifts[lift]!;
        return {
          lift,
          principalStatus: le.principal?.status ?? null,
          principalKey: le.state.principal?.key ?? null,
          statuses: [...new Set(le.results.map((r) => r.status))],
          abstentions: le.results
            .filter((r) => r.status === 'datos_insuficientes')
            .map((r) => ({ ruleId: r.ruleId, reason: r.missing[0] ?? r.summary })),
          // evaluable = la conclusión principal no es "datos insuficientes" (una regla auxiliar que dice "sin señal" sin datos no cuenta)
          evaluable: !!le.principal && le.principal.status !== 'datos_insuficientes',
        };
      }),
    });
  }
  const lifts = Object.keys(inp.competitionExercises) as Lift[];
  const coverage: ReplayReport['coverage'] = {};
  const alertFrequency: ReplayReport['alertFrequency'] = [];
  const persistence: ReplayReport['persistence'] = [];
  const transitions = new Map<string, number>();
  for (const lift of lifts) {
    const ps = points
      .map((p) => p.lifts.find((l) => l.lift === lift))
      .filter((x): x is ReplayLiftPoint => !!x);
    const reasons = new Map<string, number>();
    for (const p of ps)
      for (const a of p.abstentions)
        reasons.set(`${a.ruleId}: ${a.reason}`, (reasons.get(`${a.ruleId}: ${a.reason}`) ?? 0) + 1);
    const ev = ps.filter((p) => p.evaluable).length;
    coverage[lift] = {
      cutoffs: ps.length,
      evaluable: ev,
      evaluableFraction: ps.length ? ev / ps.length : 0,
      topAbstentionReasons: [...reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
    const counts = new Map<string, number>();
    for (const p of ps)
      if (p.principalStatus) counts.set(p.principalStatus, (counts.get(p.principalStatus) ?? 0) + 1);
    for (const [status, c] of counts)
      alertFrequency.push({ lift, status, cutoffs: c, fraction: ps.length ? c / ps.length : 0 });
    let run = 0;
    const runs = new Map<string, number[]>();
    for (let i = 0; i < ps.length; i++) {
      const cur = ps[i]!.principalStatus;
      const prev = ps[i - 1]?.principalStatus ?? null;
      if (cur && cur === prev) run++;
      else {
        if (prev && run) runs.set(prev, [...(runs.get(prev) ?? []), run]);
        run = cur ? 1 : 0;
      }
      if (prev && cur && prev !== cur)
        transitions.set(`${lift}|${prev}|${cur}`, (transitions.get(`${lift}|${prev}|${cur}`) ?? 0) + 1);
    }
    const last = ps.at(-1)?.principalStatus;
    if (last && run) runs.set(last, [...(runs.get(last) ?? []), run]);
    for (const [status, rs] of runs)
      persistence.push({
        lift,
        status,
        runs: rs.length,
        meanRunLength: rs.reduce((a, b) => a + b, 0) / rs.length,
        maxRunLength: Math.max(...rs),
      });
  }
  // --- lo observado DESPUÉS de cada corte (descriptivo; nunca se usa para decidir)
  const finalPlan = inp.snapshots?.length
    ? (inp.snapshots.filter((s) => s.status === 'aplicado').sort((a, b) => b.seq - a.seq)[0]?.sets ??
      inp.plannedSets)
    : inp.plannedSets;
  const expo: Partial<Record<Lift, Exposure[]>> = {};
  for (const lift of lifts) {
    const bench = finalPlan.filter(
      (s) => s.lift === lift && s.exerciseName === inp.competitionExercises[lift] && !s.isWarmup,
    );
    expo[lift] = buildExposures(bench, amapAll, '9999-12-31', emptyQuality()).filter((e) => e.e !== null);
  }
  const change = (lift: Lift, cutoff: string): number | null => {
    const all = expo[lift] ?? [];
    const before = all.filter((e) => e.date <= cutoff).slice(-N);
    const after = all.filter((e) => e.date > cutoff).slice(0, N);
    if (before.length < N || after.length < N) return null;
    const b = median(before.map((e) => e.e as number));
    return (100 * (median(after.map((e) => e.e as number)) - b)) / b;
  };
  const stat = (xs: number[]) => ({
    median: xs.length ? median(xs) : null,
    share: xs.length ? xs.filter((x) => x > 0).length / xs.length : null,
  });
  const followUp: FollowStat[] = [];
  const baseline: ReplayReport['baseline'] = [];
  for (const lift of lifts) {
    const ps = points
      .map((p) => ({ cutoff: p.cutoff, lp: p.lifts.find((l) => l.lift === lift) }))
      .filter((x): x is { cutoff: string; lp: ReplayLiftPoint } => !!x.lp);
    const all = ps.map((p) => change(lift, p.cutoff)).filter((x): x is number => x !== null);
    const b = stat(all);
    baseline.push({
      lift,
      cutoffs: ps.length,
      withOutcome: all.length,
      medianChangePct: b.median,
      shareImproved: b.share,
    });
    for (const status of new Set(ps.map((p) => p.lp.principalStatus).filter((x): x is string => !!x))) {
      const occ = ps.filter((p) => p.lp.principalStatus === status);
      const ch = occ.map((p) => change(lift, p.cutoff)).filter((x): x is number => x !== null);
      const s = stat(ch);
      followUp.push({
        status,
        lift,
        occurrences: occ.length,
        withOutcome: ch.length,
        medianChangePct: s.median,
        shareImproved: s.share,
      });
    }
  }
  // --- intentos de PR: la evaluación se repite en cada corte con candidato; "no intentado" no es un error
  const prAttempts: PrAttempt[] = [];
  const horizonDays = 28;
  const prPoints = points.flatMap((p) =>
    p.lifts.filter((l) => l.statuses.includes('candidato_pr')).map((l) => ({ p, l })),
  );
  for (const { p, l } of prPoints) {
    const ev = evaluateAthlete({
      cutoff: p.cutoff,
      params: inp.params,
      plannedSets: planKnownAt(inp, p.cutoff).sets,
      actualSets: inp.actualSets.filter((a) => !a.performedOn || a.performedOn <= p.cutoff),
      readiness: null,
      readinessHistory: inp.readinessHistory.filter((r) => r.date <= p.cutoff),
      coachReviews: (inp.coachReviews ?? []).filter((r) => r.date <= p.cutoff),
      competitionExercises: inp.competitionExercises,
      families: inp.families,
    });
    const c = ev.lifts[l.lift]?.results.find(
      (r) => r.ruleId === 'R-PR' && r.status === 'candidato_pr',
    )?.candidate;
    if (!c) continue;
    const end = addDays(p.cutoff, horizonDays);
    const later = inp.actualSets.filter(
      (a) =>
        a.status === 'done' &&
        a.performedOn &&
        a.performedOn > p.cutoff &&
        a.performedOn <= end &&
        a.kg !== null &&
        a.reps !== null,
    );
    const sets = later.filter(
      (a) =>
        finalPlan.find((s) => s.id === a.plannedSetId)?.exerciseName === c.exercise &&
        (a.reps as number) >= c.protocol.reps,
    );
    const tried = sets.filter((a) => (a.kg as number) > c.previousRecord!.kg);
    prAttempts.push({
      cutoff: p.cutoff,
      lift: l.lift,
      candidateKg: c.protocol.kg,
      reps: c.protocol.reps,
      result: !tried.length
        ? 'no_intentado'
        : tried.some((a) => (a.kg as number) >= c.protocol.kg)
          ? 'intentado_igualado_o_superado'
          : 'intentado_sin_alcanzar',
    });
  }
  const assumed = points.filter((p) => p.planKnowledge === 'plan_completo_asumido').length;
  return {
    method: {
      rulesVersion: RULES_VERSION,
      paramsVersion: PARAMS_VERSION,
      step: inp.step ?? 'weekly',
      from: inp.from,
      to: inp.to,
      cutoffs: cuts.length,
      horizonN: N,
    },
    planKnowledge: {
      snapshots: points.length - assumed,
      assumedComplete: assumed,
      note: assumed
        ? 'Sin versiones del plan: se asumió el plan completo en cada corte; puede incluir programación escrita después (limitación).'
        : 'Cada corte usó la última versión aplicada conocida en esa fecha.',
    },
    points,
    coverage,
    alertFrequency,
    persistence,
    transitions: [...transitions.entries()].map(([k, count]) => {
      const [lift, from, to] = k.split('|') as [Lift, string, string];
      return { lift, from, to, count };
    }),
    followUp,
    baseline,
    prAttempts,
    limitations: [
      'Observacional: describe lo ocurrido después de cada alerta; no prueba que la recomendación fuera correcta ni causal.',
      'No hay datos de lesión: no se evalúa ninguna predicción de lesión.',
      'Una recomendación no aplicada o un PR no intentado no es un error del motor (no se llama falso positivo).',
      'La fecha de registro real de cada dato no se conoce: se usa la fecha de ejecución. Un dato cargado tarde se verá antes de lo que realmente se supo.',
      'Las ventanas de comparación de cambios posteriores se solapan entre cortes consecutivos: las ocurrencias no son independientes y no se calculan intervalos ni tests.',
      'El baseline simple es la distribución del mismo cambio observado en TODOS los cortes, sin condicionar a la alerta.',
    ],
  };
}
