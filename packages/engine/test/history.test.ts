import { describe, expect, it } from 'vitest';
import { compareBlocks } from '../src/compare.js';
import { diffSnapshots, type ChangeEvent } from '../src/diff.js';
import { executionDeviations, followUps } from '../src/outcomes.js';
import { canonicalPlan, fingerprint, plansEqual } from '../src/snapshot.js';
import { Fixture, row, snapshot, withMin } from './helpers.js';

const sess = (
  fx: Fixture,
  key: string,
  date: string,
  sets: number,
  reps: number,
  o: Parameters<Fixture['session']>[2] = {},
) =>
  fx.session(
    date,
    Array.from({ length: sets }, () => ({ reps, kg: null, rpe: null, target: 8 })),
    { key, ...o },
  );
const only = (e: ChangeEvent) => e.changes[0]!;

describe('Detección automática de cambios (historial)', () => {
  it('3×6 → 4×6 detecta 18→24 NL (+33,3 %), no "18→24 series"', () => {
    const a = sess(new Fixture(), 'w1', '2026-03-02', 3, 6);
    const b = sess(new Fixture(), 'w1', '2026-03-02', 4, 6);
    const ev = diffSnapshots(snapshot('v1', 1, a), snapshot('v2', 2, b));
    const c = only(ev);
    expect(c.classification).toBe('volumen_aumentado');
    const nl = c.deltas.find((d) => d.variable === 'NL por semana')!;
    expect([nl.before, nl.after, nl.delta]).toEqual([18, 24, 6]);
    expect(nl.pct).toBeCloseTo(33.333, 2);
    expect(c.deltas.find((d) => d.variable === 'Series por semana')).toMatchObject({ before: 3, after: 4 });
    expect(c.summary).toMatch(/NL semanales 18→24/);
    expect(ev.setChanges.added).toBe(1);
    expect(ev.actor).toBeNull(); // sin auditoría no se atribuye autor
    expect(ev.coachComment).toBe(''); // el motivo es opcional: no se inventa
  });

  it('24 NL con frecuencia 2 → 3 es una redistribución, no un aumento de volumen', () => {
    const a = new Fixture();
    sess(a, 'd1', '2026-03-02', 4, 3, { day: 1 });
    sess(a, 'd3', '2026-03-04', 4, 3, { day: 3 });
    const b = new Fixture();
    sess(b, 'd1', '2026-03-02', 4, 2, { day: 1 });
    sess(b, 'd3', '2026-03-04', 4, 2, { day: 3 });
    sess(b, 'd5', '2026-03-06', 4, 2, { day: 5 });
    const c = only(diffSnapshots(snapshot('v1', 1, a), snapshot('v2', 2, b)));
    expect(c.classification).toBe('redistribucion_frecuencia');
    expect(c.deltas.find((d) => d.variable === 'NL por semana')).toMatchObject({
      before: 24,
      after: 24,
      delta: 0,
    });
    expect(c.deltas.find((d) => d.variable === 'Frecuencia')).toMatchObject({ before: 2, after: 3 });
    expect(c.distribution).toEqual({ before: { 1: 12, 3: 12 }, after: { 1: 8, 3: 8, 5: 8 } });
    expect(c.caveats.join(' ')).toMatch(/Igual NL no implica estímulo idéntico/);
  });

  it('12 series 6+6 → 4+4+4 conserva volumen; 6+6+6 cambia dos variables (mixto)', () => {
    const a = new Fixture();
    sess(a, 'd1', '2026-03-02', 6, 5, { day: 1 });
    sess(a, 'd3', '2026-03-04', 6, 5, { day: 3 });
    const same = new Fixture();
    [1, 3, 5].forEach((d, i) => sess(same, `d${d}`, `2026-03-0${2 + i * 2}`, 4, 5, { day: d }));
    const more = new Fixture();
    [1, 3, 5].forEach((d, i) => sess(more, `d${d}`, `2026-03-0${2 + i * 2}`, 6, 5, { day: d }));
    expect(only(diffSnapshots(snapshot('a', 1, a), snapshot('b', 2, same))).classification).toBe(
      'redistribucion_frecuencia',
    );
    expect(only(diffSnapshots(snapshot('a', 1, a), snapshot('c', 2, more))).classification).toBe('mixto');
  });

  it('misma dosis semanal con 4 → 6 semanas: cambia la duración, no la dosis', () => {
    const mk = (weeks: number) => {
      const fx = new Fixture();
      for (let w = 1; w <= weeks; w++)
        sess(fx, `w${w}`, `2026-03-${String(1 + w).padStart(2, '0')}`, 3, 6, { week: w });
      return fx;
    };
    const ev = diffSnapshots(snapshot('a', 1, mk(4)), snapshot('b', 2, mk(6)));
    const c = only(ev);
    expect(c.classification).toBe('cambio_duracion');
    expect(c.deltas.find((d) => d.variable === 'NL por semana')).toMatchObject({
      before: 18,
      after: 18,
      delta: 0,
    });
    expect(c.deltas.find((d) => d.variable === 'NL total del bloque')).toMatchObject({
      before: 72,
      after: 108,
    });
    expect(c.summary).toMatch(/dosis semanal sin cambios/);
  });

  it('cambio de referencia sin cambiar las series ≠ cambio de kg', () => {
    const mk = (ref: number) =>
      new Fixture().session('2026-03-02', [{ reps: 5, kg: 150, rpe: 8, plannedKg: 150 }], {
        key: 'k1',
        refKg: ref,
      });
    const c = only(diffSnapshots(snapshot('a', 1, mk(180)), snapshot('b', 2, mk(190))));
    expect(c.classification).toBe('cambio_referencia_modelo');
    expect(c.summary).toMatch(/referencia 1RM sin cambiar las series/);
    expect(c.deltas.find((d) => d.variable === 'Intensidad relativa media')!.delta).not.toBe(0);
    expect(c.deltas.find((d) => d.variable === 'Carga media')?.delta).toBe(0);
  });

  it('igual NL con otra estructura de series: cambio de perfil, nunca "mismo estrés"', () => {
    const a = sess(new Fixture(), 'w1', '2026-03-02', 4, 3);
    const b = sess(new Fixture(), 'w1', '2026-03-02', 3, 4);
    const c = only(diffSnapshots(snapshot('a', 1, a), snapshot('b', 2, b)));
    expect(c.classification).toBe('cambio_perfil_estimulo');
    expect(c.deltas.find((d) => d.variable === 'NL por semana')!.delta).toBe(0);
    expect(c.caveats.join(' ')).toMatch(/Igual NL no implica estímulo idéntico/);
    expect(c.deltas.some((d) => d.variable === 'SI central')).toBe(true);
  });

  it('sin RPE objetivo no se inventa el SI planificado', () => {
    const mk = (sets: number) =>
      new Fixture().session(
        '2026-03-02',
        Array.from({ length: sets }, () => ({ reps: 6, kg: null, rpe: null, target: null })),
        { key: 'w1' },
      );
    const c = only(diffSnapshots(snapshot('a', 1, mk(3)), snapshot('b', 2, mk(4))));
    expect(c.deltas.some((d) => d.variable.startsWith('SI'))).toBe(false);
    expect(c.caveats.join(' ')).toMatch(/SI no comparable/);
  });

  it('reordenar filas con IDs estables o guardar dos veces no crea cambios', () => {
    const fx = sess(new Fixture(), 'w1', '2026-03-02', 3, 6);
    const shuffled = [...fx.planned].reverse();
    expect(plansEqual(fx.planned, shuffled)).toBe(true);
    expect(canonicalPlan(fx.planned)).toBe(canonicalPlan(shuffled));
    expect(fingerprint(fx.planned)).toBe(fingerprint(shuffled));
    const ev = diffSnapshots(snapshot('a', 1, fx), { ...snapshot('b', 2, fx), sets: shuffled });
    expect(ev.changes).toHaveLength(0);
    expect(ev.setChanges).toMatchObject({ added: 0, removed: 0, modified: 0 });
  });

  it('un cambio de fecha efectiva informada vs. estimada se distingue', () => {
    const a = sess(new Fixture(), 'w1', '2026-03-02', 3, 6);
    const b = sess(new Fixture(), 'w1', '2026-03-02', 4, 6);
    const est = diffSnapshots(snapshot('a', 1, a), snapshot('b', 2, b));
    const known = diffSnapshots(snapshot('a', 1, a), snapshot('b', 2, b, { effectiveOn: '2026-03-09' }));
    expect(est).toMatchObject({ effectiveOn: '2026-03-02', effectiveEstimated: true });
    expect(known).toMatchObject({ effectiveOn: '2026-03-09', effectiveEstimated: false });
  });
});

