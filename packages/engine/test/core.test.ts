import { describe, expect, it } from 'vitest';
import {
  computeCore,
  fatigueBetweenSets,
  muscleVolume,
  patternFor,
  patternOf,
  type ObservedSet,
} from '../src/index.js';

let n = 0;
const day = (d: number) => new Date(Date.UTC(2026, 0, 5 + d)).toISOString().slice(0, 10); // d=0 → lunes
function set(
  date: string,
  kg: number,
  reps: number,
  rpe: number | null,
  o: Partial<ObservedSet> = {},
): ObservedSet {
  return {
    id: `s${++n}`,
    source: 'plan',
    sessionKey: `ses-${date}`,
    date,
    exerciseName: 'Squat comp',
    exerciseId: 'squat-comp',
    lift: 'SQ',
    variantKey: 'Squat comp',
    setType: 'work',
    kg,
    reps,
    rpe,
    loadKind: 'total',
    plannedSetId: null,
    setNo: null,
    refKg: null,
    refSource: null,
    refAsOf: null,
    ...o,
  };
}
const sess = (d: number, rows: [number, number, number | null][], o: Partial<ObservedSet> = {}) =>
  rows.map(([kg, reps, rpe], i) => set(day(d), kg, reps, rpe, { setNo: i + 1, ...o }));
const base = (obs: ObservedSet[], cutoff = day(60), extra = {}) =>
  computeCore({ obs, cutoff, from: day(0), to: day(60), ...extra });

describe('NL, tonelaje, SI', () => {
  const obs = sess(0, [
    [100, 5, 8],
    [100, 5, 8.5],
    [100, 4, 9],
  ]);
  it('NL = Σ reps (no series), tonelaje = Σ kg×reps, SI en tres modelos separados', () => {
    const c = base(obs);
    expect(c.totals.nl.value).toBe(14);
    expect(c.totals.sets.value).toBe(3);
    expect(c.totals.tonnage.value).toBe(1400);
    expect(c.totals.si.rts.total.value).toBeGreaterThan(0);
    expect(c.totals.si.rts.model).toBe('rts-aprox-v1');
    expect(c.totals.si.efort.model).toBe('efort-xl-v1');
    expect(c.totals.si.prg.model).toBe('prg-si-v1');
    expect(c.totals.si.prg.status).toBe('unavailable'); // sin referencia de fuerza fechada
    expect(c.totals.si.prg.missing.length).toBeGreaterThan(0);
  });
  it('calentamientos fuera; sin RPE el SI es parcial/no disponible pero NL y tonelaje siguen', () => {
    const c = base([
      ...sess(0, [[60, 5, null]], { setType: 'warmup' }),
      ...sess(1, [
        [100, 5, null],
        [100, 5, null],
      ]),
    ]);
    expect(c.totals.nl.value).toBe(10);
    expect(c.totals.tonnage.value).toBe(1000);
    expect(c.totals.si.rts.total.status).toBe('unavailable');
    expect(c.warnings.join(' ')).toMatch(/sin RPE real/);
  });
  it('carga por lado / peso corporal no entran al tonelaje y se informan', () => {
    const c = base([
      ...sess(0, [[100, 5, 8]]),
      ...sess(0, [[30, 10, 8]], {
        sessionKey: 'ses-x',
        exerciseName: 'Row',
        exerciseId: 'row',
        loadKind: 'per_side',
      }),
    ]);
    expect(c.totals.tonnage.value).toBe(500);
    expect(c.totals.tonnage.status).toBe('partial');
  });
  it('respeta el corte: nada posterior entra', () => {
    const o = [...sess(0, [[100, 5, 8]]), ...sess(20, [[200, 5, 8]])];
    const c = base(o, day(10));
    expect(c.sessions).toHaveLength(1);
    expect(c.totals.tonnage.value).toBe(500);
  });
});

