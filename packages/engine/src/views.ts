import type { ActualSet, Lift, PlannedSet } from './types.js';

/** Vista común de una serie (prevista o realizada) para calcular métricas con las mismas reglas en ambos universos. */
export interface SetView {
  id: string;
  sessionKey: string;
  exposureId: string;
  variantKey: string;
  blockKey: string;
  familyKey: string;
  weekNo: number;
  dayNo: number;
  lift: Lift;
  exerciseName: string;
  date: string;
  reps: number;
  kg: number | null;
  rpe: number | null;
  refKg: number | null;
}

export type Universe = 'planned' | 'actual';

/** Series de TRABAJO (sin calentamientos) del universo pedido. Lo realizado excluye lo omitido/pendiente y lo posterior al corte. */
export function toViews(
  planned: PlannedSet[],
  actual: ActualSet[],
  universe: Universe,
  cutoff: string,
): SetView[] {
  const amap = new Map(actual.map((a) => [a.plannedSetId, a]));
  const out: SetView[] = [];
  for (const s of planned) {
    if (s.isWarmup || s.lift === null) continue;
    const base = {
      id: s.id,
      sessionKey: s.sessionKey,
      exposureId: s.exposureId,
      variantKey: s.variantKey,
      blockKey: s.blockKey,
      familyKey: s.familyKey,
      weekNo: s.weekNo,
      dayNo: s.dayNo,
      lift: s.lift,
      exerciseName: s.exerciseName,
      refKg: s.refKg,
    };
    if (universe === 'planned') {
      out.push({ ...base, date: s.plannedDate, reps: s.reps, kg: s.plannedKg, rpe: s.targetRpe });
    } else {
      const a = amap.get(s.id);
      if (
        !a ||
        a.status !== 'done' ||
        !a.performedOn ||
        a.performedOn > cutoff ||
        !Number.isInteger(a.reps) ||
        (a.reps as number) <= 0
      )
        continue;
      out.push({ ...base, date: a.performedOn, reps: a.reps as number, kg: a.kg, rpe: a.rpe });
    }
  }
  return out;
}
