/**
 * Referencia de fuerza para PRESCRIBIR o calcular intensidad relativa. Es una entidad aparte de las estimaciones de e1RM:
 * tiene fuente, fecha, ejercicio y versión. Un ajuste por readiness NO reescribe una referencia ni el rendimiento registrado.
 */
export type ReferenceSource =
  'test' | 'competencia' | 'estimada_curva' | 'estimada_formula' | 'decision_del_coach';

export interface StrengthReference {
  id: string;
  exerciseName: string;
  kg: number;
  source: ReferenceSource;
  /** Fecha desde la que rige (la fecha de la medición/decisión). */
  asOf: string;
  version: string;
  note: string;
}

export interface ReferenceInfo {
  id: string | null;
  kg: number;
  source: string;
  asOf: string | null;
  exercise: string;
  version: string | null;
}

/** Referencia vigente a una fecha: la última con asOf ≤ fecha. Nunca mira hacia adelante. */
export function referenceAt(
  refs: StrengthReference[],
  exerciseName: string,
  date: string,
): StrengthReference | null {
  let best: StrengthReference | null = null;
  for (const r of refs) {
    if (r.exerciseName !== exerciseName || r.asOf > date) continue;
    if (!best || r.asOf > best.asOf || (r.asOf === best.asOf && r.id > best.id)) best = r;
  }
  return best;
}

export const toInfo = (r: StrengthReference): ReferenceInfo => ({
  id: r.id,
  kg: r.kg,
  source: r.source,
  asOf: r.asOf,
  exercise: r.exerciseName,
  version: r.version,
});
