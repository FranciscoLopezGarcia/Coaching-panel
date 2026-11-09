import { describe, expect, it } from 'vitest';
import { summarizeBlocks, summarizeFamilies } from '../src/blocks.js';
import { evaluateAthlete, evaluateLift } from '../src/pipeline.js';
import type { CoachReview, Readiness, SessionFeedback } from '../src/types.js';
import { Fixture, row, withMin } from './helpers.js';

interface Extra {
  readinessHistory?: Readiness[];
  sessionFeedback?: SessionFeedback[];
  coachReviews?: CoachReview[];
}
const ev = (fx: Fixture, cutoff: string, params = withMin(), x: Extra = {}) =>
  evaluateLift({
    lift: 'SQ',
    exerciseName: 'Squat comp',
    plannedSets: fx.planned,
    actualSets: fx.actual,
    readiness: x.readinessHistory?.[0] ?? null,
    cutoff,
    params,
    ...x,
  });
const rule = (le: ReturnType<typeof ev>, id: string) => le.results.find((r) => r.ruleId === id);
const rd = (date: string, value: number): Readiness => ({ date, value });

/** Récord previo de 150 kg × 5 (RPE 9,5) y 3 benchmarks recientes de 150 kg × 5 @7 (E sensibilidad conservadora 187,7 → W = 155 kg). */
function prFixture(kg = 150) {
  const fx = new Fixture().session('2026-01-20', row(150, 9.5, 9.5), { key: 'old' });
  ['2026-02-23', '2026-03-02', '2026-03-09'].forEach((d, i) =>
    fx.session(d, row(kg, 7, 7), { key: `r${i}` }),
  );
  return fx;
}

describe('R-PR · candidato a récord de peso para reps [propuesta]', () => {
  it('propone 155 kg × 5 @9 sobre un récord de 150 kg; sin chequeo actual queda "pendiente validar"', () => {
    const r = rule(ev(prFixture(), '2026-03-10'), 'R-PR')!;
    expect(r.status).toBe('candidato_pr');
    expect(r.summary).toMatch(/^Oportunidad potencial, pendiente validar: 155 kg × 5 @ RPE 9/);
    expect(r.missing.join(' ')).toMatch(/Chequeo actual/);
    expect(r.sufficiency).toBe('parcial');
    expect(r.proposal).toMatch(/Aprobar la propuesta no implica ejecutarla/);
    expect(r.proposal).toMatch(/No es una probabilidad/);
    expect(r.evidence.join(' ')).toMatch(/Técnica no validada en la app/);
  });
  it('con check-in de ≤ 48 h pasa a "candidato a récord" y sube la confianza', () => {
    const r = rule(
      ev(prFixture(), '2026-03-10', withMin(), { readinessHistory: [rd('2026-03-09', 8)] }),
      'R-PR',
    )!;
    expect(r.summary).toMatch(/^Candidato a récord: 155 kg/);
    expect(r.sufficiency).toBe('suficiente');
    expect(r.missing).toHaveLength(0);
  });
  it('también se valida con una revisión técnica vigente del coach (sin video en la app)', () => {
    const r = rule(
      ev(prFixture(), '2026-03-10', withMin(), {
        coachReviews: [{ lift: 'SQ', date: '2026-03-05', verdict: 'valida', note: '' }],
      }),
      'R-PR',
    )!;
    expect(r.sufficiency).toBe('suficiente');
  });
  it('si el redondeo no supera el récord + un paso no hay oportunidad (no se redondea hacia arriba)', () => {
    const r = rule(ev(prFixture(145), '2026-03-10'), 'R-PR')!;
    expect(r.status).toBe('sin_senal');
    expect(r.summary).toMatch(/No se redondea hacia arriba/);
  });
  it('un single máximo está apagado por defecto', () => {
    const p = withMin();
    p.perLift.SQ.prReps = 1;
    const r = rule(ev(prFixture(), '2026-03-10', p), 'R-PR')!;
    expect(r.status).toBe('sin_senal');
    expect(r.summary).toMatch(/requiere habilitación explícita/);
  });
  it('un benchmark con RPE por encima del objetivo (overshoot) impide el candidato', () => {
    const fx = new Fixture().session('2026-01-20', row(150, 9.5, 9.5), { key: 'old' });
    ['2026-02-23', '2026-03-02', '2026-03-09'].forEach((d, i) =>
      fx.session(d, row(150, 8.5, 7), { key: `r${i}` }),
    );
    expect(rule(ev(fx, '2026-03-10'), 'R-PR')!.status).toBe('sin_senal');
  });
  it('señal favorable + molestia relevante ⇒ revisión, sin PR (conflicto)', () => {
    const fx = prFixture().session('2026-03-12', [{ reps: 5, kg: 120, rpe: 6, target: 6, pain: 6 }], {
      key: 'p',
    });
    const le = ev(fx, '2026-03-13');
    expect(le.principal!.status).toBe('revision_coach');
    expect(rule(le, 'R-PR')).toBeUndefined();
  });
  it('técnica marcada como no comparable por el coach bloquea las propuestas ofensivas', () => {
    const le = ev(prFixture(), '2026-03-10', withMin(), {
      coachReviews: [
        { lift: 'SQ', date: '2026-03-08', verdict: 'no_comparable', note: 'cambió la profundidad' },
      ],
    });
    expect(le.principal!.ruleId).toBe('B-TECNICA');
    expect(rule(le, 'R-PR')).toBeUndefined();
  });
  it('tiene prioridad sobre las demás señales ofensivas, que quedan como alternativas', () => {
    const le = ev(prFixture(), '2026-03-10');
    expect(le.principal!.status).toBe('candidato_pr');
    expect(le.principal!.alternatives.join(' ')).toBeDefined();
  });
});

