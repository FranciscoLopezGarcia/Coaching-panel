import type { PerformanceProjection } from '@coaching/contracts';
import { endpoint, query } from '../workspace/api';
export type Point = { date: string; value: number };
export function presentProjection(p: PerformanceProjection) {
  const usable = p.status !== 'unavailable';
  const future = p.status === 'available';
  return {
    observations: usable ? p.observedPoints.filter((x) => x.inView) : [],
    trend: usable
      ? p.fittedPoints.filter(
          (x) =>
            (!p.periods.view.from || x.date >= p.periods.view.from) &&
            (!p.periods.view.to || x.date <= p.periods.view.to),
        )
      : [],
    forecast: future ? p.forecastPoints : [],
    range: future && p.forecastRange.status === 'available' ? p.forecastRange.points : [],
    cutoff: p.cutoff,
    periods: p.periods,
    rangeNotice: p.forecastRange.notice,
    rangeWarnings: p.forecastRange.warnings ?? [],
    rangeLabel: p.forecastRange.label,
    calibration: p.forecastRange.calibration,
    summary: p.summary,
    method: p.target.method,
    quality: p.dataQuality,
    selectedBaseline: p.model.selected?.id === 'baseline',
    baseline: p.validation.verdict !== 'mejora_sobre_baseline',
    reasons: p.reasons,
  };
}
export async function fetchProjection(id: string, values: Record<string, string>) {
  const r = await fetch(endpoint(id, 'performance-projection') + query(values));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('No se pudo actualizar la proyección. Reintentá.');
  return presentProjection((await r.json()) as PerformanceProjection);
}

export function projectionVariable(method: string) {
  if (method === 'table-rpe') return 'e1rm_table_rpe';
  if (method === 'prg-6-formulas') return 'e1rm_prg_formulas';
  return null;
}
