import { describe, expect, it } from 'vitest';
import type { ObservedSet } from '../src/observed.js';
import { observedFromPlan } from '../src/observed.js';
import {
  annotations,
  calendarWeeks,
  compareWeeks,
  comparePeriods,
  dailyLoad,
  e1rmCandles,
  macroSummary,
  mesoSummary,
  performanceSeries,
  recoverySeries,
  weekRefs,
  weeklyByMovement,
  weeklyByMuscle,
} from '../src/queries.js';
import { Fixture, row, withMin } from './helpers.js';

let n = 0;
const o = (
  date: string,
  kg: number | null,
  reps: number | null,
  rpe: number | null = null,
  x: Partial<ObservedSet> = {},
): ObservedSet => ({
  id: `o${++n}`,
  source: 'hevy',
  sessionKey: `s-${date}`,
  date,
  exerciseName: 'Squat (Barbell)',
  exerciseId: 'squat-barbell',
  lift: 'SQ',
  variantKey: 'barbell',
  setType: 'work',
  kg,
  reps,
  rpe,
  loadKind: 'total',
  plannedSetId: null,
  refKg: null,
  refSource: null,
  refAsOf: null,
  ...x,
});

describe('Semanas calendario y parciales', () => {
  it('lunes a domingo, con la semana en curso marcada como parcial', () => {
    const w = weekRefs('2026-03-02', '2026-03-15', '2026-03-11');
    expect(w.map((x) => [x.from, x.to, x.days, x.partial])).toEqual([
      ['2026-03-02', '2026-03-08', 7, false],
      ['2026-03-09', '2026-03-11', 3, true],
    ]);
  });
  it('un rango que empieza a mitad de semana también es parcial', () => {
    expect(weekRefs('2026-03-04', '2026-03-08', '2026-03-31')[0]).toMatchObject({
      from: '2026-03-04',
      to: '2026-03-08',
      days: 5,
      partial: true,
    });
  });
});

describe('Resumen semanal por movimiento: planificado y realizado separados', () => {
  const fx = new Fixture();
  fx.session('2026-03-02', row(150, 8, 8), {
    key: 'a',
    exposure: 'sq',
    variant: 'barbell',
    exercise: 'Squat comp',
  });
  fx.session('2026-03-04', row(150, 8, 8), {
    key: 'b',
    exposure: 'sq-pausa',
    variant: 'pausa',
    exercise: 'Squat comp',
  });
  fx.future('2026-03-09', [{ reps: 5, kg: null, target: 8, plannedKg: 150 }], {
    key: 'c',
    exposure: 'sq',
    variant: 'barbell',
    exercise: 'Squat comp',
  });
  const planned = fx.planned;
  const observed = observedFromPlan(planned, fx.actual, '2026-03-10');
  it('muestra lo previsto y lo hecho por semana, sin mezclar variantes', () => {
    const rows = weeklyByMovement({
      planned,
      observed,
      from: '2026-03-02',
      to: '2026-03-15',
      cutoff: '2026-03-10',
    });
    const w1 = rows.filter((r) => r.week.from === '2026-03-02');
    expect(new Set(w1.map((r) => r.movement.variantKey))).toEqual(new Set(['barbell', 'pausa']));
    const barbell = w1.find((r) => r.movement.variantKey === 'barbell')!;
    expect(barbell.planned).toMatchObject({ sets: 3, nl: 15 });
    expect(barbell.actual.nl).toMatchObject({ status: 'available', value: 15 });
    const w2 = rows.find((r) => r.week.from === '2026-03-09')!;
    expect(w2.week).toMatchObject({ partial: true, days: 7, elapsedDays: 2, future: false }); // semana en curso: la programación se ve completa
    expect(w2.planned).toMatchObject({ sets: 1, nl: 5 });
    expect(w2.actual).toEqual({}); // todavía no se hizo: no hay datos realizados (no un cero)
  });
});

describe('Semanas calendario: lo previsto llega más allá del corte', () => {
  it('una semana futura existe para lo planificado, con 0 días transcurridos', () => {
    const w = calendarWeeks('2026-03-02', '2026-03-22', '2026-03-10');
    expect(w.map((x) => [x.from, x.days, x.elapsedDays, x.partial, x.future])).toEqual([
      ['2026-03-02', 7, 7, false, false],
      ['2026-03-09', 7, 2, true, false],
      ['2026-03-16', 7, 0, true, true],
    ]);
  });
  it('un rango que no coincide con semanas completas marca los bordes como parciales', () => {
    expect(calendarWeeks('2026-03-04', '2026-03-17', '2026-12-31').map((x) => [x.days, x.partial])).toEqual([
      [5, true],
      [7, false],
      [2, true],
    ]);
  });
});

