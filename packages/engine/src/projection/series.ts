import { estimateCurve, estimatePrg, METHOD_CURVE, METHOD_PRG, type Estimate } from '../e1rm-methods.js';
import type { ObservedSet } from '../observed.js';
import { AGGREGATION_VERSION, type AggregateMode } from './config.js';
import { median } from './models.js';

export type Variable = 'e1rm_table_rpe' | 'e1rm_prg_formulas';
export const VARIABLE_METHOD = {
  e1rm_table_rpe: METHOD_CURVE,
  e1rm_prg_formulas: METHOD_PRG,
} as const;

export interface ExposurePoint {
  date: string;
  value: number;
  /** Clave de la exposición (fuente|sesión|ejercicio|variante). Un punto por exposición. */
  exposureKey: string;
  /** Series que estimaron (elegibles). */
  setIds: string[];
  nSets: number;
  /** Series trabajo consideradas de la exposición (elegibles o no). */
  nEligibleSets: number;
  /** El otro resumen (si se pidió 'best', la mediana; y viceversa). */
  alternateValue: number;
  source: string;
}

export interface Exclusion {
  reason: string;
  count: number;
  sampleIds: string[];
}

export interface VariantInfo {
  exercise: string;
  variantKey: string;
  lift: string | null;
  exposures: { e1rm_table_rpe: number; e1rm_prg_formulas: number };
}

export interface SeriesFilters {
  lift?: string;
  exercise?: string;
  variantKey?: string;
  source?: string;
  /** Series ejecutadas de estos ids (p. ej. exposición concreta). */
  plannedSetIds?: Set<string>;
}

const BAD_LOAD = new Set(['per_side', 'bodyweight', 'unknown', 'assisted']);

function matches(o: ObservedSet, f: SeriesFilters): boolean {
  if (f.source && o.source !== f.source) return false;
  if (f.lift && o.lift !== f.lift) return false;
  if (f.exercise && o.exerciseName !== f.exercise) return false;
  if (f.variantKey && o.variantKey !== f.variantKey) return false;
  return true;
}

/** Variantes disponibles bajo los filtros, con cuántas exposiciones (fechas) tiene cada método. */
export function availableVariants(obs: ObservedSet[], f: SeriesFilters, cutoff: string): VariantInfo[] {
  const g = new Map<string, ObservedSet[]>();
  for (const o of obs)
    if (
      o.date <= cutoff &&
      o.setType !== 'warmup' &&
      o.setType !== 'dropset' &&
      matches(o, { ...f, variantKey: undefined })
    )
      g.set(`${o.exerciseName}|${o.variantKey}`, [...(g.get(`${o.exerciseName}|${o.variantKey}`) ?? []), o]);
  return [...g.entries()].map(([k, sets]) => {
    const [exercise, variantKey] = k.split('|') as [string, string];
    const days = (fn: (s: ObservedSet) => Estimate) =>
      new Set(sets.filter((s) => !BAD_LOAD.has(s.loadKind) && fn(s).value !== null).map((s) => s.date)).size;
    return {
      exercise,
      variantKey,
      lift: sets[0]?.lift ?? null,
      exposures: {
        e1rm_table_rpe: days((s) => estimateCurve(s.kg, s.reps, s.rpe)),
        e1rm_prg_formulas: days((s) => estimatePrg(s.kg, s.reps)),
      },
    };
  });
}

/**
 * Serie por exposición (protocolo `exposure-agg-v1`):
 *  1. Series candidatas: de trabajo (no calentamiento ni dropset), fecha ≤ corte, mismo ejercicio+variante, carga total conocida.
 *  2. Cada serie estima el e1RM con UN método. Si el método necesita RPE real y no lo hay, la serie se EXCLUYE (no se completa con el objetivo).
 *  3. Una exposición = (fuente, sesión, ejercicio, variante). Su valor es UNO solo: el mejor e1RM ('best') o la mediana ('median') de sus series elegibles.
 *     Así, una sesión con muchas series pesa lo mismo que una con una sola: un punto por exposición.
 *  4. 'best' tiende a subir con la cantidad de series (máximo de más muestras) y 'median' diluye series de descarga: por eso se devuelve también el otro resumen.
 */
