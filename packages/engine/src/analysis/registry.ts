import { SI_MODEL } from '../si.js';
import type { WeekMetrics } from '../metrics.js';

/**
 * Registro ÚNICO de métricas de análisis: un solo espacio de ids para el motor, la API y la web.
 * Cada magnitud vive en exactamente UNA familia (una tarjeta con su tabla y su gráfico); la interfaz no declara métricas por su cuenta.
 */
export const ANALYSIS_VERSION_FRAME = 'analysis-frame-v1';

export type MetricGroup = 'volumen' | 'carga' | 'estres' | 'esfuerzo' | 'cumplimiento' | 'fuerza' | 'fatiga';

export interface AnalysisMetric {
  id: string;
  label: string;
  unit: string;
  group: MetricGroup;
  /** suma = se acumula en la ventana; media = promedio de series o semanas; razon = cociente. */
  kind: 'suma' | 'media' | 'razon';
  /** Familia de escala: valores de familias distintas NO se superponen ni se comparan en un mismo eje. */
  modelFamily: string | null;
  decimals: number;
  /** Existe una versión prevista (plan) comparable con la realizada. */
  hasPlan: boolean;
  /** Id de la fila equivalente en la comparación de bloques (`block-analysis`), si existe. */
  blockRow: string | null;
}

export const ANALYSIS_METRICS: AnalysisMetric[] = [
  {
    id: 'nl',
    label: 'NL (repeticiones)',
    unit: 'reps',
    group: 'volumen',
    kind: 'suma',
    modelFamily: null,
    decimals: 0,
    hasPlan: true,
    blockRow: 'nl_per_week',
  },
  {
    id: 'sets',
    label: 'Series',
    unit: 'series',
    group: 'volumen',
    kind: 'suma',
    modelFamily: null,
    decimals: 0,
    hasPlan: true,
    blockRow: 'sets_per_week',
  },
  {
    id: 'frequency',
    label: 'Frecuencia',
    unit: 'sesiones',
    group: 'volumen',
    kind: 'suma',
    modelFamily: null,
    decimals: 0,
    hasPlan: true,
    blockRow: 'frequency_per_week',
  },
  {
    id: 'nl_ratio',
    label: 'NL realizado / previsto',
    unit: '%',
    group: 'volumen',
    kind: 'razon',
    modelFamily: null,
    decimals: 0,
    hasPlan: false,
    blockRow: null,
  },
  {
    id: 'tonnage',
    label: 'Tonelaje',
    unit: 'kg',
    group: 'carga',
    kind: 'suma',
    modelFamily: null,
    decimals: 0,
    hasPlan: true,
    blockRow: 'tonnage_per_week',
  },
  {
    id: 'intensity_simple',
    label: 'Intensidad media (por serie)',
    unit: '%1RM',
    group: 'carga',
    kind: 'media',
    modelFamily: null,
    decimals: 1,
    hasPlan: true,
    blockRow: 'intensity_pct_sets',
  },
  {
    id: 'intensity_by_reps',
    label: 'Intensidad media (ponderada por reps)',
    unit: '%1RM',
    group: 'carga',
    kind: 'media',
    modelFamily: null,
    decimals: 1,
    hasPlan: true,
    blockRow: 'intensity_pct_reps',
  },
  {
    id: 'si_total',
    label: 'SI total',
    unit: 'SI',
    group: 'estres',
    kind: 'suma',
    modelFamily: SI_MODEL,
    decimals: 1,
    hasPlan: true,
    blockRow: 'si_total_per_week',
  },
  {
    id: 'si_central',
    label: 'SI central',
    unit: 'SI',
    group: 'estres',
    kind: 'suma',
    modelFamily: SI_MODEL,
    decimals: 1,
    hasPlan: true,
    blockRow: 'si_central_per_week',
  },
  {
    id: 'si_peripheral',
    label: 'SI periférico',
    unit: 'SI',
    group: 'estres',
    kind: 'suma',
    modelFamily: SI_MODEL,
    decimals: 1,
    hasPlan: true,
    blockRow: 'si_peripheral_per_week',
  },
  {
    id: 'rpe_mean',
    label: 'RPE medio',
    unit: 'RPE',
    group: 'esfuerzo',
    kind: 'media',
    modelFamily: null,
    decimals: 1,
    hasPlan: true,
    blockRow: 'rpe_mean',
  },
  {
    id: 'rpe_dev',
    label: 'RPE real − objetivo',
    unit: 'RPE',
    group: 'esfuerzo',
    kind: 'media',
    modelFamily: null,
    decimals: 1,
    hasPlan: false,
    blockRow: null,
  },
  {
    id: 'compliance_sets',
    label: 'Cumplimiento (series hechas / previstas)',
    unit: '%',
    group: 'cumplimiento',
    kind: 'razon',
    modelFamily: null,
    decimals: 0,
    hasPlan: false,
    blockRow: 'adherence_sets',
  },
  {
    id: 'e1rm',
    label: 'e1RM (mejor serie, curva RPE)',
    unit: 'kg',
    group: 'fuerza',
    kind: 'media',
    modelFamily: 'e1rm-curva',
    decimals: 1,
    hasPlan: true,
    blockRow: null,
  },
  {
    id: 'fatigue_end',
    label: 'Fatiga de fin de sesión',
    unit: '/10',
    group: 'fatiga',
    kind: 'media',
    modelFamily: null,
    decimals: 1,
    hasPlan: false,
    blockRow: null,
  },
];

const byId = new Map(ANALYSIS_METRICS.map((m) => [m.id, m]));
export const analysisMetric = (id: string): AnalysisMetric | undefined => byId.get(id);

/** Extractores de las métricas que salen de las series (previstas o realizadas) con las mismas reglas. */
export const SERIES_PICK: Record<string, (w: WeekMetrics) => number | null> = {
  nl: (w) => w.nl,
  sets: (w) => w.sets,
  frequency: (w) => w.frequency,
  tonnage: (w) => w.tonnage,
  intensity_simple: (w) => (w.meanPct === null ? null : 100 * w.meanPct),
  intensity_by_reps: (w) => (w.meanPctByReps === null ? null : 100 * w.meanPctByReps),
  rpe_mean: (w) => w.meanRpe,
  si_total: (w) => w.si?.total ?? null,
  si_central: (w) => w.si?.central ?? null,
  si_peripheral: (w) => w.si?.peripheral ?? null,
};