describe('Desviación de ejecución ≠ cambio de plan', () => {
  it('ejecutó 18 NL frente a 24 previstos: cumplimiento 75 %', () => {
    const fx = new Fixture();
    fx.session('2026-03-02', [...row(150, 8, 8, 6, 3), { reps: 6, kg: null, rpe: null, status: 'skipped' }], {
      key: 'w1',
    });
    const dev = executionDeviations(fx.planned, fx.actual, '2026-03-10', 0.9)[0]!;
    expect(dev).toMatchObject({ plannedNl: 24, doneNl: 18, compliance: 0.75, status: 'desviacion' });
    expect(dev.text).toMatch(/no una reducción elegida por el coach/);
  });
  it('una semana sin ningún registro es "sin registro", no incumplimiento ni descarga', () => {
    const fx = new Fixture().future(
      '2026-03-02',
      [
        { reps: 5, kg: null },
        { reps: 5, kg: null },
      ],
      { key: 'w1' },
    );
    expect(executionDeviations(fx.planned, fx.actual, '2026-03-10', 0.9)[0]!.status).toBe('sin_registro');
  });
});

describe('Seguimiento posterior sin afirmar causalidad', () => {
  const evNL = () =>
    diffSnapshots(
      snapshot('a', 1, sess(new Fixture(), 'w1', '2026-03-02', 3, 6)),
      snapshot('b', 2, sess(new Fixture(), 'w1', '2026-03-02', 4, 6), { effectiveOn: '2026-03-01' }),
    );
  const history = (kgAfter: number[]) => {
    const fx = new Fixture();
    ['2026-02-01', '2026-02-08', '2026-02-15'].forEach((d, i) =>
      fx.session(d, row(150 + i * 0, 8, 8), { key: `p${i}` }),
    );
    kgAfter.forEach((kg, i) =>
      fx.session(`2026-03-${String(2 + i * 7).padStart(2, '0')}`, row(kg, 8, 8), { key: `q${i}` }),
    );
    return fx;
  };
  const inp = (fx: Fixture, cutoff: string, events: ChangeEvent[]) => ({
    planned: fx.planned,
    actual: fx.actual,
    readiness: [],
    competitionExercises: { SQ: 'Squat comp' },
    cutoff,
    params: withMin(),
    events,
  });

  it('un cambio que todavía no rige no tiene seguimiento (fecha efectiva futura)', () => {
    const e = evNL();
    const o = followUps(e, inp(history([]), '2026-02-20', [e]))[0]!;
    expect(o.state).toBe('pendiente');
    expect(o.text).toMatch(/todavía no empezó/);
  });
  it('sin exposiciones posteriores: pendiente, no positivo por defecto', () => {
    const e = evNL();
    const o = followUps(e, inp(history([]), '2026-03-05', [e]))[0]!;
    expect(o.state).toBe('pendiente');
    expect(o.text).toMatch(/No se evalúa todavía/);
  });
  it('con exposiciones suficientes describe lo observado y aclara que no es causal', () => {
    const e = evNL();
    const o = followUps(e, inp(history([155, 157.5, 160]), '2026-04-01', [e]))[0]!;
    expect(o.state).toBe('evaluado');
    expect(o.deltaKg).toBeGreaterThan(0);
    expect(o.text).toMatch(/se observó/);
    expect(o.text).toMatch(/no una prueba de causalidad/);
    expect(o.text).not.toMatch(/produjo|causó|gracias/i);
  });
  it('otro cambio dentro de la ventana marca el seguimiento como afectado', () => {
    const e = evNL();
    const other: ChangeEvent = { ...evNL(), id: 'otro', effectiveOn: '2026-03-10' };
    const o = followUps(e, inp(history([155, 157.5, 160]), '2026-04-01', [e, other]))[0]!;
    expect(o.state).toBe('afectado');
    expect(o.competing[0]).toMatch(/otro/);
    expect(o.text).toMatch(/coincidió con/);
  });
  it('sin historial previo comparable no se arma un relato', () => {
    const e = evNL();
    const fx = new Fixture();
    [155, 157.5, 160].forEach((kg, i) =>
      fx.session(`2026-03-${String(2 + i * 7).padStart(2, '0')}`, row(kg), { key: `q${i}` }),
    );
    expect(followUps(e, inp(fx, '2026-04-01', [e]))[0]!.state).toBe('sin_referencia');
  });
});

