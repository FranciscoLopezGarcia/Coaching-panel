import { evaluateChange } from '../change.js';
import { daysBetween, isoToDays } from '../dates.js';
import type { ObservedSet } from '../observed.js';
import type { LiftConfig } from '../params.js';
import { referenceAt, type StrengthReference } from '../references.js';
import {
  AGGREGATION_VERSION,
  PROJECTION_CONTRACT_VERSION,
  PROJECTION_ENGINE_VERSION,
  buildProjectionConfig,
  configProvenance,
  type ProjectionConfig,
} from './config.js';
import {
  MODEL_IDS,
  MODEL_META,
  fitModel,
  flagOutliers,
  median,
  type ModelId,
  type TPoint,
} from './models.js';
import {
  availableVariants,
  buildExposureSeries,
  realMarks,
  VARIABLE_METHOD,
  type Exclusion,
  type ExposurePoint,
  type SeriesFilters,
  type Variable,
  type VariantInfo,
} from './series.js';
import { buildSummary, type ProjectionSummary } from './summary.js';
import {
  calibrationOf,
  empiricalRange,
  observedCoverage,
  rollingOrigin,
  selectModel,
  validate,
  type Fold,
  type Validation,
} from './validate.js';

export type ProjectionStatus = 'available' | 'descriptive_only' | 'unavailable';
export type ReasonCode =
  | 'variant_required'
  | 'no_data'
  | 'no_rpe'
  | 'insufficient_exposures'
  | 'insufficient_span'
  | 'stale_data'
  | 'horizon_exceeds_history'
  | 'outliers_flagged'
  | 'multiple_sources_same_date';

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysToIso = (t: number): string => new Date(t * 86_400_000).toISOString().slice(0, 10);
const r2 = (x: number): number => Math.round(x * 100) / 100;

export interface ProjectionInput {
  athleteId: string;
  obs: ObservedSet[];
  cutoff: string;
  filters: SeriesFilters;
  variable: Variable;
  config?: Partial<ProjectionConfig>;
  scope?: 'history' | 'view';
  view?: {
    kind: 'cutoff' | 'macro' | 'meso' | 'free';
    from: string | null;
    to: string | null;
    label?: string | null;
  };
  /** Cambio mínimo relevante del movimiento (única forma de clasificar la tendencia). */
  liftConfig?: LiftConfig | null;
  /** Alternativa: configuración por movimiento; se toma la del lift de la serie resuelta. */
  liftConfigs?: Partial<Record<string, LiftConfig>>;
  references?: StrengthReference[];
  /** Fecha en que cada serie quedó disponible en el sistema, cuando se conoce. */
  availableOn?: Map<string, string>;
}

export interface ProjectedPoint {
  date: string;
  value: number;
  exposureKey: string;
  setIds: string[];
  nSets: number;
  nEligibleSets: number;
  alternateValue: number;
  availableOn: string | null;
  inView: boolean;
  outlier: { flag: boolean; score: number | null };
}

