import { describe, expect, it } from 'vitest';
import { parseQuickSession } from './quickSession';
import {
  exerciseLine,
  groupByExercise,
  planSessionEdit,
  setsToText,
  splitWeekText,
  summarizeExercise,
  type SetRow,
} from './sessionText';

let n = 0;
const set = (
  name: string,
  setNo: number,
  reps: number,
  rpe: number | null,
  kg: number | null,
  extra: Partial<SetRow> = {},
): SetRow =>
  ({
    plannedSetId: `${name}-${++n}`,
    exposureId: name.toLowerCase().replace(/ /g, '-'),
    exerciseName: name,
    lift: /squat/i.test(name) ? 'SQ' : null,
    variantKey: name,
    segmentKey: 'k',
    isWarmup: false,
    retired: false,
    priority: /squat/i.test(name) ? 1 : 3,
    refKg: null,
    copiedFrom: null,
    plannedKgSource: null,
    protocol: {
      loadMode: kg ? 'kg' : 'rpe',
      pct: null,
      capKg: null,
      segment: 'work',
      tempo: null,
      pauseSec: null,
      instructions: null,
      repsMax: null,
    },
    setNo,
    planned: { reps, targetRpe: rpe, kg },
    actual: null,
    ...extra,
  }) as SetRow;
const base = (sets: SetRow[]) => ({
  sessionKey: 's1',
  date: '2026-11-10',
  blockKey: 'b',
  weekNo: 2,
  dayNo: 1,
  sets,
});
const segs = (t: string) => parseQuickSession(t).segments;

describe('sesión como texto', () => {
  const sets = [
    set('Squat comp', 1, 5, 4, null),
    set('Squat comp', 2, 5, 5, null),
    set('Squat comp', 3, 5, 6, null),
    set('Bench tyg', 1, 7, 7, 80),
    set('Bench tyg', 2, 7, 7, 80),
  ];
  it('serializa y resume por ejercicio', () => {
    expect(setsToText(sets)).toBe('1° Squat comp 3x5@4-5-6\n3° Bench tyg 2x7x80@7');
    expect(summarizeExercise(groupByExercise(sets)[0]!)).toBe('3×5 · RPE 4-5-6');
    expect(exerciseLine(groupByExercise(sets)[1]!)).toBe('3° Bench tyg 2x7x80@7');
  });
  it('ida y vuelta sin cambios: no genera operaciones', () => {
    const p = planSessionEdit(base(sets), segs(setsToText(sets)));
    expect(p.ops).toEqual([]);
    expect(p.unchanged).toBe(2);
  });
  it('mismo número de series: solo cambia valores (conserva ejecución)', () => {
    const done = sets.map((s, i) =>
      i < 3
        ? {
            ...s,
            actual: { status: 'done', kg: 100, reps: 5, rpe: 7, pain: null, performedOn: '2026-11-10' },
          }
        : s,
    );
    const p = planSessionEdit(base(done), segs('1° Squat comp 3x5@5-6-7\n3° Bench tyg 2x7x80@7'));
    expect(p.ops).toHaveLength(3);
    expect(p.ops.every((o) => o.kind === 'change')).toBe(true);
    expect(p.warnings).toEqual([]);
    expect(p.changes[0]).toContain('RPE 4 → 5');
  });
  it('distinto número de series reemplaza ese ejercicio y avisa de la ejecución', () => {
    const done = sets.map((s, i) =>
      i < 3
        ? {
            ...s,
            actual: { status: 'done', kg: 100, reps: 5, rpe: 7, pain: null, performedOn: '2026-11-10' },
          }
        : s,
    );
    const p = planSessionEdit(base(done), segs('1° Squat comp 4x5@6\n3° Bench tyg 2x7x80@7'));
    expect(p.ops.map((o) => o.kind)).toEqual(['remove', 'add']);
    expect(p.warnings[0]).toMatch(/3 serie\(s\) con ejecución/);
  });
  it('ejercicio nuevo se agrega y el que falta se quita', () => {
    const p = planSessionEdit(base(sets), segs('1° Squat comp 3x5@4-5-6\nCurl 3x10@8'));
    expect(p.ops.map((o) => o.kind).sort()).toEqual(['add', 'remove']);
    expect(p.changes.join('|')).toMatch(/Curl: ejercicio nuevo/);
  });
  it('separa una semana por días', () => {
    const r = splitWeekText('# Día 1 · lun\nSquat 3x5@7\n\n# Día 3\nBench 4x5@8\nRow 3x10');
    expect(r.errors).toEqual([]);
    expect(r.days.map((d) => [d.dayNo, d.text.split('\n').length])).toEqual([
      [1, 1],
      [3, 2],
    ]);
  });
  it('una prioridad no escrita no cuenta como cambio (no reemplaza ejercicios con ejecución)', () => {
    const conPrio = [
      set('Deadlift comp', 1, 1, 7, 197.5, { priority: null, lift: 'DL' }),
      set('Deadlift comp', 2, 1, 10, 220, { priority: null, lift: 'DL' }),
    ];
    const p = planSessionEdit(base(conPrio), segs(setsToText(conPrio)));
    expect(p.ops).toEqual([]);
  });
});
