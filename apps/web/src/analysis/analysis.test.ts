import { describe, expect, it } from 'vitest';
import { FAMILIES, FUERZA_METRICS } from './families';
import { periodLabel, tracesFor, valueOf } from './derive';
import type { AnalysisMetric, PeriodRow } from './types';

const metric = (over: Partial<AnalysisMetric> = {}): AnalysisMetric => ({
  id: 'nl',
  label: 'NL',
  unit: 'reps',
  group: 'volumen',
  kind: 'suma',
  modelFamily: null,
  decimals: 0,
  hasPlan: true,
  blockRow: null,
  ...over,
});
const period = (over: Partial<PeriodRow> = {}): PeriodRow => ({
  key: 'A|1',
  granularity: 'week',
  blockKey: 'A',
  weekNo: 1,
  sessionKey: null,
  from: '2026-06-01',
  to: '2026-06-07',
  future: false,
  planned: { nl: 30 },
  actual: { nl: 28 },
  quality: { siMissing: 0, pctMissing: 0 },
  compliance: { planned: 6, done: 5, skipped: 0, unknown: 1 },
  rpeDev: { pairs: 0, mean: null },
  fatigueEnd: null,
  ...over,
});

describe('presentación de períodos', () => {
  it('real y previsto salen por separado y nunca se completan entre sí', () => {
    const p = period({ actual: null });
    expect(valueOf(p, 'nl', 'real')).toBeNull();
    expect(valueOf(p, 'nl', 'plan')).toBe(30);
  });
  it('fuente «ambos»: real sólido y previsto punteado; «real» no dibuja el plan', () => {
    const ps = [period()];
    const ambos = tracesFor(ps, metric(), 'ambos', 'c');
    expect(ambos.map((t) => !!t.dashed)).toEqual([false, true]);
    expect(tracesFor(ps, metric(), 'real', 'c')).toHaveLength(1);
    expect(tracesFor(ps, metric(), 'plan', 'c')[0]?.dashed).toBe(true);
  });
  it('una métrica sin versión prevista no dibuja plan', () => {
    expect(tracesFor([period()], metric({ hasPlan: false }), 'ambos', 'c')).toHaveLength(1);
  });
  it('etiquetas de período por escala', () => {
    expect(periodLabel(period(), 'week')).toMatch(/^S1 · /);
    expect(periodLabel(period({ weekNo: 4 }), 'session')).not.toMatch(/^S4/);
  });
});

describe('familias: una magnitud, un solo lugar', () => {
  it('ninguna magnitud se declara en dos familias y cada familia tiene métricas', () => {
    const ids = [...FAMILIES.flatMap((f) => f.metrics), ...FUERZA_METRICS];
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FAMILIES) expect(f.metrics.length, f.id).toBeGreaterThan(0);
    expect(new Set(FAMILIES.map((f) => f.id)).size).toBe(FAMILIES.length);
  });
});