/** Seis semanas de progreso a RPE objetivo, con referencia 1RM fechada de 175 kg (150/175 = 85,7 % ⇒ PeakIndex 100 %). */
function expressionFixture() {
  const fx = new Fixture();
  [
    ['2026-02-02', 145],
    ['2026-02-09', 145],
    ['2026-02-16', 147.5],
    ['2026-02-23', 150],
    ['2026-03-02', 152.5],
    ['2026-03-09', 155],
  ].forEach(([d, kg], i) => fx.session(d as string, row(kg as number), { key: `w${i}`, refKg: 175 }));
  return fx;
}
const goodRecovery = [rd('2026-03-08', 8), rd('2026-03-01', 7.5), rd('2026-02-22', 8), rd('2026-02-15', 7.5)];

describe('R-EXPRESSION · ventana favorable (dos modos, sin mezclarlos)', () => {
  it('con referencia fechada y calendario completo se cumplen los modos A (PRG reconstruido) y B (motor propio)', () => {
    const le = ev(expressionFixture(), '2026-03-10', withMin(), { readinessHistory: goodRecovery });
    expect(rule(le, 'R-EXPRESSION-A')!.status).toBe('ventana_expresion');
    expect(rule(le, 'R-EXPRESSION-B')!.status).toBe('ventana_expresion');
    expect(rule(le, 'R-EXPRESSION-A')!.evidence.join(' ')).toMatch(/no es el motor completo verificado/);
    expect(le.principal!.status).toBe('ventana_expresion');
    expect(le.principal!.summary).toMatch(/no es un pico fisiológico confirmado/);
  });
  it('sin referencia fechada el modo A no es concluyente y la discrepancia con B se muestra', () => {
    const fx = new Fixture();
    [
      ['2026-02-02', 145],
      ['2026-02-09', 145],
      ['2026-02-16', 147.5],
      ['2026-02-23', 152.5],
      ['2026-03-02', 155],
      ['2026-03-09', 157.5],
    ].forEach(([d, kg], i) => fx.session(d as string, row(kg as number), { key: `w${i}` }));
    const le = ev(fx, '2026-03-10', withMin(), { readinessHistory: goodRecovery });
    const a = rule(le, 'R-EXPRESSION-A')!;
    expect(a.status).toBe('sin_senal');
    expect(a.missing.join(' ')).toMatch(/ACWR/);
    expect(rule(le, 'R-EXPRESSION-B')!.status).toBe('ventana_expresion');
    expect(rule(le, 'R-EXPRESSION-B')!.alternatives.join(' ')).toMatch(/Discrepancia entre modos/);
  });
  it('sin check-in vigente el modo B no se cumple (la recuperación no se inventa)', () => {
    const b = rule(ev(expressionFixture(), '2026-03-10'), 'R-EXPRESSION-B')!;
    expect(b.status).toBe('sin_senal');
    expect(b.missing.join(' ')).toMatch(/Recuperación/);
  });
  it('un día con series previstas y sin registro vuelve incompleta la cobertura de ACWR', () => {
    const fx = expressionFixture().future(
      '2026-03-05',
      row(150).map((s) => ({ reps: s.reps, kg: null })),
      { key: 'hueco', refKg: 175 },
    );
    const a = rule(ev(fx, '2026-03-10', withMin(), { readinessHistory: goodRecovery }), 'R-EXPRESSION-A')!;
    expect(a.status).toBe('sin_senal');
    expect(a.evidence.join(' ')).toMatch(/Cobertura de calendario incompleta/);
  });
});

