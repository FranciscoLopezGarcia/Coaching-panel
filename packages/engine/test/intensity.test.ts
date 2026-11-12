import { describe, expect, it } from 'vitest';
import { blockMetrics, weekMetrics } from '../src/metrics.js';
import type { SetView } from '../src/views.js';

const v = (reps: number, kg: number | null, refKg: number | null, weekNo = 1): SetView => ({
  id: `${reps}-${kg}-${weekNo}`,
  sessionKey: `s${weekNo}`,
  exposureId: 'e',
  variantKey: '',
  blockKey: 'B',
  familyKey: 'F',
  weekNo,
  dayNo: 1,
  lift: 'SQ',
  exerciseName: 'Sentadilla',
  date: '2026-01-01',
  reps,
  kg,
  rpe: null,
  refKg,
});

describe('intensidad relativa media', () => {
  it('simple vs ponderada por repeticiones', () => {
    const w = weekMetrics([v(1, 95, 100), v(8, 75, 100)], 1);
    expect(w.meanPct).toBeCloseTo(0.85, 6);
    expect(w.meanPctByReps).toBeCloseTo((0.95 * 1 + 0.75 * 8) / 9, 6);
  });
  it('series sin referencia no anulan la semana y se informan', () => {
    const w = weekMetrics([v(5, 80, 100), v(5, 60, null)], 1);
    expect(w.meanPct).toBeCloseTo(0.8, 6);
    expect(w.pctMissing).toBe(1);
  });
  it('bloque: pool de series, no media de medias semanales', () => {
    const b = blockMetrics(
      [v(5, 90, 100, 1), v(5, 70, 100, 2), v(5, 70, 100, 2), v(5, 70, 100, 2)],
      'SQ',
      'B',
    );
    expect(b?.perWeek.meanPct).toBeCloseTo(0.75, 6);
  });
});

import { musclesForSet } from '../src/muscles.js';
describe('grupo muscular elegido por el coach', () => {
  it('manda sobre la convención por nombre y entra como directo', () => {
    const sin = musclesForSet({ exerciseId: 'ejercicio-raro', exerciseName: 'Ejercicio raro' });
    expect(sin).toBeNull();
    const con = musclesForSet({
      exerciseId: 'ejercicio-raro',
      exerciseName: 'Ejercicio raro',
      muscleGroup: 'biceps',
    });
    expect(con).toEqual([{ group: 'biceps', kind: 'directo', weight: 1 }]);
    const row = musclesForSet({
      exerciseId: 'remo-barra',
      exerciseName: 'Remo barra',
      muscleGroup: 'trapecio',
    });
    expect(row?.find((m) => m.group === 'trapecio')?.kind).toBe('directo');
  });
});
