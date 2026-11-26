import { e1rm } from './e1rm.js';
import { exerciseKey } from './exercise-library.js';
import { referenceAt, type StrengthReference } from './references.js';
import type { ActualSet, PlannedSet } from './types.js';

/** Ventana (días) para el e1RM calculado que se ofrece como base: lo observado de esa variante, no más viejo que esto. */
export const BASE_1RM_WINDOW_DAYS = 56;

export interface Base1rm {
  /** Clave canónica del ejercicio (ver `exerciseKey`). */
  key: string;
  exerciseName: string;
  /** 1RM declarado (referencia fechada vigente a la fecha de corte). */
  declared: { kg: number; asOf: string; source: StrengthReference['source']; id: string } | null;
  /** Mejor e1RM observado (series hechas con RPE real) de ESA variante dentro de la ventana. */
  calculated: { kg: number; asOf: string; sets: number; windowDays: number } | null;
}

const shiftIso = (d: string, days: number) => {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
};

/**
 * 1RM base por ejercicio para poder programar con porcentajes. Dos fuentes, siempre separadas y sin transferir entre variantes:
 * la referencia DECLARADA vigente a `asOf` y el e1RM CALCULADO observado (curva RTS con el RPE real; sin RPE no se calcula).
 * Sin ninguna de las dos no hay base y el porcentaje no se puede usar.
 */
export function base1rm(
  refs: StrengthReference[],
  planned: PlannedSet[],
  actual: ActualSet[],
  asOf: string,
): Base1rm[] {
  const names = new Map<string, string>();
  for (const r of refs) names.set(exerciseKey(r.exerciseName), r.exerciseName);
  for (const p of planned) names.set(exerciseKey(p.exerciseName), p.exerciseName);
  const amap = new Map(actual.map((a) => [a.plannedSetId, a]));
  const from = shiftIso(asOf, -BASE_1RM_WINDOW_DAYS);
  const out: Base1rm[] = [];
  for (const [key, exerciseName] of names) {
    const mine = refs.filter((r) => exerciseKey(r.exerciseName) === key);
    let best: StrengthReference | null = null;
    for (const n of new Set(mine.map((r) => r.exerciseName))) {
      const c = referenceAt(mine, n, asOf);
      if (c && (!best || c.asOf > best.asOf)) best = c;
    }
    let calc: Base1rm['calculated'] = null;
    let count = 0;
    for (const p of planned) {
      if (p.isWarmup || exerciseKey(p.exerciseName) !== key) continue;
      const a = amap.get(p.id);
      if (!a || a.status !== 'done' || !a.performedOn || a.performedOn > asOf || a.performedOn < from)
        continue;
      if (a.kg === null || a.reps === null || a.rpe === null) continue;
      const e = e1rm(a.kg, a.reps, a.rpe);
      if (e === null) continue;
      count++;
      if (!calc || e > calc.kg)
        calc = {
          kg: Math.round(e * 10) / 10,
          asOf: a.performedOn,
          sets: 0,
          windowDays: BASE_1RM_WINDOW_DAYS,
        };
    }
    if (calc) calc.sets = count;
    if (!best && !calc) continue;
    out.push({
      key,
      exerciseName,
      declared: best ? { kg: best.kg, asOf: best.asOf, source: best.source, id: best.id } : null,
      calculated: calc,
    });
  }
  return out.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}

/** Una fila por nombre pedido (en el orden dado): si no hay ninguna fuente, `declared` y `calculated` quedan en null (no hay base). */
export function base1rmFor(
  names: string[],
  refs: StrengthReference[],
  planned: PlannedSet[],
  actual: ActualSet[],
  asOf: string,
): Base1rm[] {
  const all = base1rm(refs, planned, actual, asOf);
  return names.map((name) => {
    const key = exerciseKey(name);
    const hit = all.find((r) => r.key === key);
    return { key, exerciseName: name, declared: hit?.declared ?? null, calculated: hit?.calculated ?? null };
  });
}
