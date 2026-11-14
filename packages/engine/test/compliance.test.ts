import { describe, expect, it } from 'vitest';
import { blockCompliance } from '../src/block-analysis/compliance.js';
import type { ActualSet, PlannedSet } from '../src/types.js';
import { Fixture } from './helpers.js';

const done = (
  id: string,
  kg: number | null,
  reps: number,
  rpe: number | null,
  on = '2026-03-02',
): ActualSet => ({
  plannedSetId: id,
  status: 'done',
  kg,
  reps,
  rpe,
  performedOn: on,
  pain: null,
});

describe('Cumplimiento del bloque (previsto vs hecho)', () => {
  const fx = new Fixture();
  fx.future(
    '2026-03-02',
    [
      { reps: 5, kg: 100, plannedKg: 100 },
      { reps: 5, kg: 100, plannedKg: 100 },
      { reps: 5, kg: 100, plannedKg: 100 },
    ],
    { key: 'A', week: 1 },
  );
  fx.future(
    '2026-03-04',
    [
      { reps: 5, kg: 100, plannedKg: 100 },
      { reps: 5, kg: 100, plannedKg: 100 },
    ],
    { key: 'B', week: 1 },
  );
  fx.future('2026-09-01', [{ reps: 5, kg: 100, plannedKg: 100 }], { key: 'F', week: 9 }); // futura
  const planned = fx.planned as PlannedSet[];
  const actual: ActualSet[] = [
    done('A-1', 95, 5, 8.5), // 95 de 100 → 95 %; RPE +0,5 sobre el objetivo 8
    done('A-2', 100, 4, 8), // reps 80 %
    {
      plannedSetId: 'A-3',
      status: 'skipped',
      kg: null,
      reps: null,
      rpe: null,
      performedOn: null,
      pain: null,
    },
    done('B-1', null, 5, null, '2026-03-04'), // sin kg ni RPE reales: no entra a esos pares
    // B-2 sin registro → faltante
  ];
  const c = blockCompliance(planned, actual, 'B1', '2026-03-31');

  it('cuenta hechas, omitidas y faltantes por separado (faltante ≠ omitida) y deja afuera lo posterior al corte', () => {
    expect(c.total.setsPlanned).toBe(5);
    expect(c.total.setsDone).toBe(3);
    expect(c.total.setsSkipped).toBe(1);
    expect(c.total.setsUnknown).toBe(1);
    expect(c.total.setsDoneShare).toBeCloseTo(0.6);
    expect(c.total.setsDoneOfRecorded).toBeCloseTo(0.75);
    expect(c.weeks.map((w) => w.weekNo)).toEqual([1]);
  });
  it('sesiones: con trabajo y completas', () => {
    expect(c.total.sessionsPlanned).toBe(2);
    expect(c.total.sessionsWithWork).toBe(2);
    expect(c.total.sessionsComplete).toBe(0);
  });
  it('carga, reps y RPE usan solo los pares con ambos datos', () => {
    expect(c.load.pairs).toBe(2);
    expect(c.load.meanPct).toBeCloseTo(97.5);
    expect(c.reps.pairs).toBe(3);
    expect(c.reps.meanPct).toBeCloseTo((100 + 80 + 100) / 3);
    expect(c.rpe.pairs).toBe(2);
    expect(c.rpe.meanDiff).toBeCloseTo(0.25);
  });
  it('sin registros no inventa porcentajes', () => {
    const z = blockCompliance(planned, [], 'B1', '2026-03-31');
    expect(z.total.setsDone).toBe(0);
    expect(z.total.setsDoneOfRecorded).toBeNull();
    expect(z.load.meanPct).toBeNull();
    expect(z.rpe.meanDiff).toBeNull();
  });
});
