import { describe, expect, it } from 'vitest';
import { summarizeBlocks, summarizeFamilies } from '../src/blocks.js';
import type { ChangeEvent } from '../src/diff.js';
import { createIntervention, interventionFollowUp, linkEvent, transition } from '../src/intervention.js';
import { evaluateLift } from '../src/pipeline.js';
import { result } from '../src/rules/result.js';
import { legacyDecision, lifecycleFromLegacy, mergeDecisions, toDecisionRows } from '../src/decisions.js';
import { resolvePrincipal } from '../src/state.js';
import type { CoachReview, Readiness, SessionFeedback } from '../src/types.js';
import { Fixture, row, withMin } from './helpers.js';

interface X {
  readinessHistory?: Readiness[];
  sessionFeedback?: SessionFeedback[];
  coachReviews?: CoachReview[];
  objective?: string | null;
  changeEvents?: ChangeEvent[];
}
const ev = (fx: Fixture, cutoff: string, params = withMin(), x: X = {}) =>
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
const change = (id: string, effectiveOn: string, classification = 'volumen_aumentado'): ChangeEvent =>
  ({
    id,
    versionA: 'a',
    versionB: 'b',
    detectedOn: effectiveOn,
    effectiveOn,
    effectiveEstimated: false,
    status: 'aplicado',
    actor: null,
    coachComment: '',
    setChanges: { added: 0, removed: 0, modified: 0, samples: [] },
    changes: [{ lift: 'SQ', blockKey: 'B1', classification, tags: [], deltas: [], summary: '', caveats: [] }],
  }) as unknown as ChangeEvent;

const weekly = (
  fx: Fixture,
  start: string,
  n: number,
  kg: (i: number) => number,
  o: {
    variant?: (i: number) => string;
    day?: (i: number) => number;
    slot?: (i: number) => string;
    rpe?: number;
  } = {},
) => {
  for (let i = 0; i < n; i++) {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * i);
    fx.session(d.toISOString().slice(0, 10), row(kg(i), o.rpe ?? 8, o.rpe ?? 8), {
      key: `w${i}`,
      week: i + 1,
      exposure: 'squat-primaria',
      variant: o.variant?.(i),
      day: o.day?.(i),
      slot: o.slot?.(i) ?? 'squat-comp|D1',
    });
  }
  return fx;
};

describe('Evidencia correlacionada y evaluación en tres dimensiones', () => {
  const fx = () =>
    weekly(new Fixture(), '2026-02-02', 6, (i) => [145, 145, 147.5, 150, 152.5, 155][i] as number);
  it('cada evidencia declara su origen y las derivadas de las mismas series cuentan como un solo grupo', () => {
    const r = ev(fx(), '2026-03-10').principal!;
    const origins = new Set(r.evidenceItems.map((e) => e.origin));
    expect(origins).toContain('rendimiento');
    expect(origins).toContain('cumplimiento');
    const perf = r.evidenceItems.filter((e) => e.independenceGroup.startsWith('rendimiento'));
    expect(perf.length).toBeGreaterThanOrEqual(2); // e1RM y desvío de RPE salen de las mismas series
    expect(r.assessment!.independentGroups).toBeLessThan(r.assessment!.items);
    expect(r.assessment!.correlationNote).toMatch(/cuentan como una sola confirmación/);
    expect(r.explanation!.dependencies.length).toBeGreaterThan(0);
  });
  it('FR y tendencia del modo A (mismas series) y ACWR/PeakIndex (carga) forman dos grupos, no cuatro confirmaciones', () => {
    const f2 = new Fixture();
    [
      ['2026-02-02', 145],
      ['2026-02-09', 145],
      ['2026-02-16', 147.5],
      ['2026-02-23', 150],
      ['2026-03-02', 152.5],
      ['2026-03-09', 155],
    ].forEach(([d, kg], i) => f2.session(d as string, row(kg as number), { key: `w${i}`, refKg: 175 }));
    const a = rule(
      ev(f2, '2026-03-10', withMin(), { readinessHistory: [rd('2026-03-08', 8)] }),
      'R-EXPRESSION-A',
    )!;
    expect(a.evidenceItems.length).toBe(4);
    expect(a.assessment!.independentGroups).toBe(2);
  });
  it('suficiencia, actualidad y comparabilidad son dimensiones separadas y no hay probabilidades', () => {
    const r = ev(fx(), '2026-03-10').principal!;
    expect(Object.keys(r.assessment!).sort()).toEqual([
      'comparability',
      'correlationNote',
      'independentGroups',
      'items',
      'reasons',
      'recency',
      'sufficiency',
    ]);
    expect(['suficiente', 'parcial', 'insuficiente']).toContain(r.assessment!.sufficiency);
    expect(JSON.stringify(r.assessment)).not.toMatch(/probabilidad|\d+\s?%/i);
    expect(r).not.toHaveProperty('confidence');
  });
  it('datos viejos se marcan como desactualizados; un check-in vencido también', () => {
    const old = ev(fx(), '2026-05-20').results.find((x) => x.ruleId === 'R-PROGRESS')!;
    expect(old.assessment!.recency).toBe('desactualizada');
    const r = ev(fx(), '2026-03-10', withMin(), {
      readinessHistory: [rd('2026-02-20', 8), rd('2026-02-13', 8), rd('2026-02-06', 8)],
    });
    const b = rule(r, 'R-EXPRESSION-B');
    expect(b?.assessment?.recency === 'desactualizada' || b?.assessment?.recency === 'vigente').toBe(true);
  });
  it('un cambio de variante dentro de la misma exposición corta la comparación (identidad ≠ comparabilidad)', () => {
    const f2 = weekly(new Fixture(), '2026-02-02', 6, () => 150, {
      variant: (i) => (i < 3 ? 'barra-alta' : 'barra-baja'),
    });
    const le = ev(f2, '2026-03-10');
    const p = le.results.find((x) => x.ruleId === 'R-PROGRESS')!;
    expect(p.assessment!.comparability).toBe('parcial');
    expect(p.assessment!.reasons.join(' ')).toMatch(/Cambió la variante/);
    expect(p.status).not.toBe('progreso_sostenido'); // el último segmento tiene solo 3 exposiciones: no alcanza para confirmar progreso
    expect(p.missing.join(' ')).toMatch(/previas comparables/);
  });
});

