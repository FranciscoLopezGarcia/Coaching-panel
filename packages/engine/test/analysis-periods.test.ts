import { describe, expect, it } from 'vitest';
import { ANALYSIS_METRICS, analysisMetric, buildPeriods, SERIES_PICK } from '../src/index.js';
import { Fixture, row } from './helpers.js';

function fx() {
  const f = new Fixture();
  // semana 1 completa, semana 2 con una serie omitida y otra sin registro, semana 3 futura
  f.session('2026-06-01', row(100, 8, 8, 5, 3), { block: 'A', week: 1, key: 's1' });
  f.session(
    '2026-06-08',
    [
      { reps: 5, kg: 100, rpe: 9, target: 8 },
      { reps: 5, kg: null, rpe: null, target: 8, status: 'skipped' },
      { reps: 5, kg: null, rpe: null, target: 8, status: 'pending' },
    ],
    { block: 'A', week: 2, key: 's2' },
  );
  f.future('2026-06-15', [{ reps: 5, kg: 100, target: 8 }], { block: 'A', week: 3, key: 's3' });
  return f;
}
const base = (f: Fixture, over = {}) => ({
  planned: f.planned,
  actual: f.actual,
  feedback: [{ sessionKey: 's1', endFatigue: 6 }],
  cutoff: '2026-06-10',
  from: '2026-05-01',
  to: '2026-07-01',
  granularity: 'week' as const,
  ...over,
});

describe('registro de métricas', () => {
  it('ids únicos y cada métrica de series tiene su extractor', () => {
    const ids = ANALYSIS_METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of ANALYSIS_METRICS)
      if (!['nl_ratio', 'rpe_dev', 'compliance_sets', 'fatigue_end', 'e1rm'].includes(m.id))
        expect(SERIES_PICK[m.id], m.id).toBeTypeOf('function');
    expect(analysisMetric('e1rm')?.group).toBe('fuerza');
    expect(analysisMetric('si_total')?.modelFamily).toBe(analysisMetric('si_central')?.modelFamily);
  });
});

describe('buildPeriods', () => {
  it('semana: plan y real separados, faltante ≠ 0 y cumplimiento sobre lo previsto al corte', () => {
    const p = buildPeriods(base(fx()));
    expect(p.map((x) => x.weekNo)).toEqual([1, 2, 3]);
    const w1 = p[0]!;
    expect(w1.actual?.nl).toBe(15);
    expect(w1.planned?.nl).toBe(15);
    expect(w1.actual?.compliance_sets).toBe(100);
    expect(w1.actual?.fatigue_end).toBe(6);
    const w2 = p[1]!;
    expect(w2.actual?.nl).toBe(5); // solo la serie hecha
    expect(w2.planned?.nl).toBe(15);
    expect(w2.compliance).toEqual({ planned: 3, done: 1, skipped: 1, unknown: 1 });
    expect(w2.actual?.compliance_sets).toBeCloseTo(33.33, 1);
    expect(w2.actual?.nl_ratio).toBeCloseTo(33.33, 1);
    expect(w2.actual?.rpe_dev).toBe(1);
    expect(w2.actual?.fatigue_end).toBeNull(); // sin dato: no es 0
  });
  it('sin fuga de futuro: lo posterior al corte no tiene real y figura como futuro', () => {
    const w3 = buildPeriods(base(fx()))[2]!;
    expect(w3.future).toBe(true);
    expect(w3.actual).toBeNull();
    expect(w3.planned?.nl).toBe(5);
    expect(w3.compliance.planned).toBe(0); // la semana no llegó al corte
  });
  it('e1RM del período: solo con un movimiento; real con RPE real y previsto con RPE objetivo, por separado', () => {
    const f = fx();
    const sq = buildPeriods(base(f, { lift: 'SQ' })).find((x) => x.weekNo === 1)!;
    expect(sq.actual?.e1rm).toBeGreaterThan(100);
    expect(sq.planned?.e1rm).toBeNull(); // el plan del fixture no prescribe kg: faltante, no 0
    const all = buildPeriods(base(f)).find((x) => x.weekNo === 1)!;
    expect(all.actual?.e1rm).toBeNull(); // varios lifts: no hay un único e1RM
  });
  it('sesión: una fila por sesión con la misma regla', () => {
    const p = buildPeriods(base(fx(), { granularity: 'session' }));
    expect(p.map((x) => x.sessionKey)).toEqual(['s1', 's2', 's3']);
    expect(p[0]?.actual?.fatigue_end).toBe(6);
  });
  it('el recorte por fechas y por lift no mezcla series ajenas', () => {
    const f = fx();
    f.session('2026-06-02', row(80, 8, 8, 5, 2), {
      block: 'A',
      week: 1,
      key: 'b1',
      lift: 'BP',
      exercise: 'Bench comp',
    });
    const all = buildPeriods(base(f)).find((x) => x.weekNo === 1)!;
    const sq = buildPeriods(base(f, { lift: 'SQ' })).find((x) => x.weekNo === 1)!;
    expect(all.actual?.nl).toBe(25);
    expect(sq.actual?.nl).toBe(15);
    expect(buildPeriods(base(f, { from: '2026-06-08' })).map((x) => x.weekNo)).toEqual([2, 3]);
  });
});