describe('Comparativas A/B', () => {
  const twoBlocks = () => {
    const fx = new Fixture();
    for (let w = 1; w <= 4; w++)
      fx.session(`2026-01-${String(4 + w * 7).padStart(2, '0')}`, row(140 + w * 2.5, 8, 8, 6), {
        key: `a${w}`,
        block: 'A',
        week: w,
        refKg: 200,
      });
    for (let w = 1; w <= 6; w++)
      fx.session(`2026-03-${String(1 + w * 3).padStart(2, '0')}`, row(150 + w, 8, 8, 6), {
        key: `b${w}`,
        block: 'B',
        week: w,
        refKg: 200,
      });
    return fx;
  };
  const input = (fx: Fixture) => ({
    planned: fx.planned,
    actual: fx.actual,
    readiness: [],
    competitionExercises: { SQ: 'Squat comp' as const },
    cutoff: '2026-12-31',
    params: withMin(),
  });
  const sideA = { lift: 'SQ' as const, blockKey: 'A' };
  const sideB = { lift: 'SQ' as const, blockKey: 'B' };
  const rowOf = (c: ReturnType<typeof compareBlocks>, k: string) => c.rows.find((r) => r.key === k)!;

  it('bloques de 4 y 6 semanas se comparan por semana y muestran la duración', () => {
    const c = compareBlocks(input(twoBlocks()), sideA, sideB, 'planned', 'full');
    expect([c.weeksA, c.weeksB]).toEqual([4, 6]);
    expect(rowOf(c, 'nl')).toMatchObject({ a: 18, b: 18, diff: 0 });
    expect(rowOf(c, 'nl_total')).toMatchObject({ a: 72, b: 108 });
    expect(c.notes.join(' ')).toMatch(/POR SEMANA/);
  });
  it('la vista compartida usa las primeras N semanas y N es visible', () => {
    const c = compareBlocks(input(twoBlocks()), sideA, sideB, 'planned', 'shared');
    expect(c.sharedWeeks).toBe(4);
    expect(rowOf(c, 'nl_total')).toMatchObject({ a: 72, b: 72 });
    expect(c.notes.join(' ')).toMatch(/primeras 4 semanas compartidas/);
  });
  it('planificado y realizado son universos distintos: lo no ejecutado no cuenta', () => {
    const fx = twoBlocks();
    // el atleta ejecutó solo el bloque A, con 4 reps por serie en lugar de 6
    const done = fx.planned
      .filter((s) => s.blockKey === 'A')
      .map((s) => ({
        plannedSetId: s.id,
        status: 'done' as const,
        kg: 140,
        reps: 4,
        rpe: 8,
        performedOn: s.plannedDate,
        pain: null,
      }));
    const real = compareBlocks({ ...input(fx), actual: done }, sideA, sideB, 'actual', 'full');
    expect(rowOf(real, 'nl').a).toBe(12);
    expect(rowOf(real, 'nl').b).toBeNull();
    expect(rowOf(real, 'nl').coverage).toBe('parcial');
    expect(rowOf(compareBlocks(input(fx), sideA, sideB, 'planned', 'full'), 'nl').a).toBe(18);
  });
  it('SI planificado solo con RPE objetivo completo; el modelo queda nombrado', () => {
    const c = compareBlocks(input(twoBlocks()), sideA, sideB, 'planned', 'full');
    expect(rowOf(c, 'si_total').a).not.toBeNull();
    expect(rowOf(c, 'si_total').note).toMatch(/rts-aprox-v1/);
    const fx = new Fixture()
      .session('2026-03-02', [{ reps: 5, kg: 100, rpe: null, target: null }], { block: 'A' })
      .session('2026-03-09', [{ reps: 5, kg: 100, rpe: null, target: null }], { block: 'B' });
    expect(rowOf(compareBlocks(input(fx), sideA, sideB, 'planned', 'full'), 'si_total')).toMatchObject({
      a: null,
      b: null,
      coverage: 'sin_datos',
    });
  });
  it('el contexto global no suma máximos no simultáneos como total real', () => {
    const c = compareBlocks(
      input(twoBlocks()),
      { lift: 'ALL', blockKey: 'A' },
      { lift: 'ALL', blockKey: 'B' },
      'actual',
      'full',
    );
    expect(rowOf(c, 'e_start').a).toBeNull();
    expect(rowOf(c, 'e_start').note).toMatch(/máximos no simultáneos/);
  });
});
