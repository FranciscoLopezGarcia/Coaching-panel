import { dateLabel } from '../workspace/ui';
import type { Trace } from '../workspace/OverviewChart';
import type { AnalysisMetric, PeriodRow, Scale, Source } from './types';

/** Valor de una métrica en un período según la fuente elegida. null = sin dato (nunca 0). */
export const valueOf = (p: PeriodRow, id: string, side: 'real' | 'plan'): number | null =>
  (side === 'real' ? p.actual : p.planned)?.[id] ?? null;

export const hasPlan = (m: AnalysisMetric | undefined): boolean => !!m?.hasPlan;

/** Etiqueta corta de un período: «S2 · 08 jun» (semana del bloque) o la fecha de la sesión. */
export function periodLabel(p: PeriodRow, scale: Scale): string {
  return scale === 'week' ? `S${p.weekNo} · ${dateLabel(p.from)}` : dateLabel(p.from);
}

/** Series para el gráfico: lo realizado (sólido) y, si corresponde, lo previsto (punteado). */
export function tracesFor(
  periods: PeriodRow[],
  metric: AnalysisMetric,
  source: Source,
  color: string,
): Trace[] {
  const out: Trace[] = [];
  if (source !== 'plan')
    out.push({
      label: metric.label,
      color,
      points: periods.map((p) => ({ date: p.from, value: valueOf(p, metric.id, 'real') })),
    });
  if (source !== 'real' && metric.hasPlan)
    out.push({
      label: metric.label,
      color,
      dashed: true,
      legend: 'previsto',
      points: periods.map((p) => ({ date: p.from, value: valueOf(p, metric.id, 'plan') })),
    });
  return out;
}

/** Paleta de series (tokens de la identidad): acero, hueso, gris y acero oscuro. */
export const SERIES_COLORS = ['var(--c-steel)', 'var(--c-bone)', 'var(--c-gray)', 'var(--c-steel-dk)'];
