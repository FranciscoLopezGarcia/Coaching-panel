import { describe, expect, it } from 'vitest';
import { runReplay, planKnownAt, type ReplayInput } from '../src/replay.js';
import type { PlanSnapshot } from '../src/snapshot.js';
import type { PlannedSet } from '../src/types.js';
import { Fixture, row, withMin } from './helpers.js';

/** Serie semanal de una exposición, con la carga que indique `kg(i)`, empezando el lunes 2026-01-05. */
const series = (n: number, kg: (i: number) => number, rpe = 8): Fixture => {
  const fx = new Fixture();
  for (let i = 0; i < n; i++) {
    const d = new Date('2026-01-05T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 7 * i);
    fx.session(d.toISOString().slice(0, 10), row(kg(i), rpe, rpe), {
      key: `w${i}`,
      week: i + 1,
      exposure: 'squat-primaria',
    });
  }
  return fx;
};
const base = (fx: Fixture, over: Partial<ReplayInput> = {}): ReplayInput => ({
  plannedSets: fx.planned,
  actualSets: fx.actual,
  readinessHistory: [],
  competitionExercises: { SQ: 'Squat comp' },
  params: withMin(),
  from: '2026-01-11',
  to: '2026-05-31',
  ...over,
});
const progressing = (i: number) => 140 + Math.min(i, 12) * 2.5;

describe('Replay histórico: solo datos conocidos a cada corte', () => {
  it('sin fuga de futuro: los cortes anteriores no cambian aunque existan datos posteriores', () => {
    const full = series(20, progressing);
    const trunc = series(10, progressing);
    const a = runReplay(base(full, { to: '2026-03-08' }));
    const b = runReplay(base(trunc, { to: '2026-03-08' }));
    expect(a.points.length).toBeGreaterThan(5);
    expect(JSON.stringify(a.points)).toBe(JSON.stringify(b.points));
  });
  it('identifica método y versiones y declara las limitaciones', () => {
    const r = runReplay(base(series(12, progressing)));
    expect(r.method).toMatchObject({
      rulesVersion: 'reglas-v0.2-propuesta',
      paramsVersion: 'params-v2',
      step: 'weekly',
    });
    expect(r.limitations.join(' ')).toMatch(/No hay datos de lesión/);
    expect(r.limitations.join(' ')).toMatch(/no es un error del motor|no se llama falso positivo/);
    expect(r.limitations.join(' ')).toMatch(/no prueba que la recomendación fuera correcta ni causal/);
  });
  it('respeta cuándo se conocía la programación: la versión vigente a cada corte', () => {
    const fx = series(12, progressing);
    const all = fx.planned;
    const v1: PlanSnapshot = {
      id: 'v1',
      seq: 1,
      status: 'aplicado',
      detectedOn: '2026-01-01',
      effectiveOn: null,
      label: '',
      sets: all.filter((s) => s.weekNo <= 6),
    };
    const v2: PlanSnapshot = {
      id: 'v2',
      seq: 2,
      status: 'aplicado',
      detectedOn: '2026-02-10',
      effectiveOn: null,
      label: '',
      sets: all,
    };
    expect(planKnownAt({ plannedSets: all, snapshots: [v1, v2] }, '2026-01-20')).toMatchObject({
      snapshotId: 'v1',
      knowledge: 'snapshot',
    });
    expect(planKnownAt({ plannedSets: all, snapshots: [v1, v2] }, '2026-01-20').sets).toHaveLength(18);
    expect(planKnownAt({ plannedSets: all, snapshots: [v1, v2] }, '2026-02-15').sets).toHaveLength(36);
    expect(planKnownAt({ plannedSets: all, snapshots: [v1, v2] }, '2025-12-01')).toMatchObject({
      snapshotId: null,
      sets: [],
    });
    expect(planKnownAt({ plannedSets: all }, '2026-01-20')).toMatchObject({
      knowledge: 'plan_completo_asumido',
    });
  });
  it('un plan que se conoció tarde no permite evaluar antes de existir', () => {
    const fx = series(12, progressing);
    const late: PlanSnapshot = {
      id: 'late',
      seq: 1,
      status: 'aplicado',
      detectedOn: '2026-03-01',
      effectiveOn: null,
      label: '',
      sets: fx.planned,
    };
    const r = runReplay(base(fx, { snapshots: [late], to: '2026-02-22' }));
    expect(r.points.every((p) => p.snapshotId === null)).toBe(true);
    expect(r.points.every((p) => p.lifts.every((l) => !l.evaluable))).toBe(true);
    expect(r.coverage.SQ!.evaluable).toBe(0);
  });
  it('informa cobertura y motivos de abstención (no esconde cuándo no se pudo evaluar)', () => {
    const r = runReplay(base(series(12, progressing)));
    const c = r.coverage.SQ!;
    expect(c.cutoffs).toBeGreaterThan(c.evaluable);
    expect(c.evaluableFraction).toBeLessThan(1);
    expect(c.topAbstentionReasons.length).toBeGreaterThan(0);
    expect(c.topAbstentionReasons.map((x) => x.reason).join(' | ')).toMatch(/R-PROGRESS/);
  });
  it('mide frecuencia de alertas, persistencia y cambios de estado', () => {
    const r = runReplay(base(series(20, progressing)));
    const freq = Object.fromEntries(r.alertFrequency.map((x) => [x.status, x.cutoffs]));
    expect(Object.keys(freq).length).toBeGreaterThan(1);
    expect(r.alertFrequency.every((x) => x.fraction > 0 && x.fraction <= 1)).toBe(true);
    expect(r.persistence.every((p) => p.runs >= 1 && p.maxRunLength >= p.meanRunLength)).toBe(true);
    expect(r.transitions.length).toBeGreaterThan(0);
    expect(r.transitions.every((t) => t.from !== t.to)).toBe(true);
  });
  it('describe lo observado después con un baseline simple, sin llamarlo acierto', () => {
    const r = runReplay(base(series(20, progressing)));
    expect(r.baseline[0]!.withOutcome).toBeGreaterThan(0);
    const prog = r.followUp.find((f) => f.status === 'progreso_sostenido');
    if (prog) expect(prog.withOutcome).toBeLessThanOrEqual(prog.occurrences);
    const { limitations: _l, ...datos } = r;
    void _l;
    expect(JSON.stringify(datos)).not.toMatch(/falso positivo|acierto|accuracy/i);
  });
  it('a falta de datos suficientes no fabrica nada: pocos cortes, sin resultados posteriores', () => {
    const r = runReplay(base(series(3, progressing), { to: '2026-01-31' }));
    expect(r.baseline[0]!.withOutcome).toBe(0);
    expect(r.baseline[0]!.medianChangePct).toBeNull();
    expect(r.followUp.every((f) => f.withOutcome === 0 && f.medianChangePct === null)).toBe(true);
  });
});

describe('Candidatos a PR en el replay', () => {
  const prSeries = (later: number | null): Fixture => {
    const fx = series(8, () => 150, 7);
    if (later !== null)
      fx.session('2026-03-02', row(later, 8, 8), { key: 'intento', week: 9, exposure: 'squat-primaria' });
    return fx;
  };
  const prs = (fx: Fixture) =>
    runReplay(base(fx, { from: '2026-02-01', to: '2026-02-28', params: withMin() })).prAttempts;
  it('un candidato que nunca se intentó queda "no intentado": no es un falso positivo', () => {
    const r = prs(prSeries(null));
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.result === 'no_intentado')).toBe(true);
  });
  it('si después se levantó la carga propuesta o más, se registra como intentado', () => {
    const r = prs(prSeries(160));
    expect(r.some((x) => x.result === 'intentado_igualado_o_superado')).toBe(true);
  });
  it('si se intentó algo por encima del récord pero sin llegar a lo propuesto, se distingue', () => {
    const r = prs(prSeries(152.5));
    expect(r.some((x) => x.result === 'intentado_sin_alcanzar')).toBe(true);
  });
});

describe('Entradas del replay', () => {
  it('por sesiones: un corte por cada fecha con series hechas', () => {
    const fx = series(6, progressing);
    const r = runReplay(base(fx, { step: 'sessions', from: '2026-01-01', to: '2026-02-28' }));
    expect(r.points.map((p) => p.cutoff)).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
      '2026-02-02',
      '2026-02-09',
    ]);
  });
  it('los check-ins y revisiones posteriores al corte no se ven', () => {
    const fx = series(8, () => 150, 7);
    const withLate = runReplay(
      base(fx, {
        from: '2026-02-01',
        to: '2026-02-08',
        readinessHistory: [{ date: '2026-02-15', value: 9 }],
        coachReviews: [{ lift: 'SQ', date: '2026-02-20', verdict: 'no_comparable', note: '' }],
      }),
    );
    const without = runReplay(base(fx, { from: '2026-02-01', to: '2026-02-08' }));
    expect(JSON.stringify(withLate.points)).toBe(JSON.stringify(without.points));
  });
});

export type { PlannedSet };
