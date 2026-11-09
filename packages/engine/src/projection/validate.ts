import { MODEL_IDS, fitModel, type ModelId, type TPoint } from './models.js';
import type { ProjectionConfig } from './config.js';

export interface Fold {
  originT: number;
  targetT: number;
  horizonDays: number;
  actual: number;
  /** Predicción de cada modelo (null = no ajustable). */
  pred: Record<ModelId, number | null>;
}
export interface FoldResult {
  folds: Fold[];
  origins: number;
  abstentions: { reason: string; count: number }[];
}

/**
 * Origen móvil EXPANSIVO. En cada origen (fecha de una exposición) se ajusta SOLO con puntos de fecha ≤ origen y se proyecta
 * al primer objetivo posterior cuya distancia en días reales está dentro de horizonte ± tolerancia (el más cercano al horizonte).
 * Los modelos se comparan en los MISMOS pliegues.
 */
export function rollingOrigin(points: TPoint[], horizonDays: number, cfg: ProjectionConfig): FoldResult {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const origins = [...new Set(sorted.map((p) => p.t))];
  const abst = new Map<string, number>();
  const bump = (r: string) => abst.set(r, (abst.get(r) ?? 0) + 1);
  const folds: Fold[] = [];
  for (const o of origins) {
    const train = sorted.filter((p) => p.t <= o);
    if (new Set(train.map((p) => p.t)).size < cfg.minTrainExposures) {
      bump('entrenamiento insuficiente en el origen');
      continue;
    }
    const cands = sorted
      .filter((p) => p.t > o && Math.abs(p.t - o - horizonDays) <= cfg.targetToleranceDays)
      .sort((a, b) => Math.abs(a.t - o - horizonDays) - Math.abs(b.t - o - horizonDays) || a.t - b.t);
    const target = cands[0];
    if (!target) {
      bump('sin observación posterior dentro del horizonte ± tolerancia');
      continue;
    }
    const pred = {} as Record<ModelId, number | null>;
    for (const id of MODEL_IDS) pred[id] = fitModel(id, train, cfg)?.predict(target.t) ?? null;
    if (MODEL_IDS.some((id) => pred[id] === null)) {
      bump('algún modelo no se pudo ajustar');
      continue;
    }
    folds.push({ originT: o, targetT: target.t, horizonDays: target.t - o, actual: target.y, pred });
  }
  return {
    folds,
    origins: origins.length,
    abstentions: [...abst.entries()].map(([reason, count]) => ({ reason, count })),
  };
}

const err = (f: Fold, id: ModelId): number => (f.pred[id] as number) - f.actual; // + = sobreestima

export interface ModelStats {
  id: ModelId | 'selector';
  n: number;
  maeKg: number | null;
  biasKg: number | null;
  diffMaeVsBaselineKg: number | null;
  wins: number;
  losses: number;
  ties: number;
}

const EPS = 1e-9;
export function stats(id: ModelId | 'selector', errs: number[], baseErrs: number[]): ModelStats {
  const n = errs.length;
  if (!n)
    return { id, n: 0, maeKg: null, biasKg: null, diffMaeVsBaselineKg: null, wins: 0, losses: 0, ties: 0 };
  const mae = errs.reduce((s, e) => s + Math.abs(e), 0) / n;
  const bmae = baseErrs.reduce((s, e) => s + Math.abs(e), 0) / n;
  let w = 0;
  let l = 0;
  let t = 0;
  errs.forEach((e, i) => {
    const d = Math.abs(e) - Math.abs(baseErrs[i] as number);
    if (d < -EPS) w++;
    else if (d > EPS) l++;
    else t++;
  });
  return {
    id,
    n,
    maeKg: mae,
    biasKg: errs.reduce((s, e) => s + e, 0) / n,
    diffMaeVsBaselineKg: mae - bmae,
    wins: w,
    losses: l,
    ties: t,
  };
}

/** Regla de selección: un modelo distinto del baseline solo gana con ≥ minEvaluations pliegues, MAE menor y más victorias que derrotas. */
export function selectModel(folds: Fold[], cfg: ProjectionConfig): ModelId {
  if (folds.length < cfg.minEvaluations) return 'baseline';
  const base = folds.map((f) => err(f, 'baseline'));
  let best: ModelId = 'baseline';
  let bestMae = base.reduce((s, e) => s + Math.abs(e), 0) / base.length;
  for (const id of ['linear', 'linear_weighted'] as const) {
    const e = folds.map((f) => err(f, id));
    const s = stats(id, e, base);
    if ((s.maeKg as number) < bestMae - EPS && s.wins > s.losses) {
      best = id;
      bestMae = s.maeKg as number;
    }
  }
  return best;
}

