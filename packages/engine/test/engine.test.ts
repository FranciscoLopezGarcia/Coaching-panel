import { describe, expect, it } from 'vitest';
import { evaluateLift } from '../src/pipeline.js';
import { buildParams } from '../src/params.js';
import { decisionKey, mergeDecisions, toDecisionRows } from '../src/decisions.js';
import { latestReadiness } from '../src/readiness.js';
import { Fixture, withMin } from './helpers.js';

const ev = (
  fx: Fixture,
  cutoff: string,
  params = withMin(),
  readiness: Parameters<typeof evaluateLift>[0]['readiness'] = null,
) =>
  evaluateLift({
    lift: 'SQ',
    exerciseName: 'Squat comp',
    plannedSets: fx.planned,
    actualSets: fx.actual,
    readiness,
    cutoff,
    params,
  });
const row = (kg: number, rpe = 8, target = 8) => [
  { reps: 5, kg, rpe, target },
  { reps: 5, kg, rpe, target },
  { reps: 5, kg, rpe, target },
];

/** 6 exposiciones semanales: 3 previas ≈ 150 kg y 3 recientes subiendo, todas a RPE 8 = objetivo. */
function progressing() {
  const fx = new Fixture();
  [
    ['2026-02-02', 145],
    ['2026-02-09', 145],
    ['2026-02-16', 147.5],
    ['2026-02-23', 152.5],
    ['2026-03-02', 155],
    ['2026-03-09', 157.5],
  ].forEach(([d, kg]) => fx.session(d as string, row(kg as number)));
  return fx;
}

describe('R-PROGRESS', () => {
  it('progreso sostenido con 3+3 comparables, RPE en objetivo y cambio mínimo superado', () => {
    const r = ev(progressing(), '2026-03-10').principal!;
    expect(r.status).toBe('progreso_sostenido');
    expect(r.sufficiency).toBe('suficiente');
    expect(r.proposal).toMatch(/Mantener/);
    expect(r.evidence.length).toBeGreaterThanOrEqual(6);
  });
  it('sin cambio mínimo definido: muestra Δ y NO clasifica (caso 12)', () => {
    const r = ev(progressing(), '2026-03-10', buildParams()).principal!;
    expect(r.status).toBe('datos_insuficientes');
    expect(r.summary).toMatch(/no se clasifica/);
    expect(r.missing.join(' ')).toMatch(/Cambio mínimo/);
  });
  it('menos de 3 exposiciones: datos insuficientes, conserva métricas válidas', () => {
    const fx = new Fixture().session('2026-03-02', row(150)).session('2026-03-09', row(152.5));
    const r = ev(fx, '2026-03-10').principal!;
    expect(r.status).toBe('datos_insuficientes');
    expect(r.evidence.length).toBe(2);
  });
  it('solo ventana reciente completa: tendencia inicial favorable, nunca "sostenido"', () => {
    const fx = new Fixture()
      .session('2026-02-23', row(145))
      .session('2026-03-02', row(150))
      .session('2026-03-09', row(155));
    const r = ev(fx, '2026-03-10').principal!;
    expect(r.status).toBe('tendencia_inicial_favorable');
    expect(r.sufficiency).toBe('parcial');
  });
  it('mejora con RPE por encima del objetivo no se confirma', () => {
    const fx = new Fixture();
    [
      ['2026-02-02', 145, 8],
      ['2026-02-09', 145, 8],
      ['2026-02-16', 147.5, 8],
      ['2026-02-23', 155, 9],
      ['2026-03-02', 157.5, 9],
      ['2026-03-09', 160, 9],
    ].forEach(([d, kg, rpe]) => fx.session(d as string, row(kg as number, rpe as number, 8)));
    const r = ev(fx, '2026-03-10').principal!;
    expect(r.status).not.toBe('progreso_sostenido');
  });
  it('series sin RPE real no generan E (caso 1) y se informan', () => {
    const fx = new Fixture();
    ['2026-02-23', '2026-03-02', '2026-03-09'].forEach((d) =>
      fx.session(d, row(150, null as unknown as number)),
    );
    const le = ev(fx, '2026-03-10');
    expect(le.principal!.status).toBe('datos_insuficientes');
    expect(le.quality.setsWithoutRpe).toBe(9);
  });
  it('sin fuga de futuro: un registro posterior al corte no cambia el resultado', () => {
    const base = progressing();
    const a = ev(base, '2026-03-10');
    const fut = progressing().session('2026-04-20', row(200));
    const b = ev(fut, '2026-03-10');
    expect(b.principal!.summary).toBe(a.principal!.summary);
    expect(b.quality.futureIgnored).toBeGreaterThan(0);
  });
});

