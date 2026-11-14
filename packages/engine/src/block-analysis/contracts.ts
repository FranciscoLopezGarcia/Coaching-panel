/** Contratos del Analizador integral de bloques (spec BASE_Analizador_Bloques_v1). Solo lectura: no prescribe ni predice. */
import type { BlockCompliance } from './compliance.js';
import type { IntensityZones } from './zones.js';
import type { Lift } from '../types.js';

export const ANALYSIS_VERSION = 'block-analysis-v1';

export type DeltaStatus =
  | 'ok'
  | 'nuevo' // 0 → x conocido: se muestra +x, porcentaje null
  | 'sin_denominador'
  | 'no_comparable' // falta alguno de los dos valores
  | 'incompatible_metric_family';

export interface Delta {
  abs: number | null;
  pct: number | null;
  unit: string;
  status: DeltaStatus;
}

export interface BlockCard {
  blockKey: string;
  /** Posición en la ventana: 0 = B0 (referencia), hasta 3 = bloque actual. */
  index: number;
  start: string;
  end: string;
  weeks: number;
  /** El bloque terminó antes del corte. */
  closed: boolean;
}

export interface BlockWindow {
  asOf: string;
  currentBlockKey: string;
  blocks: BlockCard[];
  /** Hay menos de 4 bloques: la ventana es parcial (no se inventan bloques vacíos). */
  partial: boolean;
}

export type MetricSource = 'planned' | 'actual';

export interface MetricRow {
  metricId: string;
  unit: string;
  /** Valor por bloque (alineado con `window.blocks`); null = sin dato (nunca 0 por ausencia). */
  values: (number | null)[];
  /** Deltas consecutivos: deltas[i] = bloque i+1 vs bloque i. */
  deltas: Delta[];
  /** Familia del modelo (SI) para no comparar escalas distintas. */
  modelFamily: string | null;
}

export type ExerciseEvent =
  'new_variant' | 'removed_variant' | 'resumed_variant' | 'role_change' | 'priority_change' | 'slot_change';

export interface ExerciseChange {
  variantKey: string;
  exposureId: string;
  fromBlock: string;
  toBlock: string;
  event: ExerciseEvent;
  detail: string | null;
}

export interface VariantWeekPoint {
  week: number;
  /** Máximo semanal observado de e1RM (tabla RPE, RPE real). */
  e1rm: number;
  /** Exposiciones (sesiones) que sustentan el punto. */
  n: number;
  lastDate: string;
  rpeMin: number;
  rpeMax: number;
}

export type BestStatus =
  'not_observed' | 'observed_but_sparse' | 'best_observed_open' | 'best_observed_delimited';

export interface VariantPerformance {
  lift: Lift;
  variantKey: string;
  exerciseName: string;
  blockKey: string;
  source: 'actual';
  /** Semanas sin benchmark comparable: hueco, ni 0 ni interpolación. */
  weekly: VariantWeekPoint[];
  bestKg: number | null;
  bestWeek: number | null;
  bestDate: string | null;
  /** Fechas de todas las exposiciones empatadas en el máximo. */
  tiedDates: string[];
  status: BestStatus;
  methodId: 'e1rm_table_rpe';
}

/** Calidad/cobertura de la ejecución de un bloque hasta el corte. Sin registro ≠ omitida ≠ cero. */
export interface BlockQuality {
  blockKey: string;
  /** Series de trabajo previstas con fecha <= corte. */
  planned: number;
  done: number;
  skipped: number;
  /** Previstas sin registro: faltante, no se cuenta como omitidas. */
  unknown: number;
  /** (done+skipped)/planned. */
  coverage: number | null;
  /** done/(done+skipped): cumplimiento sobre lo conocido. */
  adherence: number | null;
}

/** Estructura de un ejercicio dentro de un bloque (vista Movimiento / Prioridad / Variante). */
export interface ExerciseCard {
  blockKey: string;
  lift: Lift;
  variantKey: string;
  exerciseName: string;
  exposureId: string;
  role: string | null;
  priority: number | null;
  /** Firma estructurada del protocolo (sin texto libre). */
  protocol: string | null;
  sets: number;
  nl: number;
  setsPerWeek: number;
  nlPerWeek: number;
  /** %1RM medio por serie (con referencia fechada); null si falta. */
  intensityPct: number | null;
  sessionsPerWeek: number;
  tonnage: number | null;
}

export interface BlockComparison {
  version: typeof ANALYSIS_VERSION;
  source: MetricSource;
  window: BlockWindow;
  lift: Lift | 'ALL';
  rows: MetricRow[];
  changes: ExerciseChange[];
  quality: BlockQuality[];
  cards: ExerciseCard[];
  variants: VariantPerformance[];
  /** Distribución de series/repeticiones por zonas de %1RM por bloque (descriptiva, cortes del coach). */
  zones: IntensityZones;
  /** Cumplimiento (previsto vs hecho) por bloque y por semana. Descriptivo; faltante ≠ omitido. */
  compliance: BlockCompliance[];
}
