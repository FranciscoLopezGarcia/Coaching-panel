import type { Lift } from './types.js';
import type { ReferenceInfo } from './references.js';

export type MetricStatus = 'available' | 'partial' | 'unavailable';

/** Referencia a un registro/período usado, para que el consumidor pueda abrir la evidencia. */
export interface RecordRef {
  kind: 'set' | 'session' | 'exposure' | 'period' | 'checkin' | 'plan_version' | 'change_event' | 'review';
  id: string;
  date?: string;
  note?: string;
}

export interface MetricScope {
  athleteId?: string;
  lift?: Lift | 'ALL';
  exercise?: string;
  exposureId?: string;
  muscleGroup?: string;
  blockKey?: string;
}

export interface MetricPeriod {
  from: string;
  to: string;
  /** Días del período realmente considerados (hasta el corte). */
  days: number;
  weeks: number;
  /** true si el período pedido se recortó por el corte o no completa una semana. */
  partial: boolean;
}

/** Resultado calculado con todo lo necesario para auditarlo: qué, con qué datos, qué quedó afuera y qué advertir. */
export interface MetricResult<T = number> {
  metricId: string;
  status: MetricStatus;
  value: T | null;
  unit: string;
  cutoff: string;
  period: MetricPeriod | null;
  scope: MetricScope;
  usedRecords: RecordRef[];
  excluded: { ref?: RecordRef; reason: string }[];
  missing: string[];
  reference: ReferenceInfo | null;
  baseline: { period: { from: string; to: string }; value: number | null } | null;
  method: { id: string; version: string };
  warnings: string[];
}

export function metricResult<T = number>(
  p: Pick<MetricResult<T>, 'metricId' | 'unit' | 'cutoff' | 'method'> & Partial<MetricResult<T>>,
): MetricResult<T> {
  return {
    status: 'unavailable',
    value: null,
    period: null,
    scope: {},
    usedRecords: [],
    excluded: [],
    missing: [],
    reference: null,
    baseline: null,
    warnings: [],
    ...p,
  };
}

const dayMs = 86_400_000;
export function periodOf(from: string, to: string, cutoff: string): MetricPeriod {
  const end = to > cutoff ? cutoff : to;
  const days = Math.max(0, Math.round((Date.parse(end) - Date.parse(from)) / dayMs) + 1);
  return { from, to: end, days, weeks: days / 7, partial: to > cutoff || days % 7 !== 0 };
}
