import chart from './data/curva-rpe.json' with { type: 'json' };
import measured from './data/si-doble-medido.json' with { type: 'json' };

/**
 * Stress Index por serie — modelo "si-doble-v1": reproduce un modelo de SI doble medido. Valores MEDIDOS (170 combinaciones) y, fuera de ellas,
 * fórmula con constantes AJUSTADAS (error ≤ 0,02 contra las mediciones; ver `SI_REVISION`). No es una fórmula publicada (el modelo original no la expone)
 * ni se mezcla con el Stress Index relativo a la referencia o el Carga de esfuerzo (XL).
 * Depende solo de reps y RPE (no del peso absoluto). Central ≈ intensidad; periférico ≈ repeticiones efectivas.
 */
export const SI_MODEL = 'si-doble-v1';
const CS_A = 2.4798;
const CS_B = 14.7239;
const PS_C = 0.5386;
const PS_BETA = 0.2151;
const CHART = (chart as { values: number[] }).values; // h = 1, 1.5, …, 50 repeticiones al fallo

/** Fracción del 1RM para h repeticiones al fallo (interpolación lineal; acotada a 1–50). */
export function pctChart(h: number): number {
  const hh = Math.min(Math.max(h, 1), 50);
  const x = (hh - 1) * 2;
  const i = Math.floor(x);
  if (i >= CHART.length - 1) return CHART[CHART.length - 1] as number;
  const f = x - i;
  return (CHART[i] as number) * (1 - f) + (CHART[i + 1] as number) * f;
}

export interface Stress {
  central: number;
  peripheral: number;
  total: number;
}

/**
 * Revisión del cálculo del SI doble (el id del modelo se mantiene: 'si-doble-v1'):
 *  r2 — (1) las combinaciones MEDIDAS (170: reps 1–50 × RPE 1–10, w = 100) devuelven el valor medido, exacto a 2 decimales;
 *       (2) fuera de ellas rige la fórmula, ahora con el periférico acotado a RIR ≤ 5 (para RPE < 5 el término de decaimiento deja de crecer;
 *           sin esa cota el periférico subestimaba hasta 0,30). Error de la fórmula contra las 170 mediciones: central ≤ 0,016, periférico ≤ 0,006, total ≤ 0,010.
 *  r1 — (anterior) fórmula sin cota: error máximo 0,30 en el periférico a RPE bajo.
 */
export const SI_REVISION = 'si-doble-r2';
/** RIR máximo que entra en el decaimiento del periférico (ajustado a las mediciones: con 5 el error cae a ≈ 0,006). */
const PS_K0_MAX = 5;
const MEASURED = new Map(
  (
    measured as { cells: { reps: number; rpe: number; central: number; peripheral: number; total: number }[] }
  ).cells.map((c) => [`${c.reps}|${c.rpe}`, c]),
);

/** Solo la fórmula ajustada (sin usar las mediciones): sirve para validar la aproximación. */
export function stressOfSetFormula(reps: number, rpe: number): Stress {
  const pct = pctChart(reps + (10 - rpe));
  const k0 = Math.min(10 - rpe, PS_K0_MAX);
  const n = Math.round(reps);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.exp(-PS_BETA * (k0 + i));
  const central = n * CS_A * Math.exp(-CS_B * (1 - pct));
  const peripheral = PS_C * pct * sum;
  return { central, peripheral, total: (central + peripheral) / 2 };
}

/** SI de una serie: valor medido si la combinación (reps, RPE) fue medida; si no, la fórmula ajustada. */
export function stressOfSet(reps: number, rpe: number): Stress {
  const m = Number.isInteger(reps) ? MEASURED.get(`${reps}|${rpe}`) : undefined;
  if (m) return { central: m.central, peripheral: m.peripheral, total: m.total };
  return stressOfSetFormula(reps, rpe);
}

export const addStress = (a: Stress, b: Stress): Stress => ({
  central: a.central + b.central,
  peripheral: a.peripheral + b.peripheral,
  total: a.total + b.total,
});
export const zeroStress = (): Stress => ({ central: 0, peripheral: 0, total: 0 });

/** Carga de esfuerzo (XL) [recuperado]: peso · Σ e^(−0,215·(RIR + reps − t)); RIR = 10 − RPE real (decisión del proyecto). Escala propia: NO comparable con SI. */
export const SI_MODEL_EFFORT = 'carga-esfuerzo-v1';
export function effortLoad(kg: number, reps: number, rpe: number): number {
  const rir = 10 - rpe;
  const n = Math.round(reps);
  let sum = 0;
  for (let k = 1; k <= n; k++) sum += Math.exp(-0.215 * (rir + n - k));
  return kg * sum;
}

/** Stress Index relativo a la referencia [recuperado]: t³·(RPE/10) + (reps/5)·t², t = kg/ref. Escala propia. Requiere RPE real (no se usa un RPE implícito). */
export const SI_MODEL_REL = 'si-carga-rel-v1';
export function stressIndexRel(kg: number, reps: number, rpe: number, ref: number): number | null {
  if (!(ref > 0) || !(kg > 0) || !(reps > 0) || !(rpe > 0 && rpe <= 10)) return null;
  const t = kg / ref;
  return Math.pow(t, 3) * (rpe / 10) + (reps / 5) * t * t;
}
