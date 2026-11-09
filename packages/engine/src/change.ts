import type { LiftConfig } from './params.js';
import { f, signed } from './format.js';

export interface Change {
  defined: boolean;
  pct: number | null;
  kg: number;
  /** null si el cambio mínimo no está definido. Con % y kg definidos se exigen AMBOS. */
  exceeds: boolean | null;
}

/** ¿El cambio `delta` (kg) sobre `base` supera el cambio mínimo relevante del lift? */
export function evaluateChange(base: number, delta: number, cfg: LiftConfig): Change {
  const hasPct = cfg.minChangePct !== null && cfg.minChangePct > 0;
  const hasKg = cfg.minChangeKg !== null && cfg.minChangeKg > 0;
  const pct = base > 0 ? (100 * delta) / base : null;
  if (!hasPct && !hasKg) return { defined: false, pct, kg: delta, exceeds: null };
  const okPct = !hasPct || (pct !== null && Math.abs(pct) >= (cfg.minChangePct as number));
  const okKg = !hasKg || Math.abs(delta) >= (cfg.minChangeKg as number);
  return { defined: true, pct, kg: delta, exceeds: okPct && okKg };
}

export const changeText = (c: Change): string =>
  `${signed(c.kg, 1)} kg${c.pct === null ? '' : ` (${signed(c.pct, 1)} %)`}`;
export const kgText = (x: number): string => `${f(x, 1)} kg`;