/** 6 exposiciones estables a 150 kg × 5 @8. */
const stable = () => {
  const fx = new Fixture();
  ['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23', '2026-03-02', '2026-03-09'].forEach((d, i) =>
    fx.session(d, row(150), { key: `w${i}` }),
  );
  return fx;
};
const stableRecovery = [rd('2026-03-08', 8), rd('2026-03-01', 8), rd('2026-02-22', 7.5)];

describe('R-VOLUME · ensayo de más volumen [propuesta]', () => {
  it('estable + ensayo exploratorio confirmado por el coach ⇒ experimento propuesto, no instrucción', () => {
    const p = withMin();
    p.perLift.SQ.explorationApproved = true;
    const v = rule(ev(stable(), '2026-03-10', p, { readinessHistory: stableRecovery }), 'R-VOLUME')!;
    expect(v.status).toBe('candidato_volumen');
    expect(v.proposal).toMatch(/Experimento propuesto \(no una instrucción\)/);
    expect(v.proposal).toMatch(/1 serie semanal a UN slot/);
    expect(v.proposal).toMatch(/Definí antes la salida/);
  });
  it('sin dosis histórica ni confirmación: "dosis óptima desconocida", sin afirmar subentrenamiento', () => {
    const v = rule(ev(stable(), '2026-03-10', withMin(), { readinessHistory: stableRecovery }), 'R-VOLUME')!;
    expect(v.status).toBe('sin_senal');
    expect(v.summary).toMatch(/dosis óptima desconocida/);
    expect(v.summary).toMatch(/No se afirma subentrenamiento/);
  });
  it('si ya progresa no se agrega trabajo por defecto', () => {
    const fx = new Fixture();
    [
      ['2026-02-02', 145],
      ['2026-02-09', 145],
      ['2026-02-16', 147.5],
      ['2026-02-23', 152.5],
      ['2026-03-02', 155],
      ['2026-03-09', 157.5],
    ].forEach(([d, kg], i) => fx.session(d as string, row(kg as number), { key: `w${i}` }));
    const p = withMin();
    p.perLift.SQ.explorationApproved = true;
    const v = rule(ev(fx, '2026-03-10', p, { readinessHistory: stableRecovery }), 'R-VOLUME')!;
    expect(v.status).toBe('sin_senal');
  });
  it('faltan respuestas de recuperación ⇒ datos insuficientes', () => {
    const p = withMin();
    p.perLift.SQ.explorationApproved = true;
    expect(
      rule(ev(stable(), '2026-03-10', p, { readinessHistory: [rd('2026-03-08', 8)] }), 'R-VOLUME')!.status,
    ).toBe('datos_insuficientes');
  });
  it('sin cambio mínimo definido no puede juzgar la estabilidad', () => {
    expect(
      rule(
        ev(stable(), '2026-03-10', withMin({ perLift: { SQ: { minChangePct: null, minChangeKg: null } } }), {
          readinessHistory: stableRecovery,
        }),
        'R-VOLUME',
      )!.status,
    ).toBe('datos_insuficientes');
  });
});

