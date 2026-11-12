import type { MuscleGroup } from './muscles.js';
import type { ActualSet, Lift, PlannedSet } from './types.js';

/**
 * Observación = lo que el atleta HIZO, con o sin prescripción vinculada. Es la base común de las métricas descriptivas:
 * peso, repeticiones, RPE real si existe, variante/equipo y fecha. No contiene nada deducido de una prescripción.
 */
export type SetType = 'work' | 'warmup' | 'failure' | 'dropset';
/** Cómo se interpreta el número de kg: no se mezclan mancuernas por lado, carga total y peso corporal. */
export type LoadKind =
  'total' | 'per_side' | 'machine' | 'bodyweight' | 'added_bodyweight' | 'assisted' | 'unknown';

export interface ObservedSet {
  id: string;
  /** Origen del dato: 'plan' (ejecución de una serie prevista), 'hevy', etc. Las fuentes no se deduplican entre sí. */
  source: string;
  sessionKey: string;
  /** Fecha civil (yyyy-mm-dd) tal como se registró/interpretó. */
  date: string;
  exerciseName: string;
  exerciseId: string;
  lift: Lift | null;
  /** Variante/equipo: dos observaciones con distinto variantKey no son marcas directamente equivalentes. */
  variantKey: string;
  setType: SetType;
  kg: number | null;
  reps: number | null;
  /** RPE REAL registrado. null = no registrado. Nunca se completa con un objetivo ni con una estimación. */
  rpe: number | null;
  loadKind: LoadKind;
  /** Serie prevista vinculada (null en datos sin prescripción, p. ej. Hevy). */
  plannedSetId: string | null;
  /** Orden de la serie dentro de su ejercicio y sesión (1, 2, 3…) cuando se conoce; null = no disponible (no se infiere del orden de lectura). */
  setNo?: number | null;
  /** Referencia de fuerza FECHADA vigente para esa serie (null = sin referencia). */
  refKg: number | null;
  refSource: string | null;
  refAsOf: string | null;
  /** Accesorio: grupo muscular elegido por el coach al programar (null/ausente = sin elegir; se usa la convención por nombre). */
  muscleGroup?: MuscleGroup | null;
}

export const isWorkSet = (o: ObservedSet): boolean => o.setType !== 'warmup';

/** Series ejecutadas de un plan → observaciones. Solo 'done' con fecha real y no posteriores al corte (sin fuga del futuro). */
export function observedFromPlan(planned: PlannedSet[], actual: ActualSet[], cutoff: string): ObservedSet[] {
  const amap = new Map(actual.map((a) => [a.plannedSetId, a]));
  const out: ObservedSet[] = [];
  for (const s of planned) {
    const a = amap.get(s.id);
    if (!a || a.status !== 'done' || !a.performedOn || a.performedOn > cutoff) continue;
    out.push({
      id: s.id,
      source: 'plan',
      sessionKey: s.sessionKey,
      date: a.performedOn,
      exerciseName: s.exerciseName,
      exerciseId: s.exerciseName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      lift: s.lift,
      variantKey: s.variantKey,
      setType: s.isWarmup ? 'warmup' : 'work',
      kg: a.kg,
      reps: a.reps,
      rpe: a.rpe,
      loadKind: 'total',
      plannedSetId: s.id,
      setNo: s.setNo,
      refKg: s.refKg,
      refSource: s.refKg ? 'plan' : null,
      refAsOf: null,
      muscleGroup: s.protocol?.muscleGroup ?? null,
    });
  }
  return out;
}