export function buildExposureSeries(
  obs: ObservedSet[],
  f: SeriesFilters,
  variable: Variable,
  aggregate: AggregateMode,
  cutoff: string,
): { points: ExposurePoint[]; exclusions: Exclusion[]; missingRpeSets: number; aggregationVersion: string } {
  const excl = new Map<string, { n: number; ids: string[] }>();
  const bump = (reason: string, id: string) => {
    const c = excl.get(reason) ?? { n: 0, ids: [] };
    c.n++;
    if (c.ids.length < 5) c.ids.push(id);
    excl.set(reason, c);
  };
  const est = (s: ObservedSet): Estimate =>
    variable === 'e1rm_table_rpe' ? estimateCurve(s.kg, s.reps, s.rpe) : estimatePrg(s.kg, s.reps);
  const groups = new Map<
    string,
    { vals: { v: number; id: string }[]; seen: number; date: string; source: string }
  >();
  let missingRpe = 0;
  for (const o of obs) {
    if (o.date > cutoff || !matches(o, f)) continue;
    if (f.plannedSetIds && !(o.plannedSetId && f.plannedSetIds.has(o.plannedSetId))) continue;
    if (o.setType === 'warmup') continue;
    if (o.setType === 'dropset') {
      bump('serie dropset (no es una exposición comparable)', o.id);
      continue;
    }
    const key = `${o.source}|${o.sessionKey}|${o.exerciseName}|${o.variantKey}`;
    const g = groups.get(key) ?? { vals: [], seen: 0, date: o.date, source: o.source };
    g.seen++;
    groups.set(key, g);
    if (BAD_LOAD.has(o.loadKind)) {
      bump(`carga no comparable (${o.loadKind})`, o.id);
      continue;
    }
    const e = est(o);
    if (e.value === null) {
      if (variable === 'e1rm_table_rpe' && o.rpe === null) missingRpe++;
      bump(e.reason ?? 'sin estimación', o.id);
      continue;
    }
    g.vals.push({ v: e.value, id: o.id });
  }
  const points: ExposurePoint[] = [];
  for (const [key, g] of groups) {
    if (!g.vals.length) continue;
    const vs = g.vals.map((x) => x.v);
    const best = Math.max(...vs);
    const med = median(vs);
    points.push({
      date: g.date,
      value: aggregate === 'best' ? best : med,
      alternateValue: aggregate === 'best' ? med : best,
      exposureKey: key,
      setIds: g.vals.map((x) => x.id),
      nSets: g.vals.length,
      nEligibleSets: g.seen,
      source: g.source,
    });
  }
  points.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.exposureKey < b.exposureKey ? -1 : 1,
  );
  return {
    points,
    exclusions: [...excl.entries()].map(([reason, c]) => ({ reason, count: c.n, sampleIds: c.ids })),
    missingRpeSets: missingRpe,
    aggregationVersion: AGGREGATION_VERSION,
  };
}

/** Marcas reales: mayor carga levantada por cantidad de repeticiones (misma variante, ≤ corte). No es la serie ajustada y no usa RPE. */
export function realMarks(
  obs: ObservedSet[],
  f: SeriesFilters,
  cutoff: string,
): { reps: number; kg: number; date: string; setId: string; rpe: number | null }[] {
  const best = new Map<
    number,
    { reps: number; kg: number; date: string; setId: string; rpe: number | null }
  >();
  for (const o of obs) {
    if (o.date > cutoff || !matches(o, f) || o.setType === 'warmup' || BAD_LOAD.has(o.loadKind)) continue;
    if (o.kg === null || o.reps === null || o.reps < 1 || o.reps > 12) continue;
    const c = best.get(o.reps);
    if (!c || o.kg > c.kg)
      best.set(o.reps, { reps: o.reps, kg: o.kg, date: o.date, setId: o.id, rpe: o.rpe });
  }
  return [...best.values()].sort((a, b) => a.reps - b.reps);
}