describe('Volumen por grupo muscular', () => {
  it('directas ×1, indirectas ×0,5; reps y tonelaje equivalentes; sin total entre músculos', () => {
    const v = muscleVolume(
      sess(0, [
        [100, 5, 8],
        [100, 5, 8],
      ]),
    );
    const quad = v.rows.find((r) => r.muscle === 'cuadriceps')!;
    expect(quad).toMatchObject({
      directSets: 2,
      indirectSets: 0,
      equivalentSets: 2,
      equivalentReps: 10,
      equivalentTonnage: 1000,
    });
    const core = v.rows.find((r) => r.muscle === 'core')!;
    expect(core).toMatchObject({
      directSets: 0,
      indirectSets: 2,
      equivalentSets: 1,
      equivalentReps: 5,
      equivalentTonnage: 500,
    });
    expect(JSON.stringify(v)).not.toMatch(/"total"/);
  });
  it('ejercicio fuera de la convención: no aporta y se informa; el calentamiento no cuenta', () => {
    const v = muscleVolume([
      ...sess(0, [[10, 10, 8]], { exerciseName: 'Ejercicio Inventado XYZ', exerciseId: 'zzz' }),
      ...sess(0, [[60, 5, null]], { setType: 'warmup' }),
    ]);
    expect(v.rows).toHaveLength(0);
    expect(v.unmappedExercises).toEqual(['Ejercicio Inventado XYZ']);
  });
  it('un día de pecho + espalda suma por grupo y por semana', () => {
    const o = [
      ...sess(
        0,
        [
          [80, 8, 8],
          [80, 8, 8],
        ],
        { exerciseName: 'Bench comp', exerciseId: 'bench-comp', lift: 'BP' },
      ),
      ...sess(0, [[60, 10, 8]], {
        sessionKey: 'ses-x',
        exerciseName: 'Seated Cable Row',
        exerciseId: 'seated-cable-row',
        lift: null,
      }),
    ];
    const c = base(o);
    expect(c.weeks[0]!.muscles.rows.find((r) => r.muscle === 'pectoral')!.directSets).toBe(2);
    expect(c.weeks[0]!.muscles.rows.find((r) => r.muscle === 'dorsales')!.directSets).toBe(1);
  });
});

