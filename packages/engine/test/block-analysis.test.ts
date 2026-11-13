import { describe, expect, it } from 'vitest';
import { compareAdjacentBlocks, delta, selectRecentBlocks, variantPerformance } from '../src/index.js';
import { Fixture, row } from './helpers.js';

describe('delta (anexo A/C)', () => {
  it('abs y % respecto del bloque anterior', () => {
    expect(delta(51, 45, 'x').pct).toBeCloseTo(13.333, 2);
    expect(delta(48, 51, 'x').pct).toBeCloseTo(-5.882, 2);
    expect(delta(54, 48, 'x').pct).toBeCloseTo(12.5, 5);
  });
  it('intensidad en pp, sin %', () => {
    const d = delta(77, 76, '%1RM', { pp: true });
    expect(d).toMatchObject({ abs: 1, pct: null, status: 'ok' });
  });
  it('0→x es "nuevo" sin porcentaje; faltante no es cero', () => {
    expect(delta(10, 0, 'x')).toMatchObject({ abs: 10, pct: null, status: 'nuevo' });
    expect(delta(null, 5, 'x')).toMatchObject({ abs: null, status: 'no_comparable' });
    expect(delta(5, null, 'x').status).toBe('no_comparable');
  });
});

function fx() {
  const f = new Fixture();
  const blocks = [
    ['May', '2026-05-04', 4],
    ['Jun', '2026-06-01', 3],
    ['Jul', '2026-07-06', 5],
    ['Ago', '2026-08-03', 4],
    ['Sep', '2026-09-07', 4],
  ] as const;
  for (const [b, start, kg] of blocks) {
    for (let w = 1; w <= 2; w++) {
      const d = new Date(Date.parse(start) + (w - 1) * 7 * 864e5).toISOString().slice(0, 10);
      f.session(d, row(100 + kg + w, 8, 8, 5, 3), {
        block: b,
        week: w,
        variant: 'Comp',
        exercise: 'Squat comp',
      });
    }
  }
  return f;
}

describe('selectRecentBlocks', () => {
  it('actual + tres anteriores, sin inventar bloques', () => {
    const f = fx();
    const w = selectRecentBlocks(f.planned, 'Sep', '2026-12-31');
    expect(w?.blocks.map((b) => b.blockKey)).toEqual(['Jun', 'Jul', 'Ago', 'Sep']);
    expect(w?.partial).toBe(false);
    const p = selectRecentBlocks(f.planned, 'Jun', '2026-12-31');
    expect(p?.blocks.map((b) => b.blockKey)).toEqual(['May', 'Jun']);
    expect(p?.partial).toBe(true);
    expect(selectRecentBlocks(f.planned, 'nope', '2026-12-31')).toBeNull();
  });
});

describe('compareAdjacentBlocks', () => {
  it('deltas solo entre vecinos y sin fuga de futuro', () => {
    const f = fx();
    const c = compareAdjacentBlocks({
      planned: f.planned,
      actual: f.actual,
      currentBlockKey: 'Sep',
      asOf: '2026-09-08', // Sep: solo semana 1 ejecutada
      source: 'actual',
      lift: 'SQ',
    });
    const nl = c?.rows.find((r) => r.metricId === 'nl_per_week');
    expect(nl?.values).toHaveLength(4);
    expect(nl?.deltas).toHaveLength(3);
    expect(c?.window.blocks[3]?.closed).toBe(false);
  });
  it('detecta variante nueva, retirada y reintroducida', () => {
    const f = new Fixture();
    f.session('2026-05-04', row(100), {
      block: 'A',
      variant: 'Pausa',
      exercise: 'SQ pausa',
      slot: 's1',
      exposure: 'e1',
    });
    f.session('2026-06-01', row(100), {
      block: 'B',
      variant: 'HB',
      exercise: 'SQ HB',
      slot: 's1',
      exposure: 'e1',
    });
    f.session('2026-07-06', row(100), {
      block: 'C',
      variant: 'Pausa',
      exercise: 'SQ pausa',
      slot: 's1',
      exposure: 'e1',
    });
    const c = compareAdjacentBlocks({
      planned: f.planned,
      actual: f.actual,
      currentBlockKey: 'C',
      asOf: '2026-12-31',
      source: 'planned',
    });
    const ev = (e: string, v: string) => c?.changes.some((x) => x.event === e && x.variantKey === v);
    expect(ev('new_variant', 'HB')).toBe(true);
    expect(ev('removed_variant', 'Pausa')).toBe(true);
    expect(ev('removed_variant', 'HB')).toBe(true);
    expect(ev('resumed_variant', 'Pausa')).toBe(true);
  });
});