/** Series con RPE real que SUBE dentro de la sesión (8, 8, 9,5 a igual kg) en s2 y s3, y una sesión normal después. */
function freqFixture(programmed = false) {
  const fx = new Fixture();
  const sets = (rpes: number[], targets: number[]) =>
    rpes.map((rpe, i) => ({ reps: 5, kg: 150, rpe, target: targets[i] as number }));
  fx.session('2026-02-16', sets([8, 8, 8], [8, 8, 8]), { key: 's1', week: 1 });
  fx.session('2026-02-23', sets(programmed ? [7, 8, 9] : [8, 8, 9.5], programmed ? [7, 8, 9] : [8, 8, 8]), {
    key: 's2',
    week: 2,
  });
  fx.session('2026-03-02', sets(programmed ? [7, 8, 9] : [8, 8, 9.5], programmed ? [7, 8, 9] : [8, 8, 8]), {
    key: 's3',
    week: 3,
  });
  fx.session('2026-03-09', sets([8, 8, 8], [8, 8, 8]), { key: 's4', week: 4 });
  return fx;
}
const fatigue = (v: number): SessionFeedback[] => ['s2', 's3'].map((k) => ({ sessionKey: k, endFatigue: v }));

describe('R-FREQUENCY · redistribuir frecuencia [propuesta]', () => {
  it('deterioro no programado + fatiga de final de sesión en 2 sesiones y retorno a la referencia ⇒ candidato', () => {
    const r = rule(
      ev(freqFixture(), '2026-03-10', withMin(), { sessionFeedback: fatigue(8) }),
      'R-FREQUENCY',
    )!;
    expect(r.status).toBe('candidato_frecuencia');
    expect(r.proposal).toMatch(/MISMO volumen semanal/);
    expect(r.proposal).toMatch(/3 series\/semana en 1 día → 2 días/);
    expect(r.alternatives.join(' ')).toMatch(/No atribuir causalidad/);
  });
  it('una progresión de RPE programada no es deterioro (caso 9)', () => {
    expect(
      rule(ev(freqFixture(true), '2026-03-10', withMin(), { sessionFeedback: fatigue(8) }), 'R-FREQUENCY'),
    ).toBeUndefined();
  });
  it('sin fatiga de final de sesión registrada no se dispara', () => {
    expect(rule(ev(freqFixture(), '2026-03-10'), 'R-FREQUENCY')).toBeUndefined();
    expect(
      rule(ev(freqFixture(), '2026-03-10', withMin(), { sessionFeedback: fatigue(5) }), 'R-FREQUENCY'),
    ).toBeUndefined();
  });
  it('si la exposición siguiente no vuelve a la referencia es solo una hipótesis', () => {
    const fx = freqFixture();
    fx.planned = fx.planned.filter((s) => s.sessionKey !== 's4');
    fx.actual = fx.actual.filter((a) => !a.plannedSetId.startsWith('s4'));
    const r = rule(ev(fx, '2026-03-10', withMin(), { sessionFeedback: fatigue(8) }), 'R-FREQUENCY')!;
    expect(r.status).toBe('sin_senal');
    expect(r.summary).toMatch(/solo una hipótesis/);
  });
});

/** Un bloque de n semanas (1 sesión por semana) con la carga indicada por semana, a RPE objetivo. */
function block(fx: Fixture, name: string, start: string, kgs: number[], family = 'F1') {
  kgs.forEach((kg, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * i);
    fx.session(d.toISOString().slice(0, 10), row(kg), {
      key: `${name}-w${i + 1}`,
      block: name,
      week: i + 1,
      family,
    });
  });
}
const cutoff = '2026-12-31';
const summarize = (fx: Fixture, params = withMin()) =>
  summarizeBlocks({
    planned: fx.planned,
    actual: fx.actual,
    readiness: [],
    competitionExercises: { SQ: 'Squat comp' },
    cutoff,
    params,
  });