describe('Fatiga entre series', () => {
  it('deriva de RPE, caída de reps a carga constante y caída del e1RM desde el máximo', () => {
    const b = fatigueBetweenSets(
      sess(0, [
        [100, 8, 8],
        [100, 7, 8.5],
        [100, 6, 9],
        [100, 5, 9.5],
      ]),
    );
    expect(b.status).not.toBe('unavailable');
    expect(b.rpe).toMatchObject({ first: 8, last: 9.5, delta: 1.5, n: 4 });
    expect(b.rpe!.slopePerSet).toBeCloseTo(0.5, 6);
    expect(b.reps).toMatchObject({ first: 8, last: 5, constantLoad: true });
    expect(b.reps!.dropPct).toBeCloseTo(37.5, 6);
    expect(b.e1rmCurve!.dropFromMaxPct).toBeGreaterThanOrEqual(0);
  });
  it('la carga variable no se interpreta como fatiga pura de repeticiones (se muestran, pero marcadas)', () => {
    const b = fatigueBetweenSets(
      sess(0, [
        [100, 5, 8],
        [90, 8, 8],
      ]),
    );
    expect(b.reps).toMatchObject({ values: [5, 8], constantLoad: false, dropPct: null });
    expect(b.load).toMatchObject({ first: 100, last: 90 });
    expect(b.notes.join(' ')).toMatch(/carga cambia/);
  });
  it('3×3@7 — RPE 6-7-7: cada serie frente a la anterior, a la primera y al objetivo', () => {
    const rows = sess(
      0,
      [
        [100, 3, 6],
        [100, 3, 7],
        [100, 3, 7],
      ],
      { plannedSetId: undefined },
    );
    const targets = new Map(rows.map((r, i) => [`p${i}`, { reps: 3, repsMax: null, rpe: 7, kg: 100 }]));
    rows.forEach((r, i) => (r.plannedSetId = `p${i}`));
    const b = fatigueBetweenSets(rows, 'recomendado', targets);
    expect(b.sets.map((x) => x.rpeVsTarget)).toEqual([-1, 0, 0]);
    expect(b.sets.map((x) => x.rpeVsPrevious)).toEqual([null, 1, 0]);
    expect(b.sets.map((x) => x.rpeVsFirst)).toEqual([null, 1, 1]);
    expect(b.rpe).toMatchObject({
      values: [6, 7, 7],
      pattern: 'ascendente',
      maxStepUp: 1,
      vsTarget: { above: 0, at: 2, below: 1, n: 3 },
    });
  });
  it('3×3@7 — RPE 7-8-8,5: la deriva real queda a la vista', () => {
    const rows = sess(0, [
      [100, 3, 7],
      [100, 3, 8],
      [100, 3, 8.5],
    ]);
    const targets = new Map(
      rows.map((r, i) => {
        r.plannedSetId = `q${i}`;
        return [`q${i}`, { reps: 3, repsMax: null, rpe: 7, kg: 100 }] as const;
      }),
    );
    const b = fatigueBetweenSets(rows, 'recomendado', targets);
    expect(b.sets.map((x) => x.rpeVsTarget)).toEqual([0, 1, 1.5]);
    expect(b.rpe).toMatchObject({
      pattern: 'ascendente',
      delta: 1.5,
      vsTarget: { above: 2, at: 1, below: 0, n: 3 },
    });
    expect(b.rpe!.slopePerSet).toBeCloseTo(0.75, 6);
  });
  it('3×8-10 con carga fija — 10-10-8: contra el rango previsto, repeticiones perdidas y patrón', () => {
    const rows = sess(0, [
      [80, 10, null],
      [80, 10, null],
      [80, 8, null],
    ]);
    const targets = new Map(
      rows.map((r, i) => {
        r.plannedSetId = `r${i}`;
        return [`r${i}`, { reps: 8, repsMax: 10, rpe: null, kg: 80 }] as const;
      }),
    );
    const b = fatigueBetweenSets(rows, 'recomendado', targets);
    expect(b.reps).toMatchObject({
      values: [10, 10, 8],
      pattern: 'descendente',
      constantLoad: true,
      lostBestToLast: 2,
      target: { reps: 8, repsMax: 10 },
      vsTarget: { above: 0, within: 3, below: 0, n: 3 },
    });
    expect(b.reps!.dropPct).toBeCloseTo(20, 6);
    expect(b.sets.map((x) => x.repsVsPrevious)).toEqual([null, 0, -2]);
    expect(b.sets.map((x) => x.repsLostVsBest)).toEqual([0, 0, 2]);
    expect(b.sets.every((x) => x.repsVsTarget?.position === 'en_rango')).toBe(true);
    // sin RPE no hay deriva de RPE, pero las repeticiones sí cuentan
    expect(b.rpe).toBeNull();
    expect(b.status).not.toBe('unavailable');
  });
  it('fuera del rango previsto: sobre y bajo, con la distancia', () => {
    const rows = sess(0, [
      [80, 12, null],
      [80, 9, null],
      [80, 6, null],
    ]);
    const targets = new Map(
      rows.map((r, i) => {
        r.plannedSetId = `s${i}`;
        return [`s${i}`, { reps: 8, repsMax: 10, rpe: null, kg: 80 }] as const;
      }),
    );
    const b = fatigueBetweenSets(rows, 'recomendado', targets);
    expect(b.sets.map((x) => x.repsVsTarget)).toEqual([
      { position: 'sobre_rango', delta: 2 },
      { position: 'en_rango', delta: 0 },
      { position: 'bajo_rango', delta: -2 },
    ]);
    expect(b.reps!.vsTarget).toEqual({ above: 1, within: 1, below: 1, n: 3 });
  });
  it('patrones solo por el signo de los pasos: estable, mixto, descendente', () => {
    expect(patternOf([7, 7, 7])).toBe('estable');
    expect(patternOf([7, 8, 7.5])).toBe('mixto');
    expect(patternOf([10, 10, 8])).toBe('descendente');
    expect(patternOf([6, 7, 7])).toBe('ascendente');
  });
  it('con la prescripción vinculada (computeCore) cada serie trae su objetivo', () => {
    const rows = sess(0, [
      [100, 5, 8],
      [100, 5, 9],
    ]);
    rows.forEach((r, i) => (r.plannedSetId = `pl${i}`));
    const planned = rows.map((r, i) => ({
      id: `pl${i}`,
      reps: 5,
      targetRpe: 8,
      plannedKg: 100,
      protocol: i === 0 ? { repsMax: 6 } : null,
    }));
    const c = computeCore({
      obs: rows,
      cutoff: day(10),
      from: day(0),
      to: day(10),
      planned: planned as never,
    });
    const f = c.sessions[0]!.exercises[0]!.fatigueBetweenSets;
    expect(f.sets[0]!.target).toEqual({ reps: 5, repsMax: 6, rpe: 8, kg: 100 });
    expect(f.sets[1]!.rpeVsTarget).toBe(1);
  });
  it('sin orden de series no se infiere; una sola serie no alcanza; sin RPE no hay deriva', () => {
    expect(fatigueBetweenSets([set(day(0), 100, 5, 8), set(day(0), 100, 5, 9)]).status).toBe('unavailable');
    expect(fatigueBetweenSets(sess(0, [[100, 5, 8]])).status).toBe('unavailable');
    const noRpe = fatigueBetweenSets(
      sess(0, [
        [100, 5, null],
        [100, 4, null],
      ]),
    );
    expect(noRpe.rpe).toBeNull();
    expect(noRpe.reps?.first).toBe(5);
    expect(noRpe.reasons.join(' ')).toMatch(/RPE real/);
  });
  it('queda en cada ejercicio de cada sesión del resultado', () => {
    const c = base(
      sess(0, [
        [100, 5, 8],
        [100, 5, 9],
      ]),
    );
    expect(c.sessions[0]!.exercises[0]!.fatigueBetweenSets.rpe?.delta).toBe(1);
    expect(c.weeks[0]!.fatigue.meanRpeDriftPerSession).toBe(1);
  });
});

