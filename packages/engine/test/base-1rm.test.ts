import { describe, expect, it } from 'vitest';
import { base1rm, base1rmFor, BASE_1RM_WINDOW_DAYS } from '../src/base-1rm.js';
import { exerciseKey } from '../src/exercise-library.js';
import type { StrengthReference } from '../src/references.js';
import type { ActualSet, PlannedSet } from '../src/types.js';

const ref = (exerciseName: string, kg: number, asOf: string, id = 'r1'): StrengthReference => ({
  id,
  exerciseName,
  kg,
  source: 'test',
  asOf,
  version: 'v1',
  note: '',
});
const pl = (id: string, name: string): PlannedSet =>
  ({ id, exerciseName: name, isWarmup: false, variantKey: name }) as PlannedSet;
const ac = (id: string, kg: number, reps: number, rpe: number | null, on: string): ActualSet =>
  ({ plannedSetId: id, status: 'done', kg, reps, rpe, performedOn: on }) as ActualSet;

describe('clave canónica de ejercicio', () => {
  it('unifica los alias de las competitivas y no fusiona variantes', () => {
    expect(exerciseKey('Squat comp')).toBe(exerciseKey('sq comp'));
    expect(exerciseKey('Squat comp')).toBe(exerciseKey('Sentadilla competencia'));
    expect(exerciseKey('Bench comp')).toBe(exerciseKey('Press banca competencia'));
    expect(exerciseKey('DL comp')).toBe(exerciseKey('Peso muerto competencia'));
    expect(exerciseKey('Squat pausa')).not.toBe(exerciseKey('Squat comp'));
    expect(exerciseKey('Sentadilla con pausa')).not.toBe(exerciseKey('Sentadilla competencia'));
  });
});

describe('1RM base para programar con %', () => {
  it('el declarado rige desde su fecha (nunca mira hacia adelante) y es el de ese ejercicio', () => {
    const refs = [
      ref('Sentadilla competencia', 200, '2026-10-01'),
      ref('Sentadilla competencia', 210, '2026-12-01', 'r2'),
    ];
    const [r] = base1rmFor(['sq comp'], refs, [], [], '2026-11-10');
    expect(r?.declared).toMatchObject({ kg: 200, asOf: '2026-10-01' });
    const [p] = base1rmFor(['Squat pausa'], refs, [], [], '2026-11-10');
    expect(p?.declared).toBeNull();
    expect(p?.calculated).toBeNull();
  });
  it('el calculado sale de series hechas CON RPE real, de esa variante y dentro de la ventana', () => {
    const planned = [
      pl('a', 'Squat comp'),
      pl('b', 'Squat comp'),
      pl('c', 'Squat comp'),
      pl('d', 'Squat pausa'),
    ];
    const actual = [
      ac('a', 180, 3, 8, '2026-11-05'),
      ac('b', 190, 3, null, '2026-11-06'), // sin RPE: no cuenta
      ac('c', 150, 5, 8, '2026-01-01'), // fuera de la ventana
      ac('d', 170, 3, 8, '2026-11-05'), // otra variante
    ];
    const rows = base1rmFor(['Sentadilla competencia', 'Squat pausa'], [], planned, actual, '2026-11-10');
    expect(rows[0]?.calculated).toMatchObject({ sets: 1, windowDays: BASE_1RM_WINDOW_DAYS });
    expect(rows[0]!.calculated!.kg).toBeGreaterThan(200);
    expect(rows[0]!.calculated!.kg).not.toBe(rows[1]!.calculated!.kg);
    expect(rows[0]?.declared).toBeNull();
  });
  it('sin referencia ni observaciones no hay base', () => {
    expect(base1rm([], [], [], '2026-11-10')).toEqual([]);
    expect(base1rmFor(['Squat comp'], [], [], [], '2026-11-10')[0]).toMatchObject({
      declared: null,
      calculated: null,
    });
  });
});