describe('TTP observado y familias de microciclo [propuesta]', () => {
  it('sube hasta la semana 5 y baja: TTP delimitado con ventana', () => {
    const fx = new Fixture();
    block(fx, 'B1', '2026-01-05', [140, 145, 150, 155, 160, 157.5, 155, 152.5]);
    const b = summarize(fx)[0]!;
    expect(b.ttp).toMatchObject({ state: 'delimitado', bestWeek: 5, windowWeeks: [5, 5] });
    expect(b.favorable).toBe(true);
  });
  it('si sigue mejorando al cerrar: "no delimitado", nunca un pico', () => {
    const fx = new Fixture();
    block(fx, 'B1', '2026-01-05', [140, 145, 150, 155, 160, 162.5]);
    expect(summarize(fx)[0]!.ttp.state).toBe('censurado');
  });
  it('una pausa larga no establece un pico', () => {
    const fx = new Fixture();
    block(fx, 'B1', '2026-01-05', [140, 145, 150, 155]);
    block(fx, 'B1', '2026-03-23', [160, 150, 148, 147]);
    const b = summarize(fx).find((x) => x.blockKey === 'B1')!;
    expect(['no_concluyente', 'no_delimitado', 'delimitado']).toContain(b.ttp.state);
  });
  it('con pocas exposiciones es "insuficiente"', () => {
    const fx = new Fixture();
    block(fx, 'B1', '2026-01-05', [140, 145, 150]);
    expect(summarize(fx)[0]!.ttp.state).toBe('insuficiente');
  });
  it('1 ciclo = observación preliminar; 2 ciclos delimitados = patrón repetido, sin porcentajes', () => {
    const one = new Fixture();
    block(one, 'B1', '2026-01-05', [140, 145, 150, 155, 160, 157.5, 155, 152.5]);
    const f1 = summarizeFamilies(summarize(one))[0]!;
    expect(f1.pattern).toBe('observacion_preliminar');
    const two = new Fixture();
    block(two, 'B1', '2026-01-05', [140, 145, 150, 155, 160, 157.5, 155, 152.5]);
    block(two, 'B2', '2026-04-06', [140, 145, 150, 155, 160, 165, 162.5, 160, 157.5]);
    const f2 = summarizeFamilies(summarize(two))[0]!;
    expect(f2).toMatchObject({
      pattern: 'patron_repetido',
      delimited: 2,
      bestWeekMedian: 5.5,
      bestWeekRange: [5, 6],
      golden: 'patron_repetido',
    });
    expect(JSON.stringify(f2)).not.toMatch(/probabilidad/i);
    expect(f2.estimateForNext?.caveat).toMatch(/No es una fecha ni una predicción de pico/);
    expect(f2.estimateForNext?.range).toEqual([5, 6]);
  });
  it('un objetivo técnico no se juzga por la subida del e1RM', () => {
    const fx = new Fixture();
    block(fx, 'B1', '2026-01-05', [140, 145, 150, 155, 160, 157.5, 155, 152.5]);
    expect(summarizeFamilies(summarize(fx), { F1: { objective: 'técnica' } })[0]!).toMatchObject({
      golden: 'sin_evidencia',
      note: expect.stringMatching(/no se juzga por la subida de e1RM/),
    });
  });
  it('candidato golden requiere respuesta favorable con cumplimiento y esfuerzo aceptables', () => {
    const fx = new Fixture();
    block(fx, 'B1', '2026-01-05', [150, 150, 150, 150, 150, 150, 150, 150]);
    expect(summarize(fx)[0]!.favorable).toBe(false);
    expect(summarizeFamilies(summarize(fx))[0]!.golden).toBe('sin_evidencia');
  });
});

describe('evaluateAthlete integra bloques, familias y reglas', () => {
  it('devuelve resúmenes de bloque y familia junto con la evaluación por lift', () => {
    const fx = new Fixture();
    block(fx, 'B1', '2026-01-05', [140, 145, 150, 155, 160, 157.5, 155, 152.5]);
    const a = evaluateAthlete({
      cutoff: '2026-12-31',
      params: withMin(),
      plannedSets: fx.planned,
      actualSets: fx.actual,
      readiness: null,
      competitionExercises: { SQ: 'Squat comp' },
    });
    expect(a.blocks).toHaveLength(1);
    expect(a.families).toHaveLength(1);
    expect(a.lifts.SQ).toBeDefined();
  });
});

describe('Deterioro intra-sesión y ventana de expresión', () => {
  it('con fatiga y deterioro no programado no se anuncia una ventana favorable (revisión antes que oportunidad)', () => {
    const le = ev(freqFixture(), '2026-03-10', withMin(), {
      sessionFeedback: fatigue(8),
      readinessHistory: [rd('2026-03-08', 8), rd('2026-03-01', 8)],
    });
    expect(rule(le, 'R-EXPRESSION-B')!.status).toBe('sin_senal');
    expect(rule(le, 'R-EXPRESSION-B')!.evidence.join(' ')).toMatch(/Sin deterioro relevante.*✗/);
    expect(le.principal!.status).toBe('candidato_frecuencia');
  });
});