describe('Fatiga entre sesiones', () => {
  const mk = () =>
    [0, 3, 7, 10, 14, 17, 21, 24, 28, 31, 35, 38].flatMap((d, i) =>
      sess(d, [
        [100 + i, 5, 8],
        [100 + i, 5, 8.5],
      ]),
    );
  it('días desde la sesión anterior, cambios frente a la anterior del mismo ejercicio y fatiga reportada', () => {
    const o = mk();
    const fb = [
      { sessionKey: `ses-${day(0)}`, endFatigue: 4 },
      { sessionKey: `ses-${day(3)}`, endFatigue: 7 },
    ];
    const c = computeCore({ obs: o, cutoff: day(60), from: day(0), to: day(60), feedback: fb });
    const s1 = c.sessions[1]!;
    expect(s1.fatigue.daysSincePreviousSession).toBe(3);
    expect(s1.fatigue.endFatigue).toBe(7);
    expect(s1.fatigue.endFatigueDelta).toBe(3);
    expect(s1.exercises[0]!.vsPrevious).toMatchObject({ previousDate: day(0), daysSince: 3, topKgDelta: 1 });
    expect(c.sessions[0]!.exercises[0]!.vsPrevious).toBeNull();
  });
  it('razón agudo/crónico solo con ≥ 28 días de historia previa; antes, null con motivo', () => {
    const c = computeCore({ obs: mk(), cutoff: day(60), from: day(0), to: day(60) });
    expect(c.sessions[2]!.fatigue.rolling.ratio).toBeNull();
    expect(c.sessions[2]!.fatigue.rolling.coverage).toMatch(/< 28/);
    const late = c.sessions.at(-1)!.fatigue.rolling;
    expect(late.ratio).not.toBeNull();
    expect(late.ratio!.nl).toBeGreaterThan(0);
    expect(late.acute7.sessions).toBeGreaterThan(0);
  });
  it('preparación previa con su antigüedad; sin check-in, null', () => {
    const o = mk();
    const c = computeCore({
      obs: o,
      cutoff: day(60),
      from: day(0),
      to: day(60),
      readiness: [{ date: day(-2), value: 70 }] as never,
    });
    expect(c.sessions[0]!.fatigue.readiness).toMatchObject({ value: 70, ageDays: 2 });
    expect(base(o).sessions[0]!.fatigue.readiness).toBeNull();
  });
  it('semana vs semana anterior: razón solo si ambas están completas', () => {
    const c = computeCore({ obs: mk(), cutoff: day(41), from: day(0), to: day(41) });
    const full = c.weeks.find((w) => !w.week.partial && w.fatigue.vsPreviousWeek?.comparable);
    expect(full?.fatigue.vsPreviousWeek?.nl).not.toBeNull();
    const partial = computeCore({ obs: mk(), cutoff: day(38), from: day(0), to: day(38) }).weeks.at(-1)!;
    expect(partial.week.partial).toBe(true);
    expect(partial.fatigue.vsPreviousWeek?.comparable).toBe(false);
    expect(partial.fatigue.vsPreviousWeek?.nl).toBeNull();
    expect(partial.fatigue.vsPreviousWeek?.reason).toMatch(/parcial/);
  });
  it('filtra por movimiento y por fuente', () => {
    const o = [
      ...mk(),
      ...sess(1, [[50, 10, 8]], {
        sessionKey: 'h',
        source: 'hevy',
        exerciseName: 'Bench comp',
        exerciseId: 'bench-comp',
        lift: 'BP',
      }),
    ];
    expect(
      computeCore({ obs: o, cutoff: day(60), from: day(0), to: day(60), lift: 'BP' }).sessions,
    ).toHaveLength(1);
    expect(
      computeCore({ obs: o, cutoff: day(60), from: day(0), to: day(60), source: 'hevy' }).totals.nl.value,
    ).toBe(10);
  });
});

