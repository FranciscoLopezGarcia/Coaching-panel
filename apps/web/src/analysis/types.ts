import type { AnalysisMetric, AnalysisResult, PeriodRow } from '@coaching/contracts';

export type { AnalysisMetric, AnalysisResult, PeriodRow };
export type Lift = 'SQ' | 'BP' | 'DL';
/** Qué se muestra: lo realizado, lo previsto, o ambos (previsto punteado). Plan y real nunca se completan entre sí. */
export type Source = 'real' | 'plan' | 'ambos';
export type Scale = 'week' | 'session';
export type Mode = 'periodo' | 'bloque';

export interface Linked {
  date: string | null;
  set: (d: string | null) => void;
}