describe('B-DOLOR y prioridades', () => {
  it('señal favorable + molestia relevante ⇒ revisión del coach y sin propuesta de carga', () => {
    const fx = progressing();
    fx.session('2026-03-12', [{ reps: 5, kg: 140, rpe: 6, target: 8, pain: 5 }]);
    const le = ev(fx, '2026-03-13');
    expect(le.blocked).toBe(true);
    expect(le.principal!.status).toBe('revision_coach');
    expect(le.results.some((r) => r.ruleId === 'R-LOAD')).toBe(false);
    expect(le.principal!.proposal).toMatch(/No es un diagnóstico/);
  });
  it('molestia ausente no es cero ni bloquea', () => {
    expect(ev(progressing(), '2026-03-10').blocked).toBe(false);
  });
});

describe('R-LOAD', () => {
  /** Las 3 últimas exposiciones holgadas (RPE 7 vs objetivo 8; la referencia es el mínimo de las 3) y próxima sesión prevista 3×5@8. */
  function roomy(plannedKg: number | null = null) {
    const fx = new Fixture();
    fx.session('2026-02-23', row(150, 8, 8))
      .session('2026-03-02', row(150, 7, 8))
      .session('2026-03-09', row(150, 7, 8))
      .session('2026-03-16', row(150, 7, 8));
    fx.future('2026-03-23', [
      { reps: 5, kg: null, target: 8, plannedKg },
      { reps: 5, kg: null, target: 8, plannedKg },
      { reps: 5, kg: null, target: 8, plannedKg },
    ]);
    return fx;
  }
  it('propone kg redondeado hacia abajo al paso y limitado a un paso, sin aplicarlo', () => {
    const r = ev(roomy(150), '2026-03-17').results.find((x) => x.ruleId === 'R-LOAD')!;
    expect(r.status).toBe('margen_carga');
    expect(r.proposal).toMatch(/152,5 kg/); // 150 + un paso de 2,5 (el cálculo por tabla daría más)
    expect(r.proposal).toMatch(/no modifica la programación/);
  });
  it('si la programación ya prevé esa carga, no sugiere cambio', () => {
    const r = ev(roomy(152.5), '2026-03-17').results.find((x) => x.ruleId === 'R-LOAD')!;
    expect(r.status).toBe('sin_senal');
  });
  it('no sugiere salto si el redondeo no supera la carga actual (caso 5)', () => {
    const fx = new Fixture();
    fx.session('2026-02-23', row(150, 8, 8))
      .session('2026-03-02', row(150, 7, 8))
      .session('2026-03-09', row(150, 7, 8))
      .session('2026-03-16', row(150, 7, 8));
    fx.future('2026-03-23', [{ reps: 5, kg: null, target: 8, plannedKg: 150 }]);
    const r = ev(fx, '2026-03-17', withMin({ stepKg: 25 })).results.find((x) => x.ruleId === 'R-LOAD');
    expect(r?.status ?? 'sin_senal').toBe('sin_senal');
  });
  it('no se emite si el RPE no quedó por debajo del objetivo − margen', () => {
    const fx = new Fixture();
    fx.session('2026-02-23', row(150))
      .session('2026-03-02', row(150))
      .session('2026-03-09', row(150))
      .session('2026-03-16', row(150));
    expect(ev(fx, '2026-03-17').results.some((x) => x.ruleId === 'R-LOAD')).toBe(false);
  });
});

describe('R-END', () => {
  const fall = (rpe: number) => {
    const fx = new Fixture();
    [
      ['2026-02-02', 155],
      ['2026-02-09', 155],
      ['2026-02-16', 157.5],
      ['2026-02-23', 145],
      ['2026-03-02', 142.5],
    ].forEach(([d, kg]) => fx.session(d as string, row(kg as number, rpe, 8)));
    return fx;
  };
  it('2 exposiciones por debajo de la mediana de las 3 previas ⇒ posible fin de respuesta (sin pedir más estrés)', () => {
    const r = ev(fall(8), '2026-03-03').principal!;
    expect(r.status).toBe('posible_fin_respuesta');
    expect(r.alternatives.join(' ')).toMatch(/No se recomienda agregar estrés/);
    expect(r.alternatives.join(' ')).toMatch(/no se compara con ventanas históricas/);
  });
  it('caída con esfuerzo por encima del objetivo sube de prioridad', () => {
    const a = ev(fall(8), '2026-03-03').principal!;
    const b = ev(fall(9.5), '2026-03-03').principal!;
    expect(b.rank).toBeLessThan(a.rank);
  });
  it('estabilidad sostenida en 6 exposiciones SIN objetivo: se informa como estabilidad observada, no como fin de respuesta', () => {
    const fx = new Fixture();
    ['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23', '2026-03-02', '2026-03-09'].forEach((d) =>
      fx.session(d, row(150)),
    );
    const r = ev(fx, '2026-03-10').principal!;
    expect(r.status).toBe('estabilidad_observada');
    expect(r.summary).toMatch(/objetivo del bloque no está disponible/);
    expect(r.missing.join(' ')).toMatch(/Objetivo declarado/);
    expect(r.sufficiency).toBe('parcial');
  });
});