describe('Identidad de exposición estable', () => {
  it('mover la sesión de día no rompe la continuidad (misma exposición, otro día/slot)', () => {
    const moved = weekly(
      new Fixture(),
      '2026-02-02',
      6,
      (i) => [145, 145, 147.5, 150, 152.5, 155][i] as number,
      { day: (i) => (i < 3 ? 1 : 3), slot: (i) => (i < 3 ? 'squat-comp|D1' : 'squat-comp|D3') },
    );
    const p = ev(moved, '2026-03-10').results.find((x) => x.ruleId === 'R-PROGRESS')!;
    expect(p.exposureId).toBe('squat-primaria');
    expect(p.status).toBe('progreso_sostenido');
    expect(ev(moved, '2026-03-10').results.filter((x) => x.ruleId === 'R-PROGRESS')).toHaveLength(1); // una sola identidad, no dos "slots"
  });
});

describe('Conflictos y conclusión principal', () => {
  const R = (
    status: Parameters<typeof result>[0]['status'],
    id: Parameters<typeof result>[0]['ruleId'] = 'R-LOAD',
    exposureId = 'x',
  ) => result({ ruleId: id, exposureId, status, summary: status, dataUntil: '2026-03-01', proposal: status });
  it('una revisión protectora difiere las acciones ofensivas y lo explica', () => {
    const r = resolvePrincipal([
      R('candidato_pr', 'R-PR'),
      R('posible_fin_respuesta', 'R-END'),
      R('candidato_volumen', 'R-VOLUME'),
    ]);
    expect(r.principal!.ruleId).toBe('R-END');
    expect(r.deferred.map((d) => d.key).sort()).toEqual(['R-PR@x', 'R-VOLUME@x']);
    expect(r.conflicts.every((c) => c.kind === 'incompatible')).toBe(true);
  });
  it('PR y ensayo de volumen no son órdenes simultáneas: se secuencian', () => {
    const r = resolvePrincipal([R('candidato_pr', 'R-PR'), R('candidato_volumen', 'R-VOLUME')]);
    expect(r.principal!.ruleId).toBe('R-PR');
    expect(r.deferred[0]).toMatchObject({ key: 'R-VOLUME@x', action: 'aumentar_estimulo' });
    expect(r.sequence.join(' ')).toMatch(/primero se evalúa el intento de marca/);
  });
  it('PR y progresión de carga: secuenciables, ambos visibles; la ventana de expresión es contexto compatible', () => {
    const r = resolvePrincipal([
      R('candidato_pr', 'R-PR'),
      R('margen_carga', 'R-LOAD'),
      R('ventana_expresion', 'R-EXPRESSION-B'),
    ]);
    expect(r.conflicts.find((c) => c.b === 'R-LOAD@x')?.kind).toBe('secuenciable');
    expect(r.conflicts.find((c) => c.b === 'R-EXPRESSION-B@x')?.kind).toBe('compatible');
    expect(r.deferred).toHaveLength(0);
  });
  it('un deterioro con fatiga (redistribuir) prevalece sobre un intento de marca', () => {
    expect(
      resolvePrincipal([R('candidato_pr', 'R-PR'), R('candidato_frecuencia', 'R-FREQUENCY')]).principal!
        .ruleId,
    ).toBe('R-FREQUENCY');
  });
  it('"datos insuficientes" solo manda si no hay otra evaluación', () => {
    expect(
      resolvePrincipal([R('datos_insuficientes', 'R-PROGRESS'), R('progreso_sostenido', 'R-PROGRESS', 'y')])
        .principal!.status,
    ).toBe('progreso_sostenido');
    expect(resolvePrincipal([R('datos_insuficientes', 'R-PROGRESS')]).principal!.status).toBe(
      'datos_insuficientes',
    );
  });
  it('el estado separa las cinco dimensiones y conserva las señales secundarias', () => {
    const fx = weekly(new Fixture(), '2026-02-02', 6, (i) => [145, 145, 147.5, 150, 152.5, 155][i] as number);
    const le = ev(fx, '2026-03-10', withMin(), {
      objective: 'fuerza',
      readinessHistory: [rd('2026-03-08', 8), rd('2026-03-01', 8)],
    });
    expect(le.state.dimensions.map((d) => d.id)).toEqual([
      'rendimiento',
      'recuperacion',
      'respuesta',
      'oportunidades',
      'calidad_datos',
    ]);
    expect(le.state.dimensions[0]).toMatchObject({ id: 'rendimiento', status: 'mejora' });
    expect(le.state.principal?.key).toBeTruthy();
    expect(le.state.objective).toMatchObject({ value: 'fuerza', available: true });
    expect(le.secondary.length).toBeGreaterThan(0);
  });
  it('sin objetivo lo declara y limita la conclusión', () => {
    const fx = weekly(new Fixture(), '2026-02-02', 6, () => 150);
    const le = ev(fx, '2026-03-10');
    expect(le.state.objective.available).toBe(false);
    expect(le.state.objective.note).toMatch(/limita/);
  });
  it('sin cambio mínimo: el rendimiento queda "sin clasificar" y lo dice, sin apagar las demás métricas', () => {
    const fx = weekly(new Fixture(), '2026-02-02', 6, (i) => 145 + i * 2.5);
    const le = ev(fx, '2026-03-10', withMin({ perLift: { SQ: { minChangePct: null, minChangeKg: null } } }));
    expect(le.state.dimensions[0]!.status).toBe('sin_clasificar');
    expect(le.state.dimensions.find((d) => d.id === 'calidad_datos')!.summary).toMatch(
      /Configuración faltante/,
    );
  });
});

