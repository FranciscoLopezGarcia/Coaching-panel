/**
 * Proyección de rendimiento (EXPERIMENTAL). Todos los mínimos y límites son DECISIONES OPERATIVAS configurables [propuesta]:
 * no salen de una fuente validada ni de datos reales. Se centralizan aquí y se devuelven en `config` de cada resultado.
 */
export const PROJECTION_ENGINE_VERSION = 'proyeccion-v0.1-experimental';
export const PROJECTION_CONTRACT_VERSION = 'performance-projection-v1';
export const AGGREGATION_VERSION = 'exposure-agg-v1';
export const BASELINE_VERSION = 'baseline-nivel-reciente-v1';
export const LINEAR_VERSION = 'tendencia-lineal-v1';
export const WEIGHTED_VERSION = 'tendencia-lineal-ponderada-v1';

export type AggregateMode = 'best' | 'median';

export interface ProjectionConfig {
  /** Horizonte pedido, en días reales desde la ÚLTIMA exposición observada. */
  horizonDays: number;
  /** Exposiciones (fechas distintas) mínimas para proyectar. */
  minExposures: number;
  /** Extensión temporal mínima de la serie. */
  minSpanDays: number;
  /** Antigüedad máxima de la última exposición respecto al corte. */
  maxStalenessDays: number;
  /** Horizonte máximo absoluto. */
  maxHorizonDays: number;
  /** El horizonte no puede superar esta fracción de la extensión observada. */
  maxHorizonToSpanRatio: number;
  /** "Nivel reciente" = mediana de las últimas K exposiciones. */
  levelK: number;
  /** Semivida (días) de los pesos de la tendencia ponderada: peso = 0,5^(edad/semivida). */
  halfLifeDays: number;
  /** Atípico: |z robusto| (MAD) mayor que este valor. Se marca, NO se elimina. */
  outlierMadK: number;
  /** Exposiciones mínimas para evaluar atípicos. */
  minExposuresForOutlier: number;
  /** Tolerancia (días) al emparejar el objetivo de validación con el horizonte. */
  targetToleranceDays: number;
  /** Exposiciones mínimas de entrenamiento en cada origen de validación. */
  minTrainExposures: number;
  /** Evaluaciones mínimas para declarar mejora o elegir un modelo distinto del baseline. */
  minEvaluations: number;
  /** Errores fuera de muestra mínimos para construir un rango empírico. */
  minErrorsForRange: number;
  /** Cobertura nominal del rango empírico (p. ej. 0,8 = percentiles 10–90 de los errores). */
  rangeNominal: number;
  /** Casos fuera de muestra mínimos para evaluar la cobertura observada del rango. */
  minCoverageSample: number;
  aggregate: AggregateMode;
}

export const PROJECTION_DEFAULTS: ProjectionConfig = {
  horizonDays: 28,
  minExposures: 5,
  minSpanDays: 21,
  maxStalenessDays: 42,
  maxHorizonDays: 84,
  maxHorizonToSpanRatio: 0.5,
  levelK: 3,
  halfLifeDays: 28,
  outlierMadK: 3.5,
  minExposuresForOutlier: 6,
  targetToleranceDays: 7,
  minTrainExposures: 4,
  minEvaluations: 8,
  minErrorsForRange: 10,
  rangeNominal: 0.8,
  minCoverageSample: 10,
  aggregate: 'best',
};

export const PROJECTION_PARAM_DOCS: Record<keyof ProjectionConfig, { unit: string; note: string }> = {
  horizonDays: { unit: 'días', note: 'Horizonte pedido desde la última exposición observada.' },
  minExposures: {
    unit: 'exposiciones',
    note: 'Mínimo de fechas distintas para proyectar; menos ⇒ solo descriptivo.',
  },
  minSpanDays: { unit: 'días', note: 'Extensión mínima entre la primera y la última exposición.' },
  maxStalenessDays: {
    unit: 'días',
    note: 'Más antigua que esto, la última exposición se considera obsoleta.',
  },
  maxHorizonDays: { unit: 'días', note: 'Tope absoluto del horizonte.' },
  maxHorizonToSpanRatio: {
    unit: 'razón',
    note: 'El horizonte no puede superar esta fracción de la extensión observada.',
  },
  levelK: { unit: 'exposiciones', note: 'Nivel reciente = mediana de las últimas K exposiciones.' },
  halfLifeDays: { unit: 'días', note: 'Semivida de los pesos de la tendencia ponderada.' },
  outlierMadK: {
    unit: 'MAD robusto',
    note: 'Umbral de atípico; se marca y se informa sensibilidad, no se elimina.',
  },
  minExposuresForOutlier: { unit: 'exposiciones', note: 'Mínimo para evaluar atípicos.' },
  targetToleranceDays: {
    unit: 'días',
    note: 'Tolerancia al emparejar el objetivo con el horizonte en la validación.',
  },
  minTrainExposures: { unit: 'exposiciones', note: 'Entrenamiento mínimo en cada origen de validación.' },
  minEvaluations: {
    unit: 'evaluaciones',
    note: 'Mínimo para declarar mejora o elegir un modelo distinto del baseline.',
  },
  minErrorsForRange: { unit: 'errores', note: 'Mínimo de errores fuera de muestra para un rango empírico.' },
  rangeNominal: {
    unit: 'proporción',
    note: 'Cobertura nominal del rango empírico; no garantiza cobertura futura.',
  },
  minCoverageSample: {
    unit: 'casos',
    note: 'Casos fuera de muestra mínimos para evaluar la cobertura observada; menos ⇒ cobertura no evaluable.',
  },
  aggregate: { unit: '—', note: "Resumen de varias series por exposición: 'best' (mejor e1RM) o 'median'." },
};

export function buildProjectionConfig(over: Partial<ProjectionConfig> = {}): ProjectionConfig {
  const c = { ...PROJECTION_DEFAULTS };
  for (const [k, v] of Object.entries(over)) if (v !== undefined) (c as Record<string, unknown>)[k] = v;
  return c;
}

export function configProvenance(c: ProjectionConfig) {
  return (Object.keys(c) as (keyof ProjectionConfig)[]).map((id) => ({
    id,
    value: c[id],
    default: PROJECTION_DEFAULTS[id],
    overridden: c[id] !== PROJECTION_DEFAULTS[id],
    unit: PROJECTION_PARAM_DOCS[id].unit,
    note: PROJECTION_PARAM_DOCS[id].note,
    provenance: 'propuesta (decisión operativa configurable, no validada)',
  }));
}
