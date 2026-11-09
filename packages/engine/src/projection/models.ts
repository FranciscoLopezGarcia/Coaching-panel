import { BASELINE_VERSION, LINEAR_VERSION, WEIGHTED_VERSION, type ProjectionConfig } from './config.js';

/** Punto de entrenamiento: eje = TIEMPO REAL (días civiles), no el número de exposición. */
export interface TPoint {
  t: number;
  y: number;
}
export type ModelId = 'baseline' | 'linear' | 'linear_weighted';
export const MODEL_IDS: ModelId[] = ['baseline', 'linear', 'linear_weighted'];
export const MODEL_META: Record<ModelId, { version: string; label: string }> = {
  baseline: { version: BASELINE_VERSION, label: 'Mantiene el nivel reciente' },
  linear: { version: LINEAR_VERSION, label: 'Tendencia lineal' },
  linear_weighted: { version: WEIGHTED_VERSION, label: 'Tendencia lineal con más peso a lo reciente' },
};

export interface Fit {
  id: ModelId;
  predict: (t: number) => number;
  slopePerDay: number | null;
  levelKg: number;
  params: Record<string, number | string>;
}

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Nivel reciente: mediana de las últimas K exposiciones (por tiempo). */
export function recentLevel(pts: TPoint[], k: number): { kg: number; used: number } {
  const last = [...pts].sort((a, b) => a.t - b.t).slice(-Math.max(1, k));
  return { kg: median(last.map((p) => p.y)), used: last.length };
}

function wls(pts: TPoint[], w: number[]): { a: number; b: number } | null {
  const sw = w.reduce((s, x) => s + x, 0);
  if (!(sw > 0) || new Set(pts.map((p) => p.t)).size < 2) return null;
  const mt = pts.reduce((s, p, i) => s + (w[i] as number) * p.t, 0) / sw;
  const my = pts.reduce((s, p, i) => s + (w[i] as number) * p.y, 0) / sw;
  let sxx = 0;
  let sxy = 0;
  pts.forEach((p, i) => {
    sxx += (w[i] as number) * (p.t - mt) ** 2;
    sxy += (w[i] as number) * (p.t - mt) * (p.y - my);
  });
  if (!(sxx > 0)) return null;
  const b = sxy / sxx;
  return { b, a: my - b * mt };
}

/** Ajusta un modelo con SOLO los puntos dados. Devuelve null si el modelo no se puede ajustar (pocos puntos / mismo día). */
export function fitModel(id: ModelId, pts: TPoint[], cfg: ProjectionConfig): Fit | null {
  if (!pts.length) return null;
  const lvl = recentLevel(pts, cfg.levelK);
  if (id === 'baseline')
    return {
      id,
      predict: () => lvl.kg,
      slopePerDay: 0,
      levelKg: lvl.kg,
      params: { levelK: cfg.levelK, pointsUsed: lvl.used },
    };
  const tLast = Math.max(...pts.map((p) => p.t));
  const w =
    id === 'linear' ? pts.map(() => 1) : pts.map((p) => Math.pow(0.5, (tLast - p.t) / cfg.halfLifeDays));
  const f = wls(pts, w);
  if (!f) return null;
  return {
    id,
    predict: (t) => f.a + f.b * t,
    slopePerDay: f.b,
    levelKg: f.a + f.b * tLast,
    params: id === 'linear' ? {} : { halfLifeDays: cfg.halfLifeDays },
  };
}

/** Atípicos por residuo robusto (MAD) respecto de la tendencia lineal. SOLO marca; nunca elimina. */
export function flagOutliers(
  pts: TPoint[],
  cfg: ProjectionConfig,
): { flag: boolean; score: number | null }[] {
  const none = pts.map(() => ({ flag: false, score: null as number | null }));
  if (pts.length < cfg.minExposuresForOutlier) return none;
  const f = fitModel('linear', pts, cfg);
  if (!f) return none;
  const res = pts.map((p) => p.y - f.predict(p.t));
  const med = median(res);
  const mad = median(res.map((r) => Math.abs(r - med)));
  if (!(mad > 0)) return none;
  return res.map((r) => {
    const z = (0.6745 * (r - med)) / mad;
    return { flag: Math.abs(z) > cfg.outlierMadK, score: Math.round(z * 100) / 100 };
  });
}
