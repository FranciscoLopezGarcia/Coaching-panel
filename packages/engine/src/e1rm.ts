import { RPE_CURVE_VERSION, pctFromCurve } from './tables/rpe.js';

/**
 * %1RM por (reps, RPE) con la curva única de RTS (h = reps + 10 − RPE) [recuperado y medido en la app real].
 * Versión 2 del cálculo: reemplaza la tabla anterior del proyecto (`rpe-proyecto-v1`), que divergía de la curva por encima de h = 10
 * (107 de 195 celdas; error de copia heredado de PRG). Decisión del proyecto: usar la curva de RTS.
 *
 * Dominio RECOMENDADO (decisión operativa, el que usan las reglas por defecto): reps 1–15 y RPE 4–10 en pasos de 0,5.
 * Dominio AMPLIO (respaldado por la fuente): reps 1–50, RPE 1–10, h ≤ 50. Se puede pedir explícitamente; fuera del recomendado se advierte.
 */
export const RPE_TABLE_VERSION = RPE_CURVE_VERSION;
export const MAX_TABLE_REPS = 15;
export const RECOMMENDED_DOMAIN = { repsMin: 1, repsMax: 15, rpeMin: 4, rpeMax: 10 } as const;
export type CurveDomain = 'recomendado' | 'amplio';

export const inRecommendedDomain = (reps: number, rpe: number): boolean =>
  reps >= RECOMMENDED_DOMAIN.repsMin &&
  reps <= RECOMMENDED_DOMAIN.repsMax &&
  rpe >= RECOMMENDED_DOMAIN.rpeMin &&
  rpe <= RECOMMENDED_DOMAIN.rpeMax;

/** Fracción del 1RM. null fuera del dominio pedido. */
export function pctFromTable(reps: number, rpe: number, domain: CurveDomain = 'recomendado'): number | null {
  if (domain === 'recomendado' && !inRecommendedDomain(reps, rpe)) return null;
  return pctFromCurve(reps, rpe);
}

/** E = kg / %(reps, RPE real). Sin RPE no se calcula (no se inventa). */
export function e1rm(
  kg: number,
  reps: number,
  rpe: number,
  domain: CurveDomain = 'recomendado',
): number | null {
  if (!(kg > 0)) return null;
  const p = pctFromTable(reps, rpe, domain);
  return p ? kg / p : null;
}