describe('R-END: la estabilidad depende del objetivo, la duración, la comparabilidad y los cambios de estímulo', () => {
  const stable = (spacingDays = 7, n = 6) => {
    const fx = new Fixture();
    for (let i = 0; i < n; i++) {
      const d = new Date('2026-02-02T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + spacingDays * i);
      fx.session(d.toISOString().slice(0, 10), row(150), {
        key: `w${i}`,
        week: i + 1,
        exposure: 'squat-primaria',
      });
    }
    return fx;
  };
  const end = (le: ReturnType<typeof ev>) => rule(le, 'R-END')!;
  it('con objetivo de progreso, ≥ 4 semanas y sin cambios: posible meseta (no fin automático)', () => {
    const r = end(ev(stable(), '2026-03-10', withMin(), { objective: 'fuerza' }));
    expect(r.status).toBe('posible_fin_respuesta');
    expect(r.summary).toMatch(/Posible meseta/);
    expect(r.sufficiency).toBe('parcial');
    expect(r.alternatives.join(' ')).toMatch(/no es un fin de respuesta confirmado/);
  });
  it('con objetivo de mantenimiento, técnica o descarga es compatible: estabilidad observada', () => {
    for (const obj of ['mantenimiento', 'técnica', 'descarga', 'hipertrofia']) {
      const r = end(ev(stable(), '2026-03-10', withMin(), { objective: obj }));
      expect(r.status, obj).toBe('estabilidad_observada');
      expect(r.summary, obj).toMatch(/Compatible con el objetivo declarado/);
    }
  });
  it('con objetivo de progreso pero pocas semanas: estabilidad observada, no meseta', () => {
    const r = end(ev(stable(3), '2026-03-04', withMin(), { objective: 'fuerza' }));
    expect(r.status).toBe('estabilidad_observada');
    expect(r.summary).toMatch(/menor que la mínima/);
  });
  it('si cambió el estímulo durante la observación no hay base para hablar de meseta', () => {
    const r = end(
      ev(stable(), '2026-03-10', withMin(), {
        objective: 'fuerza',
        changeEvents: [change('c1', '2026-02-16')],
      }),
    );
    expect(r.status).toBe('estabilidad_observada');
    expect(r.summary).toMatch(/Cambió el estímulo/);
  });
  it('una caída tras un cambio de estímulo queda con evidencia parcial y lo advierte', () => {
    const fx = new Fixture();
    [
      ['2026-02-02', 155],
      ['2026-02-09', 155],
      ['2026-02-16', 157.5],
      ['2026-02-23', 145],
      ['2026-03-02', 142.5],
    ].forEach(([d, kg], i) =>
      fx.session(d as string, row(kg as number), { key: `w${i}`, exposure: 'squat-primaria' }),
    );
    const r = end(ev(fx, '2026-03-03', withMin(), { changeEvents: [change('c2', '2026-02-20')] }));
    expect(r.tag).toBe('caida');
    expect(r.sufficiency).toBe('parcial');
    expect(r.alternatives.join(' ')).toMatch(/Cambió el estímulo dentro de la ventana/);
    expect(r.assessment!.comparability).toBe('parcial');
  });
  it('seis exposiciones estables NO bloquean al ensayo de volumen (estabilidad ≠ deterioro)', () => {
    const p = withMin();
    p.perLift.SQ.explorationApproved = true;
    const le = ev(stable(), '2026-03-10', p, {
      objective: 'fuerza',
      readinessHistory: [rd('2026-03-08', 8), rd('2026-03-01', 8), rd('2026-02-22', 7.5)],
    });
    expect(rule(le, 'R-VOLUME')!.status).toBe('candidato_volumen');
  });
});

describe('R-PR: candidato estructurado, sensibilidad al RPE y extrapolación', () => {
  const bench = (kg: number, rpe: number, target = rpe, extra: (fx: Fixture) => void = () => {}) => {
    const fx = new Fixture();
    extra(fx);
    ['2026-02-23', '2026-03-02', '2026-03-09'].forEach((d, i) =>
      fx.session(d, row(kg, rpe, target), { key: `r${i}` }),
    );
    return fx;
  };
  const pr = (fx: Fixture, p = withMin(), x: X = {}) => rule(ev(fx, '2026-03-10', p, x), 'R-PR');
  it('un caso robusto (se sostiene bajo +0,5 y +1,0 de RPE) es candidato con escenarios explícitos', () => {
    const r = pr(bench(150, 7), withMin(), { readinessHistory: [rd('2026-03-09', 8)] })!;
    expect(r.status).toBe('candidato_pr');
    const c = r.candidate!;
    expect(c.type).toBe('load_for_reps');
    expect(c.scenarios.map((s) => [s.rpeShift, s.kg, s.holds])).toEqual([
      [0, 157.5, true],
      [0.5, 155, true],
      [1, 152.5, true],
    ]);
    expect(c.previousRecord).toMatchObject({ kg: 150, reps: 5 });
    expect(c.protocol).toEqual({ reps: 5, rpe: 9, kg: 155 });
    expect(c.method.id).toBe('table-rpe');
    expect(c.flags).toEqual({
      extrapolatedReps: false,
      extrapolatedEffort: false,
      sensitiveToRpe: false,
      marginal: false,
    });
    expect(c.readiness).toBe('listo');
    expect(r.summary).not.toMatch(/probabilidad de éxito: \d/);
  });
  it('si la oportunidad depende del RPE reportado (récord + un paso solo bajo +0,5) es una oportunidad PENDIENTE, no un candidato', () => {
    const r = pr(bench(150, 7.5))!;
    expect(r.status).toBe('oportunidad_pendiente');
    expect(r.candidate!.flags).toMatchObject({ sensitiveToRpe: true, marginal: true });
    expect(r.candidate!.scenarios.map((s) => s.holds)).toEqual([true, true, false]);
    expect(r.missing.join(' ')).toMatch(/depende de la exactitud del RPE/);
    expect(r.alternatives.join(' ')).toMatch(/al borde/);
    expect(r.summary).toMatch(/no hay un candidato suficientemente defendible/);
  });
  it('NO fabrica "récord + un paso" automáticamente cuando el RPE de referencia está al límite', () => {
    const r = pr(bench(150, 8))!;
    expect(r.status).toBe('sin_senal');
    expect(r.summary).toMatch(/No se redondea hacia arriba/);
  });
  it('detecta la diferencia entre el esfuerzo de referencia y el del intento (extrapolación de esfuerzo)', () => {
    const r = pr(bench(150, 6))!;
    expect(r.status).toBe('oportunidad_pendiente');
    expect(r.candidate!.flags.extrapolatedEffort).toBe(true);
    expect(r.candidate!.reference).toMatchObject({ attemptRpe: 9, benchmarkRpeMean: 6, effortGap: 3 });
    expect(r.missing.join(' ')).toMatch(/extrapolación de esfuerzo/);
  });
  it('detecta extrapolación de repeticiones: el intento se aleja de las reps de los benchmarks', () => {
    const fx = bench(150, 7, 7, (f) =>
      f.session(
        '2026-01-10',
        [
          { reps: 9, kg: 100, rpe: 8, target: 8 },
          { reps: 9, kg: 100, rpe: 8, target: 8 },
          { reps: 9, kg: 100, rpe: 8, target: 8 },
        ],
        { key: 'old9' },
      ),
    );
    const p = withMin();
    p.perLift.SQ.prReps = 9;
    const r = pr(fx, p)!;
    expect(r.status).toBe('oportunidad_pendiente');
    expect(r.candidate!.flags.extrapolatedReps).toBe(true);
    expect(r.missing.join(' ')).toMatch(/extrapolación de repeticiones/);
  });
  it('el RPE del intento es configurable y no universal: cambia el resultado', () => {
    expect(pr(bench(150, 7.5))!.status).toBe('oportunidad_pendiente'); // con RPE 9 depende del RPE reportado
    const p = withMin();
    p.perLift.SQ.prRpe = 9.5;
    const r = pr(bench(150, 7.5), p)!;
    expect(r.status).toBe('candidato_pr');
    expect(r.candidate!.protocol.rpe).toBe(9.5);
    const p2 = withMin();
    p2.perLift.SQ.prEffortGap = 5;
    expect(pr(bench(150, 6), p2)!.status).toBe('candidato_pr'); // el umbral de brecha también es configurable
  });
  it('el paso de carga por lift redondea hacia abajo y no es el cambio mínimo', () => {
    const p = withMin();
    p.perLift.SQ.stepKg = 5;
    const r = pr(bench(150, 7), p)!;
    expect(r.candidate!.step).toBe(5);
    expect(r.candidate!.protocol.kg % 5).toBe(0);
  });
  it('sin récord previo registrado no se afirma un PR; con single apagado no se propone', () => {
    const p = withMin();
    p.perLift.SQ.prReps = 1;
    expect(pr(bench(150, 7), p)!.summary).toMatch(/habilitación explícita/);
  });
});

describe('Contrato explicativo', () => {
  const fx = () =>
    weekly(new Fixture(), '2026-02-02', 6, (i) => [145, 145, 147.5, 150, 152.5, 155][i] as number);
  it('cada resultado trae regla, versiones, evidencias, parámetros, validez, referencias y alternativas descartadas', () => {
    const le = ev(fx(), '2026-03-10', withMin(), { objective: 'fuerza' });
    const e = le.principal!.explanation!;
    expect(e).toMatchObject({
      ruleId: le.principal!.ruleId,
      ruleVersion: 'reglas-v0.2-propuesta',
      paramsVersion: 'params-v2',
    });
    expect(e.context).toMatchObject({ lift: 'SQ', cutoff: '2026-03-10', objective: 'fuerza' });
    expect(e.evidence.length).toBeGreaterThan(0);
    expect(e.refs.some((x) => x.kind === 'session')).toBe(true);
    expect(e.paramsApplied).toHaveProperty('nExposures');
    expect(e.paramsApplied).toHaveProperty('minChangePct', 1.5);
    expect(e.validity.reevaluateWhen.length).toBeGreaterThan(0);
    expect(e.validity.staleAfter).toBe('2026-03-30');
    expect(e.nextCheck.when).toBeTruthy();
    expect(e.limits.length).toBeGreaterThan(0);
    expect(le.results.filter((r) => r !== le.principal).length).toBe(e.discarded.length);
  });
  it('los textos se rastrean a hechos numéricos concretos, no solo a un párrafo', () => {
    const e = ev(fx(), '2026-03-10').results.find((r) => r.ruleId === 'R-PROGRESS')!.explanation!;
    expect(e.facts.map((x) => x.key)).toEqual(
      expect.arrayContaining(['median_prev', 'median_recent', 'delta_kg']),
    );
    expect(e.facts.find((x) => x.key === 'median_prev')).toMatchObject({
      source: 'metrica',
      sourceId: 'e1rm_table_rpe',
      unit: 'kg',
    });
    expect(e.why.length).toBe(e.facts.length);
  });
  it('R-PR expone el candidato y los parámetros del intento', () => {
    const fxp = new Fixture();
    ['2026-02-23', '2026-03-02', '2026-03-09'].forEach((d, i) =>
      fxp.session(d, row(150, 7, 7), { key: `r${i}` }),
    );
    const e = rule(ev(fxp, '2026-03-10'), 'R-PR')!.explanation!;
    expect(e.paramsApplied).toMatchObject({ prRpe: 9, stepKg: 2.5, rpeSensitivity: 0.5 });
    expect(e.limits.join(' ')).toMatch(/no es un intervalo de confianza|no es una probabilidad/i);
  });
  it('mismas entradas, mismo corte, misma versión ⇒ misma salida completa', () => {
    expect(JSON.stringify(ev(fx(), '2026-03-10'))).toBe(JSON.stringify(ev(fx(), '2026-03-10')));
  });
  it('sin fuga de futuro: datos posteriores al corte no cambian el estado ni la explicación', () => {
    const a = ev(fx(), '2026-03-10');
    const future = fx().session('2026-04-20', row(220, 5, 8), { key: 'fut', exposure: 'squat-primaria' });
    const b = ev(future, '2026-03-10');
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    expect(b.principal!.explanation).toEqual(a.principal!.explanation);
  });
});

describe('TTP incompleto, segmentación y familias', () => {
  const block = (fx: Fixture, name: string, start: string, kgs: number[], family = 'F1', sets = 3) => {
    kgs.forEach((kg, i) => {
      const d = new Date(`${start}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 7 * i);
      fx.session(d.toISOString().slice(0, 10), row(kg, 8, 8, 5, sets), {
        key: `${name}-w${i + 1}`,
        block: name,
        week: i + 1,
        family,
        exposure: 'squat-primaria',
      });
    });
  };
  const sum = (fx: Fixture, events: ChangeEvent[] = []) =>
    summarizeBlocks({
      planned: fx.planned,
      actual: fx.actual,
      readiness: [],
      competitionExercises: { SQ: 'Squat comp' },
      cutoff: '2026-12-31',
      params: withMin(),
      events,
    });
  it('un bloque que termina mejorando es una observación censurada, no un pico', () => {
    const fx = new Fixture();
    block(fx, 'B1', '2026-01-05', [140, 145, 150, 155, 160, 162.5]);
    const t = sum(fx)[0]!.ttp;
    expect(t).toMatchObject({ state: 'censurado', censored: true, windowWeeks: null });
    expect(t.note).toMatch(/censurada/);
  });
  it('diferencia tiempo hasta mejora relevante, tiempo hasta el mejor valor y ventana favorable', () => {
    const fx = new Fixture();
    block(fx, 'B1', '2026-01-05', [140, 141, 145, 150, 155, 160, 157.5, 155, 152.5]);
    const t = sum(fx)[0]!.ttp;
    expect(t.state).toBe('delimitado');
    expect(t.timeToRelevantImprovementWeeks).toBe(3);
    expect(t.timeToBestWeeks).toBe(6);
    expect(t.windowWeeks).toEqual([6, 6]);
    expect(t.timeToRelevantImprovementWeeks).not.toBe(t.timeToBestWeeks);
  });
  it('si cambió el estímulo dentro del bloque lo marca y no atribuye todo a una duración única', () => {
    const fx = new Fixture();
    block(fx, 'B1', '2026-01-05', [140, 145, 150, 155, 160, 157.5, 155, 152.5]);
    const b = sum(fx, [change('chg', '2026-02-09')])[0]!;
    expect(b.stimulusChanges).toHaveLength(1);
    expect(b.ttp.segmented).toBe(true);
    expect(b.ttp.segmentBoundaries).toEqual(['2026-02-09']);
    expect(b.ttp.warnings.join(' ')).toMatch(/no debe atribuirse a una única duración/);
  });
  it('una familia cuyos bloques no son comparables no produce "patrón repetido" y lo explica', () => {
    const fx = new Fixture();
    block(fx, 'B1', '2026-01-05', [140, 145, 150, 155, 160, 157.5, 155, 152.5], 'F1', 3);
    block(fx, 'B2', '2026-04-06', [140, 145, 150, 155, 160, 165, 162.5, 160, 157.5], 'F1', 6); // el doble de dosis
    const f = summarizeFamilies(sum(fx), {}, withMin())[0]!;
    expect(f.comparability.consistent).toBe(false);
    expect(f.comparability.notes.join(' ')).toMatch(/dosis semanal de NL difiere/);
    expect(f.pattern).not.toBe('patron_repetido');
    expect(f.estimateForNext?.caveat).toMatch(/inconsistente/);
    expect(f.golden).toBe('exploratorio');
  });
  it('un patrón repetido en bloques comparables describe la estructura golden con sus limitaciones', () => {
    const fx = new Fixture();
    block(fx, 'B1', '2026-01-05', [140, 145, 150, 155, 160, 157.5, 155, 152.5]);
    block(fx, 'B2', '2026-04-06', [140, 145, 150, 155, 160, 165, 162.5, 160, 157.5]);
    const f = summarizeFamilies(sum(fx), { F1: { objective: 'fuerza' } }, withMin())[0]!;
    expect(f.pattern).toBe('patron_repetido');
    expect(f.golden).toBe('patron_repetido');
    const g = f.goldenCandidate!;
    expect(g).toMatchObject({ repetitions: 2, status: 'patron_repetido', objective: 'fuerza' });
    expect(g.exercises[0]).toMatchObject({ exposureId: 'squat-primaria', exerciseName: 'Squat comp' });
    expect(g.dose.nlPerWeek).toBe(15);
    expect(g.limitations.join(' ')).toMatch(/No es el microciclo óptimo ni permanente/);
    expect(g.limitations.join(' ')).toMatch(/No demuestra que la estructura haya causado/);
    expect(JSON.stringify(f)).not.toMatch(/fecha exacta|\d{4}-\d{2}-\d{2}.*pico/);
  });
  it('un solo ciclo favorable es un candidato exploratorio, no un patrón', () => {
    const fx = new Fixture();
    block(fx, 'B1', '2026-01-05', [140, 145, 150, 155, 160, 157.5, 155, 152.5]);
    const f = summarizeFamilies(sum(fx), {}, withMin())[0]!;
    expect(f.golden).toBe('exploratorio');
    expect(f.goldenCandidate?.status).toBe('exploratorio');
    expect(f.goldenCandidate?.limitations.join(' ')).toMatch(/Objetivo no declarado/);
  });
});

describe('Ciclo de vida de la intervención', () => {
  const base = () =>
    createIntervention({
      id: 'i1',
      origin: 'propuesta',
      proposalKey: 'SQ|x|R-LOAD|2026-03-09|v',
      lift: 'SQ',
      exposureId: 'x',
      detectedOn: '2026-03-10',
      on: '2026-03-10',
    });
  const ok = (r: ReturnType<typeof transition>) => {
    if (!r.ok) throw new Error(r.error);
    return r.intervention;
  };
  it('detectada → revisada → aceptada → aplicada → seguimiento → cerrada, con fechas separadas', () => {
    let i = base();
    i = ok(transition(i, { to: 'revisada', on: '2026-03-11' }));
    i = ok(transition(i, { to: 'aceptada', on: '2026-03-12', note: 'probar' }));
    expect(i).toMatchObject({ state: 'aceptada', decidedOn: '2026-03-12', appliedOn: null }); // aceptar no es aplicar
    i = ok(
      transition(i, {
        to: 'aplicada',
        on: '2026-03-15',
        appliedOn: '2026-03-14',
        appliedDescription: '152,5 kg en la próxima sesión',
      }),
    );
    expect(i).toMatchObject({
      detectedOn: '2026-03-10',
      reviewedOn: '2026-03-11',
      decidedOn: '2026-03-12',
      appliedOn: '2026-03-14',
      deviatesFromProposal: false,
    });
    i = ok(transition(i, { to: 'seguimiento', on: '2026-03-16' }));
    i = ok(transition(i, { to: 'cerrada', on: '2026-04-20' }));
    expect(i.closedOn).toBe('2026-04-20');
    expect(i.history.map((h) => h.to)).toEqual([
      'detectada',
      'revisada',
      'aceptada',
      'aplicada',
      'seguimiento',
      'cerrada',
    ]);
  });
  it('se puede aceptar sin aplicar todavía y registrar una aplicación distinta de la propuesta', () => {
    let i = ok(transition(base(), { to: 'aceptada', on: '2026-03-11' }));
    expect(i.state).toBe('aceptada');
    expect(i.reviewedOn).toBe('2026-03-11');
    i = ok(
      transition(i, {
        to: 'aplicada',
        on: '2026-03-20',
        appliedDescription: 'Subí 5 kg en lugar de 2,5',
        deviatesFromProposal: true,
      }),
    );
    expect(i.deviatesFromProposal).toBe(true);
    expect(i.appliedOn).toBe('2026-03-20');
  });
  it('registra una intervención manual sin propuesta previa y vincula una modificación del plan', () => {
    let i = createIntervention({
      id: 'm1',
      origin: 'manual',
      lift: 'SQ',
      on: '2026-03-12',
      appliedOn: '2026-03-12',
      appliedDescription: 'Sumé una serie al día 1',
    });
    expect(i).toMatchObject({ origin: 'manual', proposalKey: null, state: 'aplicada', detectedOn: null });
    i = linkEvent(i, 'v1->v2', '2026-03-13');
    expect(i.linkedEventId).toBe('v1->v2');
    expect(i.state).toBe('aplicada');
  });
  it('rechaza transiciones incoherentes y fechas inválidas', () => {
    expect(transition(base(), { to: 'aplicada', on: '2026-03-11' })).toMatchObject({ ok: false });
    expect(transition(base(), { to: 'cerrada', on: '2026-03-11' })).toMatchObject({ ok: false });
    expect(transition(base(), { to: 'revisada', on: '11/03/2026' })).toMatchObject({ ok: false });
    const discarded = ok(transition(base(), { to: 'descartada', on: '2026-03-11' }));
    expect(transition(discarded, { to: 'aplicada', on: '2026-03-12' })).toMatchObject({ ok: false });
    expect(ok(transition(discarded, { to: 'revisada', on: '2026-03-13' })).state).toBe('revisada'); // reabrir
  });
  it('el seguimiento está pendiente hasta que haya exposiciones posteriores suficientes y no afirma causalidad', () => {
    const i = ok(
      transition(ok(transition(base(), { to: 'aceptada', on: '2026-03-11' })), {
        to: 'aplicada',
        on: '2026-03-12',
        appliedOn: '2026-03-12',
        appliedDescription: 'subir carga',
      }),
    );
    const fx = new Fixture();
    ['2026-02-01', '2026-02-08', '2026-02-15'].forEach((d, k) => fx.session(d, row(150), { key: `p${k}` }));
    const inp = (cut: string, extra: number) => {
      const f2 = new Fixture();
      ['2026-02-01', '2026-02-08', '2026-02-15'].forEach((d, k) => f2.session(d, row(150), { key: `p${k}` }));
      for (let k = 0; k < extra; k++)
        f2.session(`2026-03-${String(14 + 7 * k).padStart(2, '0')}`, row(155), { key: `q${k}` });
      return {
        planned: f2.planned,
        actual: f2.actual,
        readiness: [],
        competitionExercises: { SQ: 'Squat comp' as const },
        cutoff: cut,
        params: withMin(),
        events: [] as ChangeEvent[],
        otherInterventions: [],
      };
    };
    const pending = interventionFollowUp(i, inp('2026-03-20', 1))!;
    expect(pending.state).toBe('pendiente');
    expect(pending.text).toMatch(/No se evalúa todavía/);
    const done = interventionFollowUp(i, inp('2026-04-15', 3))!;
    expect(done.state).toBe('evaluado');
    expect(done.interventionId).toBe('i1');
    expect(done.text).toMatch(/tras la intervención/);
    expect(done.text).toMatch(/no una prueba de causalidad/);
    expect(done.text).not.toMatch(/produjo|causó|gracias a/i);
    const other = createIntervention({
      id: 'i2',
      origin: 'manual',
      lift: 'SQ',
      on: '2026-03-25',
      appliedOn: '2026-03-25',
      appliedDescription: 'otra cosa',
    });
    const aff = interventionFollowUp(i, { ...inp('2026-04-15', 3), otherInterventions: [other] })!;
    expect(aff.state).toBe('afectado');
    expect(aff.text).toMatch(/coincidió con/);
    expect(interventionFollowUp(base(), inp('2026-04-15', 3))).toBeNull(); // no aplicada: sin seguimiento
  });
  it('las decisiones históricas no desaparecen y conservan su ciclo de vida al reevaluar', () => {
    const fx = weekly(new Fixture(), '2026-02-02', 6, (i) => [145, 145, 147.5, 150, 152.5, 155][i] as number);
    const p = withMin();
    const mk = (cut: string, f: Fixture) => ({
      cutoff: cut,
      rulesVersion: 'reglas-v0.2-propuesta',
      paramsVersion: 'params-v2',
      lifts: { SQ: ev(f, cut, p) },
      blocks: [],
      families: [],
    });
    const rows1 = toDecisionRows(mk('2026-03-10', fx), p);
    const first = rows1[0]!;
    const decided = rows1.map((r) =>
      r.key === first.key
        ? {
            ...r,
            lifecycle: 'aplicada' as const,
            interventionId: 'i1',
            decidedOn: '2026-03-11',
            coachNote: 'ok',
          }
        : r,
    );
    const again = mergeDecisions(decided, toDecisionRows(mk('2026-03-10', fx), p), '2026-03-10');
    expect(again.find((r) => r.key === first.key)).toMatchObject({
      lifecycle: 'aplicada',
      interventionId: 'i1',
      coachDecision: 'Atendida',
      detectedOn: '2026-03-10',
    });
    const later = mergeDecisions(
      again,
      toDecisionRows(
        mk('2026-03-17', fx.session('2026-03-16', row(157.5), { key: 'w6', exposure: 'squat-primaria' })),
        p,
      ),
      '2026-03-17',
    );
    expect(later.find((r) => r.key === first.key)).toMatchObject({
      validity: 'expirada',
      lifecycle: 'aplicada',
    });
    expect(legacyDecision('aceptada')).toBe('Aprobada');
    expect(lifecycleFromLegacy('Descartada')).toBe('descartada');
  });
});
