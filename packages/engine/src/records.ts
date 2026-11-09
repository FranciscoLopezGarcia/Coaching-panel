import { estimateCurve, estimatePrg, METHOD_CURVE, METHOD_PRG, type MethodRef } from './e1rm-methods.js';
import type { RecordRef } from './metric-result.js';
import { isWorkSet, type ObservedSet } from './observed.js';

/**
 * Tipos de récord. NO se confunden entre sí:
 *  - single: mayor carga con 1 repetición.
 *  - load_for_reps: mayor carga con AL MENOS r repeticiones.
 *  - reps_at_load: más repeticiones con AL MENOS esa carga.
 *  - rpe_comparable: mayor carga para (reps, RPE real) exactos. Solo series con RPE registrado.
 *  - best_e1rm: mejor ESTIMACIÓN por método. NO es un récord real (isRealPR = false).
 * Entre variantes/equipos NO hay marcas equivalentes: se agrupa por ejercicio + variantKey.
 * Se excluyen calentamientos y dropsets; las series al fallo cuentan y quedan marcadas.
 */
export type RecordType = 'single' | 'load_for_reps' | 'reps_at_load' | 'rpe_comparable' | 'best_e1rm';

export interface RecordEntry {
  type: RecordType;
  exercise: string;
  variantKey: string;
  /** Qué parámetro identifica el récord: 'reps=5', 'kg=140', 'reps=5@rpe=8', 'method=prg-6-formulas'. */
  key: string;
  value: number;
  unit: 'kg' | 'reps' | 'kg (e1RM)';
  date: string;
  setRef: RecordRef;
  isRealPR: boolean;
  method: MethodRef | null;
  conditions: { toFailure: boolean; rpe: number | null; loadKind: string; source: string };
}

const eligible = (o: ObservedSet): boolean =>
  isWorkSet(o) &&
  o.setType !== 'dropset' &&
  o.kg !== null &&
  o.kg > 0 &&
  o.reps !== null &&
  o.reps > 0 &&
  Number.isInteger(o.reps);

/** Récords hasta el corte. `from` opcional recorta el período; sin él, es el histórico completo (lo normal para un récord). */
export function computeRecords(obs: ObservedSet[], cutoff: string): RecordEntry[] {
  const groups = new Map<string, ObservedSet[]>();
  for (const o of obs) {
    if (o.date > cutoff || !eligible(o)) continue;
    const k = `${o.exerciseName}\u0000${o.variantKey}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const out: RecordEntry[] = [];
  const push = (
    type: RecordType,
    o: ObservedSet,
    key: string,
    value: number,
    unit: RecordEntry['unit'],
    isRealPR: boolean,
    method: MethodRef | null,
  ) =>
    out.push({
      type,
      exercise: o.exerciseName,
      variantKey: o.variantKey,
      key,
      value,
      unit,
      date: o.date,
      setRef: { kind: 'set', id: o.id, date: o.date },
      isRealPR,
      method,
      conditions: { toFailure: o.setType === 'failure', rpe: o.rpe, loadKind: o.loadKind, source: o.source },
    });
  const better = (a: ObservedSet, b: ObservedSet, f: (x: ObservedSet) => number) =>
    f(a) > f(b) || (f(a) === f(b) && a.date > b.date) ? a : b;
  for (const sets of groups.values()) {
    const singles = sets.filter((s) => s.reps === 1);
    if (singles.length) {
      const b = singles.reduce((a, c) => better(a, c, (x) => x.kg as number));
      push('single', b, 'reps=1', b.kg as number, 'kg', true, null);
    }
    for (const r of [...new Set(sets.map((s) => s.reps as number))].sort((a, b) => a - b)) {
      const ok = sets.filter((s) => (s.reps as number) >= r);
      const b = ok.reduce((a, c) => better(a, c, (x) => x.kg as number));
      push('load_for_reps', b, `reps=${r}`, b.kg as number, 'kg', true, null);
    }
    for (const kg of [...new Set(sets.map((s) => s.kg as number))].sort((a, b) => a - b)) {
      const ok = sets.filter((s) => (s.kg as number) >= kg);
      const b = ok.reduce((a, c) => better(a, c, (x) => x.reps as number));
      push('reps_at_load', b, `kg=${kg}`, b.reps as number, 'reps', true, null);
    }
    const withRpe = sets.filter((s) => s.rpe !== null);
    const combos = new Set(withRpe.map((s) => `${s.reps}|${s.rpe}`));
    for (const c of [...combos].sort()) {
      const [r, rpe] = c.split('|').map(Number) as [number, number];
      const ok = withRpe.filter((s) => s.reps === r && s.rpe === rpe);
      const b = ok.reduce((a, x) => better(a, x, (y) => y.kg as number));
      push('rpe_comparable', b, `reps=${r}@rpe=${rpe}`, b.kg as number, 'kg', true, null);
    }
    // mejor e1RM por método: ESTIMACIÓN, no récord real
    for (const [m, f] of [
      [METHOD_CURVE, (s: ObservedSet) => estimateCurve(s.kg, s.reps, s.rpe)],
      [METHOD_PRG, (s: ObservedSet) => estimatePrg(s.kg, s.reps)],
    ] as const) {
      let best: { s: ObservedSet; v: number } | null = null;
      for (const s of sets) {
        const e = f(s);
        if (e.value !== null && (!best || e.value > best.v)) best = { s, v: e.value };
      }
      if (best) push('best_e1rm', best.s, `method=${m.id}`, best.v, 'kg (e1RM)', false, m);
    }
  }
  return out;
}

/** Récord previo de un tipo/clave para un ejercicio-variante, ANTES de una fecha (o hasta el corte si no se indica). */
export function recordFor(
  records: RecordEntry[],
  q: { type: RecordType; exercise: string; variantKey?: string; key: string },
): RecordEntry | null {
  return (
    records.find(
      (r) =>
        r.type === q.type &&
        r.exercise === q.exercise &&
        r.key === q.key &&
        (q.variantKey === undefined || r.variantKey === q.variantKey),
    ) ?? null
  );
}

/** Récord previo de CARGA para al menos `reps` repeticiones de un ejercicio+variante (series de trabajo, sin dropsets), hasta el corte. */
export function recordLoadForReps(
  obs: ObservedSet[],
  exercise: string,
  variantKey: string,
  reps: number,
  cutoff: string,
): RecordEntry | null {
  let best: ObservedSet | null = null;
  for (const o of obs) {
    if (
      o.exerciseName !== exercise ||
      o.variantKey !== variantKey ||
      o.date > cutoff ||
      !eligible(o) ||
      (o.reps as number) < reps
    )
      continue;
    if (
      !best ||
      (o.kg as number) > (best.kg as number) ||
      ((o.kg as number) === (best.kg as number) && o.date > best.date)
    )
      best = o;
  }
  if (!best) return null;
  return {
    type: 'load_for_reps',
    exercise,
    variantKey,
    key: `reps=${reps}`,
    value: best.kg as number,
    unit: 'kg',
    date: best.date,
    setRef: { kind: 'set', id: best.id, date: best.date },
    isRealPR: true,
    method: null,
    conditions: {
      toFailure: best.setType === 'failure',
      rpe: best.rpe,
      loadKind: best.loadKind,
      source: best.source,
    },
  };
}
