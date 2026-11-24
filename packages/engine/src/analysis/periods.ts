import { e1rm } from '../e1rm.js';
import { groupMetrics } from '../metrics.js';
import type { ActualSet, Lift, PlannedSet, SessionFeedback } from '../types.js';
import { toViews, type SetView } from '../views.js';
import { SERIES_PICK } from './registry.js';

export type Granularity = 'week' | 'session';

/** Valor de una métrica en un período; null = sin dato (nunca 0 por ausencia). */
export type Values = Record<string, number | null>;

export interface PeriodCompliance {
  planned: number;
  done: number;
  skipped: number;
  /** Previstas sin registro: faltante, no omitidas. */
  unknown: number;
}

export interface PeriodRow {
  key: string;
  granularity: Granularity;
  blockKey: string;
  weekNo: number;
  sessionKey: string | null;
  /** Primera y última fecha con series (calendario real). */
  from: string;
  to: string;
  /** La semana (o sesión) todavía no empezó al corte. */
  future: boolean;
  /** Prevista: se calcula siempre con el plan; null si el período no tiene series previstas. */
  planned: Values | null;
  /** Realizada: null si no hay series hechas al corte. Plan y real nunca se completan entre sí. */
  actual: Values | null;
  /** Series sin RPE real o sin referencia: explican valores faltantes sin esconderlos. */
  quality: { siMissing: number; pctMissing: number };
  compliance: PeriodCompliance;
  /** Pares (real, objetivo) usados y su desvío medio. */
  rpeDev: { pairs: number; mean: number | null };
  fatigueEnd: number | null;
}

export interface PeriodsInput {
  planned: PlannedSet[];
  actual: ActualSet[];
  feedback: SessionFeedback[];
  cutoff: string;
  from: string;
  to: string;
  lift?: Lift | 'ALL';
  granularity: Granularity;
}

const valuesOf = (
  v: SetView[],
  weekNo: number,
): { values: Values; siMissing: number; pctMissing: number } => {
  const w = groupMetrics(v, weekNo);
  const values: Values = {};
  for (const [id, pick] of Object.entries(SERIES_PICK)) values[id] = pick(w);
  return { values, siMissing: w.siMissing, pctMissing: w.pctMissing };
};

/** Mejor e1RM por curva con el RPE de cada serie (real en lo realizado, objetivo en lo previsto: se rotulan aparte). Con varios lifts no hay un único e1RM. */
const bestE1rm = (v: SetView[], single: boolean): number | null => {
  if (!single) return null;
  let best: number | null = null;
  for (const x of v) {
    if (x.kg === null || x.rpe === null) continue;
    const e = e1rm(x.kg, x.reps, x.rpe);
    if (e !== null && (best === null || e > best)) best = e;
  }
  return best;
};

/**
 * Períodos del análisis (semana del bloque o sesión). Solo lectura y sin fuga de futuro: lo realizado excluye todo lo posterior al corte,
 * lo previsto se toma del plan conocido. `from`/`to` recortan por fecha de la serie.
 */
export function buildPeriods(inp: PeriodsInput): PeriodRow[] {
  const lift = inp.lift ?? 'ALL';
  const inScope = (s: PlannedSet) => !s.isWarmup && s.lift !== null && (lift === 'ALL' || s.lift === lift);
  const plannedSets = inp.planned.filter(inScope);
  const amap = new Map(inp.actual.map((a) => [a.plannedSetId, a]));
  const pViews = toViews(inp.planned, inp.actual, 'planned', inp.cutoff).filter(
    (x) => (lift === 'ALL' || x.lift === lift) && x.date >= inp.from && x.date <= inp.to,
  );
  const aViews = toViews(inp.planned, inp.actual, 'actual', inp.cutoff).filter(
    (x) => (lift === 'ALL' || x.lift === lift) && x.date >= inp.from && x.date <= inp.to,
  );
  const keyOf = (x: { blockKey: string; weekNo: number; sessionKey: string }) =>
    inp.granularity === 'week' ? `${x.blockKey}|${x.weekNo}` : x.sessionKey;
  const keyOfPlanned = (s: PlannedSet) =>
    inp.granularity === 'week' ? `${s.blockKey}|${s.weekNo}` : s.sessionKey;

  const keys = new Map<string, { blockKey: string; weekNo: number; sessionKey: string | null }>();
  for (const x of [...pViews, ...aViews])
    keys.set(keyOf(x), {
      blockKey: x.blockKey,
      weekNo: x.weekNo,
      sessionKey: inp.granularity === 'session' ? x.sessionKey : null,
    });

  const fb = new Map(inp.feedback.map((f) => [f.sessionKey, f.endFatigue]));
  const rows: PeriodRow[] = [];
  for (const [key, meta] of keys) {
    const pv = pViews.filter((x) => keyOf(x) === key);
    const av = aViews.filter((x) => keyOf(x) === key);
    const dates = [...pv, ...av].map((x) => x.date).sort();
    const from = dates[0] as string;
    const to = dates[dates.length - 1] as string;
    const plannedHere = plannedSets.filter(
      (s) =>
        keyOfPlanned(s) === key &&
        s.plannedDate <= inp.cutoff &&
        s.plannedDate >= inp.from &&
        s.plannedDate <= inp.to,
    );
    const compliance: PeriodCompliance = { planned: plannedHere.length, done: 0, skipped: 0, unknown: 0 };
    let devSum = 0;
    let devN = 0;
    for (const s of plannedHere) {
      const a = amap.get(s.id);
      if (a?.status === 'done' && a.performedOn && a.performedOn <= inp.cutoff) {
        compliance.done++;
        if (a.rpe !== null && s.targetRpe !== null) {
          devSum += a.rpe - s.targetRpe;
          devN++;
        }
      } else if (a?.status === 'skipped') compliance.skipped++;
      else compliance.unknown++;
    }
    const p = pv.length ? valuesOf(pv, meta.weekNo) : null;
    const a = av.length ? valuesOf(av, meta.weekNo) : null;
    if (p) p.values.e1rm = bestE1rm(pv, lift !== 'ALL');
    if (a) a.values.e1rm = bestE1rm(av, lift !== 'ALL');
    if (a) {
      a.values.nl_ratio = p && p.values.nl ? (100 * (a.values.nl as number)) / (p.values.nl as number) : null;
      a.values.rpe_dev = devN ? devSum / devN : null;
      a.values.compliance_sets = compliance.planned ? (100 * compliance.done) / compliance.planned : null;
    }
    // fatiga de fin de sesión: la sesión misma, o la media de las sesiones de la semana
    const sessions = [...new Set(aViews.filter((x) => keyOf(x) === key).map((x) => x.sessionKey))];
    const fat = sessions.flatMap((s) => (fb.get(s) == null ? [] : [fb.get(s) as number]));
    const fatigueEnd = fat.length
      ? inp.granularity === 'session'
        ? (fat[0] as number)
        : fat.reduce((x, y) => x + y, 0) / fat.length
      : null;
    if (a) a.values.fatigue_end = fatigueEnd;
    rows.push({
      key,
      granularity: inp.granularity,
      blockKey: meta.blockKey,
      weekNo: meta.weekNo,
      sessionKey: meta.sessionKey,
      from,
      to,
      future: from > inp.cutoff,
      planned: p?.values ?? null,
      actual: a?.values ?? null,
      quality: { siMissing: a?.siMissing ?? 0, pctMissing: a?.pctMissing ?? 0 },
      compliance,
      rpeDev: { pairs: devN, mean: devN ? devSum / devN : null },
      fatigueEnd,
    });
  }
  return rows.sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : x.key < y.key ? -1 : 1));
}