describe('Rango de repeticiones en la prescripción', () => {
  it('3x8-10 se guarda estructurado (reps = 8, repsMax = 10), sin depender de texto libre', async () => {
    const { parseCanonicalPlan } = await import('../src/index.js');
    const csv =
      'block,week,date,exercise,protocol,exposure_id,lift\nB1,1,2026-03-02,Squat comp,"3x8-10x100",sq-primaria,SQ\nB1,1,2026-03-04,Bench comp,"3x5@8",bp-primaria,BP\n';
    const r = parseCanonicalPlan(csv, {});
    expect(r.ok).toBe(true);
    const sq = r.sets.filter((s) => s.exerciseName === 'Squat comp');
    expect(sq).toHaveLength(3);
    expect(sq[0]).toMatchObject({ reps: 8, plannedKg: 100 });
    expect(sq[0]!.protocol).toMatchObject({ repsMax: 10 });
    expect(r.sets.find((s) => s.exerciseName === 'Bench comp')!.protocol?.repsMax ?? null).toBeNull();
  });
});

describe('Patrón de movimiento (otra dimensión: cada ejercicio en un solo patrón)', () => {
  const id = (n: string) =>
    n
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  it('clasifica ejercicios típicos y deja sin patrón lo desconocido', () => {
    const p = (n: string) => patternFor(id(n), n);
    expect(p('Squat (Barbell)')).toBe('sentadilla');
    expect(p('Leg Press (Machine)')).toBe('sentadilla');
    expect(p('Romanian Deadlift (Barbell)')).toBe('bisagra_cadera');
    expect(p('Hip Thrust (Barbell)')).toBe('bisagra_cadera');
    expect(p('Bulgarian Split Squat')).toBe('unilateral_pierna');
    expect(p('Bench Press (Barbell)')).toBe('empuje_horizontal');
    expect(p('Overhead Press (Barbell)')).toBe('empuje_vertical');
    expect(p('Bent Over Row (Barbell)')).toBe('traccion_horizontal');
    expect(p('Lat Pulldown (Cable)')).toBe('traccion_vertical');
    expect(p('Leg Extension (Machine)')).toBe('aislamiento_pierna');
    expect(p('Bicep Curl (Dumbbell)')).toBe('aislamiento_brazos');
    expect(p('Face Pull (Cable)')).toBe('aislamiento_hombro_espalda');
    expect(p('Hanging Leg Raise')).toBe('core');
    expect(p('Farmers Walk')).toBe('transporte_olimpico');
    expect(p('Rowing Machine')).toBeNull();
    expect(p('Ejercicio Inventado XYZ')).toBeNull();
  });
  it('la suma de series, NL y tonelaje por patrón es el total de lo mapeado (los músculos, en cambio, se superponen)', () => {
    const o = [
      ...sess(0, [
        [100, 5, 8],
        [100, 5, 8],
      ]),
      ...sess(0, [[80, 8, 8]], {
        sessionKey: 'x',
        exerciseName: 'Bench comp',
        exerciseId: 'bench-comp',
        lift: 'BP',
      }),
      ...sess(0, [[60, 10, 8]], {
        sessionKey: 'x',
        exerciseName: 'Seated Cable Row',
        exerciseId: 'seated-cable-row',
        lift: null,
      }),
    ];
    const c = computeCore({ obs: o, cutoff: day(10), from: day(0), to: day(10) });
    const rows = c.patterns.rows;
    expect(rows.reduce((a, r) => a + r.sets, 0)).toBe(4);
    expect(rows.reduce((a, r) => a + r.nl, 0)).toBe(c.totals.nl.value);
    expect(rows.reduce((a, r) => a + (r.tonnage ?? 0), 0)).toBe(c.totals.tonnage.value);
    // el SI por patrón también suma el SI total (todas las series tienen RPE)
    expect(rows.reduce((a, r) => a + (r.si?.total ?? 0), 0)).toBeCloseTo(c.totals.si.rts.total.value ?? 0, 6);
    expect(
      c.sessions
        .flatMap((s) => s.exercises)
        .map((e) => e.pattern)
        .sort(),
    ).toEqual(['empuje_horizontal', 'sentadilla', 'traccion_horizontal']);
    expect(c.weeks[0]!.patterns.rows.length).toBe(3);
  });
});

describe('accesorios y prioridad del plan', () => {
  it('un accesorio (sin movimiento principal) no tiene e1RM; un movimiento sí', () => {
    const o = [
      ...sess(0, [[100, 5, 8]]),
      ...sess(0, [[40, 10, 8]], {
        sessionKey: 'x',
        exerciseName: 'Curl barra',
        exerciseId: 'curl-barra',
        lift: null,
      }),
    ];
    const c = computeCore({ obs: o, cutoff: day(10), from: day(0), to: day(10) });
    const ex = c.sessions.flatMap((s) => s.exercises);
    const curl = ex.find((e) => e.exerciseName === 'Curl barra')!;
    const main = ex.find((e) => e.exerciseName !== 'Curl barra')!;
    expect(curl.metrics.e1rm.curve.value).toBeNull();
    expect(curl.metrics.e1rm.curve.missing[0]).toMatch(/accesorio/);
    expect(curl.bestE1rm.curve).toBeNull();
    expect(main.metrics.e1rm.curve.value).not.toBeNull();
  });
});