export interface PerformanceProjection {
  contractVersion: string;
  engineVersion: string;
  status: ProjectionStatus;
  reasons: { code: ReasonCode; message: string }[];
  cutoff: string;
  periods: {
    observed: { from: string; to: string } | null;
    view: { kind: string; from: string | null; to: string | null; label: string | null };
    training: { from: string; to: string; scope: 'history' | 'view'; exposures: number; note: string } | null;
  };
  target: {
    athleteId: string;
    lift: string | null;
    exercise: string | null;
    variantKey: string | null;
    variable: Variable;
    unit: 'kg';
    method: { id: string; version: string };
    indicator: string;
  };
  selection: { filters: SeriesFilters & { plannedSetIds?: undefined }; availableVariants: VariantInfo[] };
  horizon: {
    requestedDays: number;
    effectiveDays: number | null;
    fromDate: string | null;
    forecastDate: string | null;
    maxAllowedDays: number | null;
    limitedBy: string | null;
  };
  aggregation: { id: string; mode: string; rule: string };
  observedPoints: ProjectedPoint[];
  fittedPoints: { date: string; value: number; modelId: ModelId }[];
  forecastPoints: {
    date: string;
    horizonDays: number;
    value: number;
    modelId: ModelId;
    rangeApplies: boolean;
  }[];
  baselineForecastPoints: { date: string; horizonDays: number; value: number; modelId: 'baseline' }[];
  forecastRange: {
    status: 'available' | 'unavailable';
    reason: string | null;
    method: string;
    nominalCoverage: number;
    observedCoverage: number | null;
    coverageSample: number;
    sampleSize: number;
    horizonToleranceDays: number;
    points: { date: string; lower: number; upper: number }[];
    notice: string;
    /** Siempre "no calibrado": el rango se arma con cuantiles de errores históricos; su cobertura se mide aparte y fuera de muestra. */
    label?: string;
    calibration?: {
      status: 'not_evaluable' | 'below_nominal' | 'at_or_above_nominal';
      nominal: number;
      observed: number | null;
      sample: number;
      minSample: number;
      shortfall: number | null;
      method: string;
    };
    warnings?: {
      code: 'coverage_below_nominal' | 'coverage_not_evaluable' | 'range_unavailable';
      message: string;
    }[];
  };
  model: {
    selected: { id: ModelId; version: string; label: string } | null;
    candidates: {
      id: ModelId;
      version: string;
      label: string;
      params: Record<string, number | string>;
      slopeKgPerWeek: number | null;
      levelKg: number;
    }[];
    level: { kg: number; definition: string; pointsUsed: number } | null;
    selectionRule: string;
    selectionBasis: { evaluationsUsed: number; minEvaluations: number };
  };
  validation: {
    scheme: string;
    horizonDays: number;
    toleranceDays: number;
    evaluations: number;
    models: Validation['models'];
    selector: Validation['selector'] | null;
    verdict: Validation['verdict'] | 'no_evaluable';
    coverage: { origins: number; evaluable: number; abstentions: { reason: string; count: number }[] };
    notes: string[];
  };
  dataQuality: {
    exposures: number;
    spanDays: number | null;
    lastExposureAgeDays: number | null;
    stale: boolean;
    irregularity: { medianGapDays: number | null; maxGapDays: number | null };
    outliers: {
      count: number;
      treatment: string;
      sensitivity: { forecastWithAllKg: number; forecastWithoutFlaggedKg: number; diffKg: number } | null;
    };
    missingRpeSets: number;
    sufficiency: 'suficiente' | 'parcial' | 'insuficiente';
    warnings: string[];
  };
  exclusions: Exclusion[];
  realMarks: { reps: number; kg: number; date: string; setId: string; rpe: number | null }[];
  reference: { exercise: string; kg: number; asOf: string; source: string } | null;
  summary: ProjectionSummary;
  limitations: string[];
  config: ReturnType<typeof configProvenance>;
}

const AGG_RULE =
  'Un punto por exposición (fuente+sesión+ejercicio+variante). Series elegibles: de trabajo, carga total conocida, con los datos que exige el método. Valor = mejor e1RM ("best") o mediana ("median") de esas series; la cantidad de series no pondera.';

const LIMITS = [
  'El indicador es un e1RM estimado del ejercicio/variante elegido: no equivale a un 1RM real, a un resultado de competencia ni al éxito de un intento.',
  'La proyección es condicional a que continúe el patrón observado; no considera cambios de volumen, intensidad, fatiga ni lesiones.',
  'No es un candidato a PR, una ventana de expresión ni un TTP: esos conceptos se calculan con otras reglas y pueden discrepar.',
  'Experimental: las decisiones operativas (mínimos y límites) no están validadas con datos reales.',
];