describe('Resumen semanal por músculo', () => {
  it('discrimina directo e indirecto, calcula series equivalentes y no da un total entre músculos', () => {
    const obs = [
      o('2026-03-02', 150, 5),
      o('2026-03-02', 150, 5),
      o('2026-03-03', 100, 5, null, {
        exerciseName: 'Bench Press (Barbell)',
        exerciseId: 'bench-press-barbell',
        lift: 'BP',
        variantKey: 'barbell',
      }),
    ];
    const s = weeklyByMuscle(obs, '2026-03-02', '2026-03-08', '2026-03-31');
    const quad = s.rows.find((r) => r.muscle === 'cuadriceps')!;
    expect(quad).toMatchObject({ directSets: 2, indirectSets: 0, equivalentSets: 2 });
    const hams = s.rows.find((r) => r.muscle === 'isquiotibiales')!;
    expect(hams).toMatchObject({ directSets: 0, indirectSets: 2, equivalentSets: 1 });
    const pec = s.rows.find((r) => r.muscle === 'pectoral')!;
    expect(pec.directSets).toBe(1);
    expect(s.warnings.join(' ')).toMatch(/No se informa un total entre músculos/);
    expect(s.convention).toMatchObject({ directWeight: 1, indirectWeight: 0.5 });
    expect(s.rows.every((r) => !('total' in r))).toBe(true);
  });
  it('un ejercicio fuera de la convención no aporta y se informa (no se adivina)', () => {
    const s = weeklyByMuscle(
      [
        o('2026-03-02', 20, 12, null, {
          exerciseName: 'Ejercicio Inventado XYZ',
          exerciseId: 'ejercicio-inventado-xyz',
          lift: null,
        }),
      ],
      '2026-03-02',
      '2026-03-08',
      '2026-03-31',
    );
    expect(s.rows).toHaveLength(0);
    expect(s.unmappedExercises).toEqual(['Ejercicio Inventado XYZ']);
  });
  it('los calentamientos no cuentan; NL por movimiento no es series por músculo', () => {
    const s = weeklyByMuscle(
      [o('2026-03-02', 60, 5, null, { setType: 'warmup' })],
      '2026-03-02',
      '2026-03-08',
      '2026-03-31',
    );
    expect(s.rows).toHaveLength(0);
  });
});

describe('Comparación de períodos con duraciones distintas', () => {
  const obs = [
    ...[0, 1, 2, 3].flatMap((w) => [
      o(`2026-02-${String(2 + 7 * w).padStart(2, '0')}`, 140, 5, 8),
      o(`2026-02-${String(2 + 7 * w).padStart(2, '0')}`, 140, 5, 8),
    ]),
    ...[0, 1, 2, 3, 4, 5]
      .flatMap((w) => [
        o(`2026-03-${String(2 + 7 * w).padStart(2, '0')}`, 150, 5, 8, { id: `b${w}-1` }),
        o(`2026-03-${String(2 + 7 * w).padStart(2, '0')}`, 150, 5, 8, { id: `b${w}-2` }),
      ])
      .filter((x) => x.date <= '2026-04-12'),
  ];
  it('normaliza por semana y advierte que los totales no son comparables', () => {
    const c = comparePeriods({
      observed: obs,
      a: { from: '2026-02-02', to: '2026-03-01' },
      b: { from: '2026-03-02', to: '2026-04-12' },
      cutoff: '2026-04-30',
      scope: { lift: 'SQ' },
    });
    const nl = c.rows.find((r) => r.metricId === 'nl')!;
    expect([c.a.weeks, c.b.weeks]).toEqual([4, 6]);
    expect(nl.a).toBe(40);
    expect(nl.b).toBe(60);
    expect(nl.aPerWeek).toBe(10);
    expect(nl.bPerWeek).toBe(10);
    expect(nl.diffPerWeek).toBe(0);
    expect(nl.diff).toBe(20); // el total engaña: por eso se ofrece la dosis semanal
    expect(c.notes.join(' ')).toMatch(/dosis POR SEMANA/);
  });
  it('mantiene los métodos de e1RM y los modelos de SI en filas separadas y marca períodos parciales', () => {
    const c = comparePeriods({
      observed: obs,
      a: { from: '2026-02-02', to: '2026-02-15' },
      b: { from: '2026-03-02', to: '2026-03-10' },
      cutoff: '2026-03-10',
      scope: { lift: 'SQ' },
    });
    expect(c.rows.map((r) => r.metricId)).toEqual(
      expect.arrayContaining([
        'e1rm_table_rpe',
        'e1rm_prg_formulas',
        'si_rts_total',
        'si_prg',
        'si_efort_xl',
      ]),
    );
    expect(c.b.partial).toBe(true);
    expect(c.rows.find((r) => r.metricId === 'si_rts_total')!.aPerWeek).not.toBeNull();
    expect(c.rows.find((r) => r.metricId === 'e1rm_table_rpe')!.aPerWeek).toBeNull(); // no aditivo
  });
  it('semana actual vs anterior: la actual es parcial y se ofrece la dosis normalizada por día', () => {
    const c = compareWeeks({ observed: obs, cutoff: '2026-03-04', scope: { lift: 'SQ' } });
    expect(c.b.partial).toBe(true);
    expect(c.b.days).toBe(3);
    const nl = c.normalizedPerDay.find((x) => x.metricId === 'nl')!;
    expect(nl.current).toBeCloseTo(10 / 3, 6);
    expect(nl.previous).toBeCloseTo(10 / 7, 6);
  });
});