describe('variantPerformance (anexo D/F)', () => {
  it('máximo semanal por variante, hueco sin interpolar, no mezcla variantes', () => {
    const f = new Fixture();
    f.session('2026-05-04', row(200, 8, 8, 3, 1), { block: 'A', week: 1, variant: 'Comp' });
    f.session('2026-05-18', row(210, 8, 8, 3, 1), { block: 'A', week: 3, variant: 'Comp' });
    f.session('2026-05-05', row(150, 8, 8, 3, 1), {
      block: 'A',
      week: 1,
      variant: 'Pausa',
      exercise: 'SQ pausa',
      slot: 'x',
      exposure: 'x',
    });
    const v = variantPerformance(f.planned, f.actual, 'A', '2026-12-31', true);
    const comp = v.find((x) => x.variantKey === 'Comp');
    const pausa = v.find((x) => x.variantKey === 'Pausa');
    expect(comp?.weekly.map((p) => p.week)).toEqual([1, 3]); // semana 2 = hueco
    expect(comp?.bestWeek).toBe(3);
    expect(comp?.status).toBe('observed_but_sparse');
    expect((pausa?.bestKg ?? 0) < (comp?.bestKg ?? 0)).toBe(true);
  });
  it('empate: elige la última y es "open" si el máximo es el final', () => {
    const f = new Fixture();
    const kgs = [230, 233, 239, 239];
    kgs.forEach((k, i) =>
      f.session(`2026-05-${String(4 + i * 7).padStart(2, '0')}`, [{ reps: 1, kg: k, rpe: 10, target: 10 }], {
        block: 'A',
        week: i + 1,
      }),
    );
    const v = variantPerformance(f.planned, f.actual, 'A', '2026-12-31', true)[0];
    expect(v?.bestWeek).toBe(4);
    expect(v?.tiedDates).toHaveLength(2);
    expect(v?.status).toBe('best_observed_open');
  });
  it('sin RPE real no hay e1RM (no se usa el objetivo)', () => {
    const f = new Fixture();
    f.session('2026-05-04', [{ reps: 3, kg: 200, rpe: null, target: 8 }], { block: 'A' });
    const v = variantPerformance(f.planned, f.actual, 'A', '2026-12-31', true)[0];
    expect(v?.status).toBe('not_observed');
    expect(v?.bestKg).toBeNull();
  });
});

describe('calidad y tarjetas', () => {
  it('faltante ≠ omitida ≠ cero (anexo I)', () => {
    const f = new Fixture();
    f.session(
      '2026-05-04',
      [
        ...Array.from({ length: 7 }, () => ({ reps: 5, kg: 100, rpe: 8, target: 8 })),
        { reps: 5, kg: null, rpe: null, status: 'skipped' as const },
        { reps: 5, kg: null, rpe: null, status: 'pending' as const },
        { reps: 5, kg: null, rpe: null, status: 'pending' as const },
      ],
      { block: 'A' },
    );
    const c = compareAdjacentBlocks({
      planned: f.planned,
      actual: f.actual,
      currentBlockKey: 'A',
      asOf: '2026-05-10',
      source: 'actual',
    });
    expect(c?.quality[0]).toMatchObject({ planned: 10, done: 7, skipped: 1, unknown: 2, coverage: 0.8 });
    expect(c?.quality[0]?.adherence).toBeCloseTo(7 / 8);
    expect(c?.cards[0]).toMatchObject({ variantKey: 'Squat comp', sets: 7 });
  });
});