describe('Recuperación y datos faltantes', () => {
  it('check-in de 8 días se marca vencido y no gatilla nada por sí solo (caso 2)', () => {
    const rd = latestReadiness(
      [{ date: '2026-03-02', sleep: 8, energy: 8, motivation: 8, stress: 3, pain: 1 }],
      '2026-03-10',
    );
    expect(ev(progressing(), '2026-03-10', withMin(), rd).readiness).toMatch(/vencido/);
  });
  it('sin check-in lo dice explícitamente', () => {
    expect(ev(progressing(), '2026-03-10').readiness).toBe('sin check-in reciente');
  });
  it('lift sin ejercicio de competencia planificado ⇒ datos insuficientes con motivo', () => {
    const r = ev(new Fixture(), '2026-03-10').principal!;
    expect(r.status).toBe('datos_insuficientes');
  });
  it('sesiones pasadas sin registro se cuentan aparte (no es descarga confirmada, caso 10)', () => {
    const fx = progressing();
    fx.future(
      '2026-03-05',
      row(150).map((s) => ({ reps: s.reps, kg: null })),
      {},
    );
    expect(ev(fx, '2026-03-10').quality.sessionsWithoutRecord).toBe(1);
  });
});

describe('Idempotencia y decisión del coach', () => {
  it('mismos inputs ⇒ misma salida', () => {
    const a = ev(progressing(), '2026-03-10');
    const b = ev(progressing(), '2026-03-10');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('re-evaluar no duplica, conserva la decisión del coach y expira lo que ya no aplica', () => {
    const p = withMin();
    const e1 = {
      cutoff: '2026-03-10',
      rulesVersion: 'reglas-v0.2-propuesta',
      paramsVersion: 'params-v2',
      lifts: { SQ: ev(progressing(), '2026-03-10', p) },
      blocks: [],
      families: [],
    };
    const rows1 = toDecisionRows(e1, p);
    const principal = rows1.find((r) => r.isPrincipal)!;
    const decided = rows1.map((r) =>
      r.key === principal.key
        ? {
            ...r,
            lifecycle: 'aceptada' as const,
            coachDecision: 'Aprobada' as const,
            coachNote: 'ok',
            decidedOn: '2026-03-10',
          }
        : r,
    );
    const again = mergeDecisions(decided, toDecisionRows(e1, p), '2026-03-10');
    expect(again.length).toBe(decided.length);
    expect(again.find((r) => r.key === principal.key)?.coachDecision).toBe('Aprobada');
    // nuevo corte con otro dato: la previa expira, no se borra
    const fx2 = progressing().session('2026-03-16', row(160));
    const e2 = {
      cutoff: '2026-03-17',
      rulesVersion: 'reglas-v0.2-propuesta',
      paramsVersion: 'params-v2',
      lifts: { SQ: ev(fx2, '2026-03-17', p) },
      blocks: [],
      families: [],
    };
    const merged = mergeDecisions(again, toDecisionRows(e2, p), '2026-03-17');
    const old = merged.find((r) => r.key === principal.key)!;
    expect(old.validity).toBe('expirada');
    expect(old.coachDecision).toBe('Aprobada');
    expect(old.expiryReason).toMatch(/reemplazada/);
    expect(merged.some((r) => r.validity === 'vigente')).toBe(true);
  });
  it('la clave incluye versión de reglas y fecha de datos', () => {
    expect(decisionKey('SQ', 'a|D1', 'R-LOAD', '2026-03-10', 'v')).toBe(
      'SQ|a|D1|R-LOAD|2026-03-10|v'.replace('SQ|a|D1', 'SQ|a|D1'),
    );
  });
});