describe('Series y velas OHLC', () => {
  const obs = [
    o('2026-03-02', 150, 5, 8),
    o('2026-03-04', 152.5, 5, 8),
    o('2026-03-06', 150, 5, null), // semana 1: 3 observaciones (la 3ª sin RPE)
    o('2026-03-09', 155, 5, 8), // semana 2: 1 sola observación por curva
    o('2026-03-02', 200, 1, null, { exerciseName: 'Squat pausa', variantKey: 'pausa' }),
  ];
  const { series, methodTransitions } = performanceSeries(obs, '2026-03-31');
  const get = (m: string, ex: string) => series.find((s) => s.methodId === m && s.exercise === ex)!;
  it('separa por método y por variante: nunca una serie mezclada', () => {
    expect(series.map((s) => `${s.exercise}|${s.methodId}`).sort()).toEqual([
      'Squat (Barbell)|prg-6-formulas',
      'Squat (Barbell)|table-rpe',
      'Squat pausa|prg-6-formulas',
    ]);
    expect(get('table-rpe', 'Squat (Barbell)').points.map((p) => p.date)).toEqual([
      '2026-03-02',
      '2026-03-04',
      '2026-03-09',
    ]); // sin la serie sin RPE
    expect(get('prg-6-formulas', 'Squat (Barbell)').points).toHaveLength(4);
  });
  it('informa desde cuándo hay RPE (cambio de método disponible) sin unir tendencias', () => {
    const t = methodTransitions.find((x) => x.exercise === 'Squat (Barbell)')!;
    expect(t).toMatchObject({ firstWithRpe: '2026-03-02', lastWithRpe: '2026-03-09' });
    expect(t.note).toMatch(/No se unen en una tendencia/);
    expect(methodTransitions.find((x) => x.exercise === 'Squat pausa')!.note).toMatch(/Sin RPE real/);
  });
  it('una vela necesita ≥ 2 observaciones comparables del mismo método: con menos no se fabrica', () => {
    const c = e1rmCandles(get('table-rpe', 'Squat (Barbell)'), '2026-03-31');
    expect(c.candles).toHaveLength(1);
    expect(c.candles[0]).toMatchObject({ weekFrom: '2026-03-02', n: 2 });
    const [a, b] = get('table-rpe', 'Squat (Barbell)').points;
    expect(c.candles[0]).toMatchObject({
      open: a!.value,
      close: b!.value,
      high: Math.max(a!.value, b!.value),
      low: Math.min(a!.value, b!.value),
    });
    expect(c.skipped).toEqual([
      { weekFrom: '2026-03-09', reason: 'menos de 2 observaciones comparables: no se fabrica una vela' },
    ]);
    expect(c.definition).toMatch(/open = primera observación/);
  });
  it('no usa observaciones posteriores al corte', () => {
    expect(e1rmCandles(get('table-rpe', 'Squat (Barbell)'), '2026-03-05').candles[0]!.n).toBe(2);
    expect(e1rmCandles(get('table-rpe', 'Squat (Barbell)'), '2026-03-03').candles).toHaveLength(0);
  });
  it('carga diaria solo en días con registro: sin ceros inventados para descansos desconocidos', () => {
    const d = dailyLoad(obs, '2026-03-01', '2026-03-10');
    expect(d.map((x) => x.date)).toEqual(['2026-03-02', '2026-03-04', '2026-03-06', '2026-03-09']);
    expect(d.every((x) => x.nl > 0)).toBe(true);
  });
  it('recuperación y anotaciones de cambios, intervenciones y competencias', () => {
    expect(
      recoverySeries(
        [
          { date: '2026-03-08', value: 7 },
          { date: '2026-02-01', value: 5 },
        ],
        '2026-03-01',
        '2026-03-31',
      ),
    ).toEqual([{ date: '2026-03-08', value: 7 }]);
    const a = annotations({
      changes: [{ id: 'e1', effectiveOn: null, detectedOn: '2026-03-05', summary: 'NL 18→24' }],
      interventions: [
        { id: 'i1', appliedOn: '2026-03-07', description: null },
        { id: 'i2', appliedOn: null, description: 'x' },
      ],
      competitions: [
        { id: 'c1', date: '2026-03-20', name: 'Provincial' },
        { id: 'c2', date: '2027-01-01', name: 'Fuera de rango' },
      ],
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(a.map((x) => [x.date, x.kind])).toEqual([
      ['2026-03-05', 'cambio'],
      ['2026-03-07', 'intervencion'],
      ['2026-03-20', 'competencia'],
    ]);
  });
});

describe('Macro y meso con duración variable', () => {
  const fx = new Fixture();
  fx.session('2026-03-02', row(150, 8, 8), { key: 'm1w1', block: 'B1', week: 1, exposure: 'sq' });
  fx.session('2026-03-09', row(152.5, 8, 8), { key: 'm1w2', block: 'B1', week: 2, exposure: 'sq' });
  fx.future('2026-03-16', [{ reps: 5, kg: null, plannedKg: 155 }], {
    key: 'm1w3',
    block: 'B1',
    week: 3,
    exposure: 'sq',
  });
  const observed = observedFromPlan(fx.planned, fx.actual, '2026-03-12');
  const base = {
    planned: fx.planned,
    actual: fx.actual,
    observed,
    competitionExercises: { SQ: 'Squat comp' as const },
    readiness: [],
    params: withMin(),
    cutoff: '2026-03-12',
  };
  it('resume cada microciclo con previsto y realizado, fechas explícitas o derivadas y semanas parciales', () => {
    const s = mesoSummary({
      ...base,
      blockKey: 'B1',
      meta: {
        blockKey: 'B1',
        macroId: 'M1',
        name: 'Acumulación',
        startDate: null,
        endDate: null,
        objective: 'fuerza',
      },
      micro: [{ blockKey: 'B1', weekNo: 1, startDate: '2026-03-02', endDate: '2026-03-08' }],
    });
    expect(s).toMatchObject({ name: 'Acumulación', objective: 'fuerza', durationWeeks: 3, closed: false });
    expect(s.microcycles[0]).toMatchObject({
      weekNo: 1,
      explicitDates: true,
      days: 7,
      partial: false,
      compliance: 1,
    });
    expect(s.microcycles[1]).toMatchObject({ explicitDates: false, partial: true }); // la semana del 9 al 15 sigue en curso
    expect(s.microcycles[2]!.actual).toBeNull(); // no se ejecutó: no hay un cero inventado
    expect(s.notes.join(' ')).toMatch(/semanas parciales/);
  });
  it('sin metadatos de meso lo dice; con ellos, nombre y objetivo', () => {
    expect(mesoSummary({ ...base, blockKey: 'B1' }).notes.join(' ')).toMatch(/Sin metadatos de meso/);
  });
  it('un macro admite mesos de duraciones distintas y detecta el meso activo', () => {
    const planned = [
      ...fx.planned,
      ...new Fixture().session('2026-04-06', row(150), { key: 'b2', block: 'B2', week: 1 }).planned,
    ];
    const m = macroSummary({
      macro: {
        id: 'M1',
        name: 'Temporada',
        startDate: '2026-03-02',
        endDate: null,
        objective: null,
        status: 'activo',
      },
      mesos: [
        {
          blockKey: 'B1',
          macroId: 'M1',
          name: 'Acumulación',
          startDate: null,
          endDate: null,
          objective: null,
        },
        {
          blockKey: 'B2',
          macroId: 'M1',
          name: 'Intensificación',
          startDate: '2026-04-06',
          endDate: '2026-04-19',
          objective: null,
        },
        { blockKey: 'X', macroId: 'otro', name: 'Ajeno', startDate: null, endDate: null, objective: null },
      ],
      planned,
      cutoff: '2026-03-12',
    });
    expect(m.mesos.map((x) => [x.blockKey, x.durationWeeks])).toEqual([
      ['B1', 3],
      ['B2', 2],
    ]);
    expect(m.activeMeso).toBe('B1');
    expect(m.durationWeeks).toBe(7); // 2026-03-02 → 2026-04-19: 49 días
  });
});
