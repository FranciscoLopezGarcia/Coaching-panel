import {
  MAX_TABLE_REPS,
  RPE_TABLE_VERSION,
  e1rm as curveE1rm,
  inRecommendedDomain,
  pctFromTable,
  type CurveDomain,
} from './e1rm.js';

/**
 * Métodos de e1RM. Son comparables SOLO dentro de un mismo método; nunca se unen en una tendencia única sin identificar el cambio.
 *  - 'table-rpe'      [recuperado]: kg ÷ %tabla(reps, RPE real). Requiere RPE real. Dominio: reps 1–15, RPE 4–10 (pasos de 0,5).
 *  - 'prg-6-formulas' [recuperado del código de PRG]: promedio de seis fórmulas de repeticiones. No usa RPE. Dominio conservador del
 *    proyecto: reps 2–10 (con reps = 1 devuelve el peso). Fuera de dominio no se extrapola.
 */
export const METHOD_CURVE = { id: 'table-rpe', version: RPE_TABLE_VERSION } as const;
export const METHOD_PRG = { id: 'prg-6-formulas', version: 'v1' } as const;
export type MethodRef = { id: string; version: string };

export interface Estimate {
  method: MethodRef;
  value: number | null;
  /** Valor sin redondear (PRG publica el promedio redondeado). */
  exact: number | null;
  status: 'available' | 'unavailable';
  reason: string | null;
  warnings: string[];
}

export const PRG_DOMAIN = { minReps: 2, maxReps: 10 } as const;

const unavailable = (method: MethodRef, reason: string): Estimate => ({
  method,
  value: null,
  exact: null,
  status: 'unavailable',
  reason,
  warnings: [],
});

/** e1RM por curva: requiere RPE real. Sin RPE → no disponible (no se completa con un objetivo ni una estimación). */
export function estimateCurve(
  kg: number | null,
  reps: number | null,
  rpe: number | null,
  domain: CurveDomain = 'recomendado',
): Estimate {
  if (kg === null || !(kg > 0)) return unavailable(METHOD_CURVE, 'sin carga válida');
  if (reps === null || !Number.isInteger(reps) || reps < 1)
    return unavailable(METHOD_CURVE, 'sin repeticiones válidas');
  if (rpe === null) return unavailable(METHOD_CURVE, 'sin RPE real registrado');
  if (pctFromTable(reps, rpe, domain) === null)
    return unavailable(
      METHOD_CURVE,
      domain === 'recomendado'
        ? `fuera del dominio recomendado (reps 1–${MAX_TABLE_REPS}, RPE 4–10 en pasos de 0,5): ${reps} reps @${rpe}`
        : `fuera del dominio de la curva (reps 1–50, RPE 1–10 en pasos de 0,5, reps + 10 − RPE ≤ 50): ${reps} reps @${rpe}`,
    );
  const v = curveE1rm(kg, reps, rpe, domain);
  const outside = domain === 'amplio' && !inRecommendedDomain(reps, rpe);
  return {
    method: METHOD_CURVE,
    value: v,
    exact: v,
    status: 'available',
    reason: null,
    warnings: outside
      ? [
          'Fuera del dominio recomendado (reps 1–15, RPE 4–10): zona poco precisa; la curva lo respalda pero RTS desaconseja RPE bajo.',
        ]
      : [],
  };
}

export interface PrgFormulas {
  epley: number;
  brzycki: number;
  lander: number;
  lombardi: number;
  mayhew: number;
  oconner: number;
}

/** Las seis fórmulas de PRG (valores sin redondear). Solo definidas para 2 ≤ reps ≤ 10. */
export function prgFormulas(w: number, r: number): PrgFormulas {
  return {
    epley: w * (1 + r / 30),
    brzycki: (36 * w) / (37 - r),
    lander: (100 * w) / (101.3 - 2.67123 * r),
    lombardi: w * Math.pow(r, 0.1),
    mayhew: (100 * w) / (52.2 + 41.9 * Math.exp(-0.055 * r)),
    oconner: w * (1 + 0.025 * r),
  };
}

/**
 * e1RM por fórmulas de repeticiones (PRG): sin RPE. Advertencia obligatoria: sin conocer el esfuerzo, una serie submáxima
 * SUBESTIMA la fuerza máxima y no se puede saber cuánto.
 */
export function estimatePrg(kg: number | null, reps: number | null): Estimate {
  if (kg === null || !(kg > 0)) return unavailable(METHOD_PRG, 'sin carga válida');
  if (reps === null || !Number.isInteger(reps) || reps < 1)
    return unavailable(METHOD_PRG, 'sin repeticiones válidas');
  const warn = [
    'No se conoce el esfuerzo: una serie submáxima subestima la fuerza máxima en una magnitud desconocida.',
  ];
  if (reps === 1)
    return {
      method: METHOD_PRG,
      value: kg,
      exact: kg,
      status: 'available',
      reason: null,
      warnings: ['Un single devuelve el peso levantado, no necesariamente el máximo.'],
    };
  if (reps < PRG_DOMAIN.minReps || reps > PRG_DOMAIN.maxReps)
    return unavailable(
      METHOD_PRG,
      `reps ${reps} fuera del dominio ${PRG_DOMAIN.minReps}–${PRG_DOMAIN.maxReps}`,
    );
  const f = prgFormulas(kg, reps);
  const exact = (f.epley + f.brzycki + f.lander + f.lombardi + f.mayhew + f.oconner) / 6;
  return {
    method: METHOD_PRG,
    value: Math.floor(exact + 0.5),
    exact,
    status: 'available',
    reason: null,
    warnings: warn,
  };
}
