import { prgFormulas } from '../e1rm-methods.js';

/**
 * Tablas de RM por FÓRMULAS (PRG): % del 1RM que cada fórmula asigna a n repeticiones (carga constante w → 1RM estimado ⇒ %1RM = w / 1RM).
 *  - Dominio de la app PRG: reps 2–10 (con reps = 1 el e1RM es el peso). [recuperado]
 *  - Fuera de ese dominio la fórmula sigue existiendo matemáticamente hasta donde no se indefine (Brzycki y Lander se indefinen cerca de 37 reps):
 *    se informa como 'extrapolacion-matematica': PRG NO la usa y el proyecto tampoco por defecto.
 */
export const FORMULA_TABLE_VERSION = 'prg-formulas-v1';
export const FORMULA_MAX_REPS = 36;
export type FormulaName = 'epley' | 'brzycki' | 'lander' | 'lombardi' | 'mayhew' | 'oconner';
export const FORMULA_NAMES: FormulaName[] = ['epley', 'brzycki', 'lander', 'lombardi', 'mayhew', 'oconner'];

export interface FormulaRow {
  reps: number;
  origin: 'app-prg' | 'trivial' | 'extrapolacion-matematica';
  /** % del 1RM (0–100) por fórmula; null si la fórmula no está definida para esas repeticiones. */
  pct: Record<FormulaName, number | null>;
  /** % implícito del promedio de las seis (100 / promedio de los 1RM estimados con w = 100). null si alguna no está definida. */
  pctAverage: number | null;
  /** Factor multiplicador del peso para estimar el 1RM (promedio). */
  factorAverage: number | null;
}

export function formulaTable(): { version: string; rows: FormulaRow[] } {
  const rows: FormulaRow[] = [];
  for (let n = 1; n <= FORMULA_MAX_REPS; n++) {
    const f = prgFormulas(100, n);
    const est = FORMULA_NAMES.map((k) => f[k]);
    const ok = est.every((v) => Number.isFinite(v) && v > 0 && v >= 99.9);
    const pct = Object.fromEntries(
      FORMULA_NAMES.map((k) => [
        k,
        Number.isFinite(f[k]) && f[k] > 0 && (k !== 'brzycki' || n < 37)
          ? Math.round((10000 / f[k]) * 100) / 100
          : null,
      ]),
    ) as Record<FormulaName, number | null>;
    const avg = ok ? est.reduce((a, b) => a + b, 0) / 6 : null;
    rows.push({
      reps: n,
      origin: n === 1 ? 'trivial' : n <= 10 ? 'app-prg' : 'extrapolacion-matematica',
      pct,
      pctAverage: avg ? Math.round((10000 / avg) * 100) / 100 : null,
      factorAverage: avg ? Math.round((avg / 100) * 10000) / 10000 : null,
    });
  }
  return { version: FORMULA_TABLE_VERSION, rows };
}
