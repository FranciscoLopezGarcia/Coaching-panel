import type { Delta } from './contracts.js';

/**
 * Delta entre bloques vecinos. `pp` = la métrica ya es un % (intensidad): el delta absoluto son puntos porcentuales
 * y no se calcula porcentaje relativo. Falta de dato ≠ 0.
 */
export function delta(
  curr: number | null,
  prev: number | null,
  unit: string,
  opts: { pp?: boolean } = {},
): Delta {
  if (curr === null || prev === null || !Number.isFinite(curr) || !Number.isFinite(prev))
    return { abs: null, pct: null, unit, status: 'no_comparable' };
  const abs = curr - prev;
  if (opts.pp) return { abs, pct: null, unit, status: 'ok' };
  if (prev === 0) return { abs, pct: null, unit, status: curr === 0 ? 'sin_denominador' : 'nuevo' };
  return { abs, pct: (100 * abs) / prev, unit, status: 'ok' };
}