export interface Validation {
  evaluations: number;
  models: ModelStats[];
  selector: ModelStats;
  /** Modelo que eligió el selector en cada pliegue, usando SOLO pliegues cuyo objetivo ya era conocido en ese origen. */
  selectorChoices: { originT: number; chosen: ModelId }[];
  verdict: 'mejora_sobre_baseline' | 'sin_mejora' | 'no_concluyente' | 'sin_evaluaciones';
}

export function validate(folds: Fold[], cfg: ProjectionConfig): Validation {
  const base = folds.map((f) => err(f, 'baseline'));
  const models = MODEL_IDS.map((id) =>
    stats(
      id,
      folds.map((f) => err(f, id)),
      base,
    ),
  );
  // Selección ANIDADA: en el origen o solo se conocen los pliegues con objetivo ≤ o.
  const choices: { originT: number; chosen: ModelId }[] = [];
  const selErrs = folds.map((f) => {
    const known = folds.filter((g) => g.targetT <= f.originT);
    const chosen = selectModel(known, cfg);
    choices.push({ originT: f.originT, chosen });
    return err(f, chosen);
  });
  const selector = stats('selector', selErrs, base);
  const n = folds.length;
  let verdict: Validation['verdict'];
  if (n === 0) verdict = 'sin_evaluaciones';
  else if (n < cfg.minEvaluations) verdict = 'no_concluyente';
  else if ((selector.diffMaeVsBaselineKg as number) < -EPS && selector.wins > selector.losses)
    verdict = 'mejora_sobre_baseline';
  else verdict = 'sin_mejora';
  return { evaluations: n, models, selector, selectorChoices: choices, verdict };
}

/** Cuantil empírico por rango más cercano (nearest-rank). */
export function quantile(sortedAsc: number[], p: number): number {
  const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[i] as number;
}

export interface EmpiricalRange {
  lowerErr: number;
  upperErr: number;
}
/** Errores = pronóstico − real. Rango del real = pronóstico − [q_hi, q_lo]. */
export function empiricalRange(errors: number[], nominal: number): EmpiricalRange {
  const s = [...errors].sort((a, b) => a - b);
  const a = (1 - nominal) / 2;
  return { lowerErr: quantile(s, a), upperErr: quantile(s, 1 - a) };
}

/** Cobertura observada FUERA de muestra: el rango de cada pliegue se arma solo con errores de pliegues ya conocidos en ese origen. */
export function observedCoverage(
  folds: Fold[],
  chosenErr: (f: Fold) => number,
  cfg: ProjectionConfig,
): { coverage: number | null; sample: number } {
  let hits = 0;
  let n = 0;
  for (const f of folds) {
    const past = folds.filter((g) => g.targetT <= f.originT).map(chosenErr);
    if (past.length < cfg.minErrorsForRange) continue;
    const r = empiricalRange(past, cfg.rangeNominal);
    const e = chosenErr(f);
    n++;
    if (e >= r.lowerErr && e <= r.upperErr) hits++;
  }
  return { coverage: n ? hits / n : null, sample: n };
}

export interface Calibration {
  status: 'not_evaluable' | 'below_nominal' | 'at_or_above_nominal';
  nominal: number;
  observed: number | null;
  sample: number;
  minSample: number;
  shortfall: number | null;
  method: string;
}

/**
 * Estado de calibración del rango: compara la cobertura observada FUERA de muestra con la nominal. No recalibra ni ajusta el rango:
 * ajustar y evaluar sobre los mismos errores daría una cobertura circular. Cada pliegue se evaluó con un rango armado solo con errores ya conocidos.
 * Sin muestra suficiente, la cobertura no es evaluable (no se asume calibrada).
 */
export function calibrationOf(observed: number | null, sample: number, cfg: ProjectionConfig): Calibration {
  const base = {
    nominal: cfg.rangeNominal,
    observed,
    sample,
    minSample: cfg.minCoverageSample,
    method:
      'cobertura fuera de muestra: el rango de cada pliegue usa solo errores de pliegues con objetivo ya conocido; no se reajusta',
  };
  if (observed === null || sample < cfg.minCoverageSample)
    return { ...base, status: 'not_evaluable', shortfall: null };
  return observed < cfg.rangeNominal - EPS
    ? { ...base, status: 'below_nominal', shortfall: cfg.rangeNominal - observed }
    : { ...base, status: 'at_or_above_nominal', shortfall: null };
}