export function projectPerformance(input: ProjectionInput): PerformanceProjection {
  const cfg = buildProjectionConfig(input.config);
  const scope = input.scope ?? 'history';
  const { cutoff, variable } = input;
  const obs = input.obs.filter((o) => o.date <= cutoff);
  const reasons: PerformanceProjection['reasons'] = [];
  const method = VARIABLE_METHOD[variable];
  const view = {
    kind: input.view?.kind ?? 'cutoff',
    from: input.view?.from ?? null,
    to: input.view?.to ?? null,
    label: input.view?.label ?? null,
  };
  const variants = availableVariants(obs, input.filters, cutoff);
  const filters: SeriesFilters = { ...input.filters };
  const shell = (status: ProjectionStatus): PerformanceProjection => ({
    contractVersion: PROJECTION_CONTRACT_VERSION,
    engineVersion: PROJECTION_ENGINE_VERSION,
    status,
    reasons,
    cutoff,
    periods: { observed: null, view, training: null },
    target: {
      athleteId: input.athleteId,
      lift: input.filters.lift ?? null,
      exercise: input.filters.exercise ?? null,
      variantKey: input.filters.variantKey ?? null,
      variable,
      unit: 'kg',
      method: { id: method.id, version: method.version },
      indicator:
        variable === 'e1rm_table_rpe'
          ? 'e1RM por curva RPE (requiere RPE real)'
          : 'e1RM por fórmulas de repeticiones (sin RPE)',
    },
    selection: { filters: { ...filters, plannedSetIds: undefined }, availableVariants: variants },
    horizon: {
      requestedDays: cfg.horizonDays,
      effectiveDays: null,
      fromDate: null,
      forecastDate: null,
      maxAllowedDays: null,
      limitedBy: null,
    },
    aggregation: { id: AGGREGATION_VERSION, mode: cfg.aggregate, rule: AGG_RULE },
    observedPoints: [],
    fittedPoints: [],
    forecastPoints: [],
    baselineForecastPoints: [],
    forecastRange: {
      status: 'unavailable',
      reason: 'sin proyección',
      method: 'empirical-quantile-nearest-rank-v1',
      nominalCoverage: cfg.rangeNominal,
      observedCoverage: null,
      coverageSample: 0,
      sampleSize: 0,
      horizonToleranceDays: cfg.targetToleranceDays,
      points: [],
      notice:
        'Rango empírico de errores históricos fuera de muestra; no es un intervalo de confianza y no garantiza cobertura futura.',
      label: 'rango empírico no calibrado',
      calibration: calibrationOf(null, 0, cfg),
      warnings: [{ code: 'range_unavailable' as const, message: 'Sin proyección: no hay rango.' }],
    },
    model: {
      selected: null,
      candidates: [],
      level: null,
      selectionRule: `Un modelo distinto del baseline solo se muestra con ≥ ${cfg.minEvaluations} evaluaciones, y si el selector anidado (fuera de muestra) tiene MAE menor y más victorias que derrotas frente al baseline; si no, se mantiene el baseline como referencia.`,
      selectionBasis: { evaluationsUsed: 0, minEvaluations: cfg.minEvaluations },
    },
    validation: {
      scheme: 'origen móvil expansivo, horizonte en días reales desde la última exposición',
      horizonDays: cfg.horizonDays,
      toleranceDays: cfg.targetToleranceDays,
      evaluations: 0,
      models: [],
      selector: null,
      verdict: 'no_evaluable',
      coverage: { origins: 0, evaluable: 0, abstentions: [] },
      notes: [
        'Cada origen entrena solo con exposiciones de fecha ≤ origen; la selección de modelo usa solo pliegues con objetivo ya conocido en ese origen (selección anidada).',
        'Las fechas son las de EJECUCIÓN. Si no hay fecha de disponibilidad del registro, el replay no reconstruye exactamente qué sabía el coach en ese momento.',
      ],
    },
    dataQuality: {
      exposures: 0,
      spanDays: null,
      lastExposureAgeDays: null,
      stale: false,
      irregularity: { medianGapDays: null, maxGapDays: null },
      outliers: {
        count: 0,
        treatment: 'Los atípicos se marcan, no se eliminan; se informa la sensibilidad del pronóstico.',
        sensitivity: null,
      },
      missingRpeSets: 0,
      sufficiency: 'insuficiente',
      warnings: [],
    },
    exclusions: [],
    realMarks: [],
    reference: null,
    summary: buildSummary({
      status,
      reasons,
      trend: null,
      projection: null,
      target: null,
      cfgMin: cfg.minExposures,
    }),
    limitations: LIMITS,
    config: configProvenance(cfg),
  });

  // 1) variante: nunca se elige una por el usuario ni se mezclan
  const keys = new Set(variants.map((v) => `${v.exercise}|${v.variantKey}`));
  if (keys.size === 0) {
    reasons.push({ code: 'no_data', message: 'No hay series de trabajo para ese filtro hasta el corte.' });
    const out = shell('unavailable');
    out.summary = buildSummary({
      status: 'unavailable',
      reasons,
      trend: null,
      projection: null,
      target: null,
      cfgMin: cfg.minExposures,
    });
    return out;
  }
  if (keys.size > 1) {
    reasons.push({
      code: 'variant_required',
      message: `Hay ${keys.size} ejercicios/variantes bajo ese filtro; las variantes no son equivalentes. Elegí una (exercise + variantKey).`,
    });
    const out = shell('unavailable');
    out.summary = buildSummary({
      status: 'unavailable',
      reasons,
      trend: null,
      projection: null,
      target: null,
      cfgMin: cfg.minExposures,
    });
    return out;
  }
  const only = variants[0] as VariantInfo;
  filters.exercise = only.exercise;
  filters.variantKey = only.variantKey;

  // 2) serie por exposición
  const built = buildExposureSeries(obs, filters, variable, cfg.aggregate, cutoff);
  const out = shell('unavailable');
  out.target.lift = only.lift;
  out.target.exercise = only.exercise;
  out.target.variantKey = only.variantKey;
  out.selection.filters = { ...filters, plannedSetIds: undefined };
  out.exclusions = built.exclusions;
  out.realMarks = realMarks(obs, filters, cutoff);
  const ref = (input.references ?? []).length
    ? referenceAt(input.references ?? [], only.exercise, cutoff)
    : null;
  out.reference = ref ? { exercise: ref.exerciseName, kg: ref.kg, asOf: ref.asOf, source: ref.source } : null;
  out.dataQuality.missingRpeSets = built.missingRpeSets;
  if (!built.points.length) {
    reasons.push(
      variable === 'e1rm_table_rpe' && built.missingRpeSets > 0
        ? {
            code: 'no_rpe',
            message:
              'Ninguna serie tiene RPE real: no hay e1RM por curva. Probá e1rm_prg_formulas (otro método, no comparable).',
          }
        : { code: 'no_data', message: 'Ninguna serie elegible para este método.' },
    );
    out.summary = buildSummary({
      status: 'unavailable',
      reasons,
      trend: null,
      projection: null,
      target: null,
      cfgMin: cfg.minExposures,
    });
    return out;
  }

  // 3) entrenamiento: historia completa ≤ corte o solo la vista (explícito)
  const inView = (d: string) => (view.from === null || d >= view.from) && (view.to === null || d <= view.to);
  const trainPts: ExposurePoint[] =
    scope === 'view' ? built.points.filter((p) => inView(p.date)) : built.points;
  const tp: TPoint[] = trainPts.map((p) => ({ t: isoToDays(p.date), y: p.value }));
  const flags = flagOutliers(tp, cfg);
  out.observedPoints = trainPts.map((p, i) => ({
    date: p.date,
    value: r2(p.value),
    exposureKey: p.exposureKey,
    setIds: p.setIds,
    nSets: p.nSets,
    nEligibleSets: p.nEligibleSets,
    alternateValue: r2(p.alternateValue),
    availableOn: (() => {
      const ds = p.setIds.map((id) => input.availableOn?.get(id));
      return ds.length && ds.every((d) => d) ? ((ds as string[]).sort().at(-1) ?? null) : null;
    })(),
    inView: inView(p.date),
    outlier: flags[i] as { flag: boolean; score: number | null },
  }));
  if (!trainPts.length) {
    reasons.push({ code: 'no_data', message: 'No hay exposiciones en el período de entrenamiento elegido.' });
    out.summary = buildSummary({
      status: 'unavailable',
      reasons,
      trend: null,
      projection: null,
      target: null,
      cfgMin: cfg.minExposures,
    });
    return out;
  }
  const dates = [...new Set(trainPts.map((p) => p.date))].sort();
  const first = dates[0] as string;
  const last = dates.at(-1) as string;
  const span = daysBetween(last, first);
  const age = daysBetween(cutoff, last);
  const gaps = dates.slice(1).map((d, i) => daysBetween(d, dates[i] as string));
  const sources = new Map<string, Set<string>>();
  for (const p of trainPts) sources.set(p.date, (sources.get(p.date) ?? new Set()).add(p.source));
  const multi = [...sources.values()].some((s) => s.size > 1);
  out.periods.observed = { from: first, to: last };
  out.periods.training = {
    from: first,
    to: last,
    scope,
    exposures: dates.length,
    note:
      scope === 'history'
        ? 'Se ajusta con toda la historia disponible hasta el corte, incluso la anterior al período mostrado.'
        : 'Se ajusta solo con las exposiciones del período de la vista.',
  };
  const stale = age > cfg.maxStalenessDays;
  const flagged = flags.filter((f) => f.flag).length;
  out.dataQuality = {
    ...out.dataQuality,
    exposures: dates.length,
    spanDays: span,
    lastExposureAgeDays: age,
    stale,
    irregularity: {
      medianGapDays: gaps.length ? median(gaps) : null,
      maxGapDays: gaps.length ? Math.max(...gaps) : null,
    },
    outliers: { ...out.dataQuality.outliers, count: flagged },
    warnings: [
      ...(variable === 'e1rm_prg_formulas'
        ? [
            'Método por fórmulas sin RPE: una serie submáxima subestima la fuerza máxima en una magnitud desconocida; no se interpreta como test máximo.',
          ]
        : []),
      ...(multi ? ['Hay fechas con exposiciones de más de una fuente: no se deduplican entre fuentes.'] : []),
    ],
    sufficiency:
      dates.length >= cfg.minExposures && span >= cfg.minSpanDays && !stale
        ? 'suficiente'
        : dates.length >= 3
          ? 'parcial'
          : 'insuficiente',
  };
  if (multi)
    reasons.push({
      code: 'multiple_sources_same_date',
      message: 'Hay fechas con exposiciones de más de una fuente.',
    });
  if (flagged)
    reasons.push({
      code: 'outliers_flagged',
      message: `${flagged} exposición(es) marcadas como atípicas (no eliminadas).`,
    });

  // 4) tendencia descriptiva (lineal sobre el período de entrenamiento), solo con ≥ 3 fechas
  const lin = dates.length >= 3 ? fitModel('linear', tp, cfg) : null;
  const trend = lin
    ? (() => {
        const change = (lin.slopePerDay as number) * Math.max(span, 1);
        const base = lin.predict(isoToDays(first));
        const lc = input.liftConfig ?? (only.lift ? input.liftConfigs?.[only.lift] : null) ?? null;
        const ch = lc ? evaluateChange(base, change, lc) : null;
        return {
          slopeKgPerWeek: (lin.slopePerDay as number) * 7,
          changeKg: change,
          spanDays: span,
          exposures: dates.length,
          classified:
            ch && ch.defined
              ? ch.exceeds
                ? change > 0
                  ? ('ascendente' as const)
                  : ('descendente' as const)
                : ('estable' as const)
              : null,
        };
      })()
    : null;

  // 5) condiciones para proyectar
  const maxAllowed = Math.max(0, Math.min(cfg.maxHorizonDays, Math.floor(cfg.maxHorizonToSpanRatio * span)));
  out.horizon.maxAllowedDays = maxAllowed;
  let blocked = false;
  if (dates.length < cfg.minExposures) {
    reasons.push({
      code: 'insufficient_exposures',
      message: `Hay ${dates.length} exposiciones; el mínimo operativo es ${cfg.minExposures}.`,
    });
    blocked = true;
  }
  if (span < cfg.minSpanDays) {
    reasons.push({
      code: 'insufficient_span',
      message: `La serie abarca ${span} días; el mínimo operativo es ${cfg.minSpanDays}.`,
    });
    blocked = true;
  }
  if (stale) {
    reasons.push({
      code: 'stale_data',
      message: `La última exposición tiene ${age} días de antigüedad (máximo operativo ${cfg.maxStalenessDays}).`,
    });
    blocked = true;
  }
  if (cfg.horizonDays > maxAllowed) {
    out.horizon.limitedBy = cfg.horizonDays > cfg.maxHorizonDays ? 'maxHorizonDays' : 'maxHorizonToSpanRatio';
    reasons.push({
      code: 'horizon_exceeds_history',
      message: `El horizonte pedido (${cfg.horizonDays} d) supera el máximo permitido por el historial (${maxAllowed} d).`,
    });
    blocked = true;
  }
  if (blocked) {
    out.status = 'descriptive_only';
    out.summary = buildSummary({
      status: 'descriptive_only',
      reasons,
      trend,
      projection: null,
      target: targetOf(out),
      cfgMin: cfg.minExposures,
    });
    return out;
  }

  // 6) validación temporal, selección, pronóstico, rango
  const fr = rollingOrigin(tp, cfg.horizonDays, cfg);
  const val = validate(fr.folds, cfg);
  // Se muestra un modelo distinto del baseline SOLO si la validación anidada (fuera de muestra) confirma que lo mejora; si no, el baseline es la referencia.
  const chosen: ModelId = val.verdict === 'mejora_sobre_baseline' ? selectModel(fr.folds, cfg) : 'baseline';
  const tLast = isoToDays(last);
  const fit = fitModel(chosen, tp, cfg);
  const baseFit = fitModel('baseline', tp, cfg);
  if (!fit || !baseFit) {
    out.status = 'descriptive_only';
    reasons.push({
      code: 'insufficient_exposures',
      message: 'No se pudo ajustar el modelo (todas las exposiciones en el mismo día).',
    });
    out.summary = buildSummary({
      status: 'descriptive_only',
      reasons,
      trend,
      projection: null,
      target: targetOf(out),
      cfgMin: cfg.minExposures,
    });
    return out;
  }
  const H = cfg.horizonDays;
  const meta = MODEL_META[chosen];
  out.status = 'available';
  out.horizon = { ...out.horizon, effectiveDays: H, fromDate: last, forecastDate: addDays(last, H) };
  out.fittedPoints = dates.map((d) => ({ date: d, value: r2(fit.predict(isoToDays(d))), modelId: chosen }));
  const steps = [
    ...new Set([0, ...Array.from({ length: Math.floor(H / 7) }, (_, i) => (i + 1) * 7), H]),
  ].sort((a, b) => a - b);
  out.forecastPoints = steps.map((h) => ({
    date: daysToIso(tLast + h),
    horizonDays: h,
    value: r2(fit.predict(tLast + h)),
    modelId: chosen,
    rangeApplies: h === H,
  }));
  out.baselineForecastPoints = steps.map((h) => ({
    date: daysToIso(tLast + h),
    horizonDays: h,
    value: r2(baseFit.predict(tLast + h)),
    modelId: 'baseline' as const,
  }));
  out.model = {
    ...out.model,
    selected: { id: chosen, version: meta.version, label: meta.label },
    candidates: MODEL_IDS.map((id) => {
      const f = fitModel(id, tp, cfg);
      return {
        id,
        version: MODEL_META[id].version,
        label: MODEL_META[id].label,
        params: f?.params ?? {},
        slopeKgPerWeek: f?.slopePerDay != null ? f.slopePerDay * 7 : null,
        levelKg: r2(f?.levelKg ?? 0),
      };
    }),
    level: {
      kg: r2(baseFit.levelKg),
      definition: `mediana de las últimas ${cfg.levelK} exposiciones`,
      pointsUsed: Math.min(cfg.levelK, dates.length),
    },
    selectionBasis: { evaluationsUsed: fr.folds.length, minEvaluations: cfg.minEvaluations },
  };
  out.validation = {
    ...out.validation,
    evaluations: val.evaluations,
    models: val.models,
    selector: val.selector,
    verdict: val.verdict,
    coverage: { origins: fr.origins, evaluable: fr.folds.length, abstentions: fr.abstentions },
  };
  const chosenErr = (f: Fold) => (f.pred[chosen] as number) - f.actual;
  const errs = fr.folds.map(chosenErr);
  out.forecastRange.sampleSize = errs.length;
  if (errs.length >= cfg.minErrorsForRange) {
    const rg = empiricalRange(errs, cfg.rangeNominal);
    const v = fit.predict(tLast + H);
    const cov = observedCoverage(fr.folds, chosenErr, cfg);
    const calib = calibrationOf(cov.coverage, cov.sample, cfg);
    out.forecastRange = {
      ...out.forecastRange,
      status: 'available',
      reason: null,
      observedCoverage: cov.coverage,
      coverageSample: cov.sample,
      calibration: calib,
      warnings:
        calib.status === 'below_nominal'
          ? [
              {
                code: 'coverage_below_nominal',
                message: `La cobertura observada fuera de muestra (${Math.round((calib.observed as number) * 100)} % en ${calib.sample} casos) es menor que la nominal (${Math.round(calib.nominal * 100)} %): el rango es optimista y no está calibrado.`,
              },
            ]
          : calib.status === 'not_evaluable'
            ? [
                {
                  code: 'coverage_not_evaluable',
                  message: `No hay casos suficientes para evaluar la cobertura (${calib.sample} de ${calib.minSample}): el rango no está calibrado.`,
                },
              ]
            : [],
      points: [{ date: daysToIso(tLast + H), lower: r2(v - rg.upperErr), upper: r2(v - rg.lowerErr) }],
    };
  } else {
    out.forecastRange.warnings = [
      {
        code: 'range_unavailable',
        message: 'Errores fuera de muestra insuficientes para un rango empírico.',
      },
    ];
    out.forecastRange.reason = `Errores fuera de muestra insuficientes (${errs.length} de ${cfg.minErrorsForRange} requeridos): rango no disponible.`;
  }
  // sensibilidad a atípicos: mismo modelo sin las exposiciones marcadas
  if (flagged) {
    const keep = tp.filter((_, i) => !flags[i]?.flag);
    const f2 = fitModel(chosen, keep, cfg);
    if (f2) {
      const a = fit.predict(tLast + H);
      const b = f2.predict(tLast + H);
      out.dataQuality.outliers.sensitivity = {
        forecastWithAllKg: r2(a),
        forecastWithoutFlaggedKg: r2(b),
        diffKg: r2(b - a),
      };
    }
  }
  out.summary = buildSummary({
    status: 'available',
    reasons,
    trend,
    projection: {
      modelId: chosen,
      label: meta.label,
      valueKg: fit.predict(tLast + H),
      baselineKg: baseFit.predict(tLast + H),
      horizonDays: H,
      date: addDays(last, H),
      verdict: val.verdict,
      evaluations: val.evaluations,
      range: out.forecastRange.status === 'available' ? (out.forecastRange.points[0] ?? null) : null,
      calibration: out.forecastRange.status === 'available' ? (out.forecastRange.calibration ?? null) : null,
    },
    target: targetOf(out),
    cfgMin: cfg.minExposures,
  });
  return out;
}

function targetOf(o: PerformanceProjection) {
  return {
    exercise: o.target.exercise ?? '',
    variantKey: o.target.variantKey ?? '',
    indicator: o.target.indicator,
  };
}
