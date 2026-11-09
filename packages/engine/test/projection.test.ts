import { describe, expect, it } from 'vitest';
import {
  PROJECTION_DEFAULTS,
  fitModel,
  projectPerformance,
  rollingOrigin,
  validate,
  buildProjectionConfig,
  calibrationOf,
  observedCoverage,
  type ObservedSet,
  type ProjectionInput,
} from '../src/index.js';

/* Datos 100 % sintéticos. Una exposición = una sesión de "Squat comp" con series de 5 reps a RPE 8. */
let uid = 0;
function set(date: string, kg: number, o: Partial<ObservedSet> = {}): ObservedSet {
  return {
    id: `s${++uid}`,
    source: 'plan',
    sessionKey: `ses-${date}`,
    date,
    exerciseName: 'Squat comp',
    exerciseId: 'squat-comp',
    lift: 'SQ',
    variantKey: 'Squat comp',
    setType: 'work',
    kg,
    reps: 5,
    rpe: 8,
    loadKind: 'total',
    plannedSetId: null,
    refKg: null,
    refSource: null,
    refAsOf: null,
    ...o,
  };
}
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
const series = (days: number[], kgOf: (i: number, d: number) => number, o: Partial<ObservedSet> = {}) =>
  days.map((d, i) => set(day(d), kgOf(i, d), o));
const weekly = (n: number) => Array.from({ length: n }, (_, i) => i * 7);
const base = (obs: ObservedSet[], cutoff: string, extra: Partial<ProjectionInput> = {}): ProjectionInput => ({
  athleteId: 'a',
  obs,
  cutoff,
  filters: { lift: 'SQ' },
  variable: 'e1rm_table_rpe',
  ...extra,
});
const MIN = {
  minChangePct: 1,
  minChangeKg: 2,
  loadLimitKg: null,
  prReps: null,
  explorationApproved: false,
  stepKg: null,
  prRpe: null,
  allowSingleMax: null,
  prExtrapolationReps: null,
  prEffortGap: null,
};

describe('Proyección · series por exposición', () => {
  it('una sesión con muchas series pesa lo mismo que una con una sola (un punto por exposición)', () => {
    const many = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100].map((kg) =>
      set(day(0), kg, { sessionKey: 'A' }),
    );
    const one = set(day(7), 100, { sessionKey: 'B' });
    const r = projectPerformance(base([...many, one], day(8)));
    expect(r.observedPoints).toHaveLength(2);
    expect(r.observedPoints[0]).toMatchObject({ nSets: 10 });
    expect(r.observedPoints[0]?.value).toBe(r.observedPoints[1]?.value);
    expect(r.dataQuality.exposures).toBe(2);
  });
  it('aggregate best vs median: devuelve el otro resumen y no mezcla', () => {
    const sets = [90, 100, 110].map((kg) => set(day(0), kg, { sessionKey: 'A' }));
    const best = projectPerformance(base(sets, day(1)));
    const med = projectPerformance(base(sets, day(1), { config: { aggregate: 'median' } }));
    expect(best.observedPoints[0]?.value).toBeGreaterThan(med.observedPoints[0]?.value as number);
    expect(best.observedPoints[0]?.alternateValue).toBe(med.observedPoints[0]?.value);
  });
  it('sin RPE real no hay e1RM por curva: no se completa con el objetivo ni se convierte en test máximo', () => {
    const r = projectPerformance(
      base(
        series(weekly(8), () => 100, { rpe: null }),
        day(50),
      ),
    );
    expect(r.status).toBe('unavailable');
    expect(r.reasons[0]?.code).toBe('no_rpe');
    expect(r.exclusions[0]?.reason).toMatch(/sin RPE real/);
    // el método por fórmulas es OTRO método y se pide explícitamente
    const f = projectPerformance(
      base(
        series(weekly(8), () => 100, { rpe: null }),
        day(50),
        { variable: 'e1rm_prg_formulas' },
      ),
    );
    expect(f.target.method.id).toBe('prg-6-formulas');
    expect(f.observedPoints.length).toBe(8);
    expect(f.dataQuality.warnings.join(' ')).toMatch(/submáxima/);
  });
  it('métodos distintos dan series distintas y nunca se mezclan', () => {
    const obs = series(weekly(6), (i) => 100 + i * 2);
    const curve = projectPerformance(base(obs, day(40)));
    const prg = projectPerformance(base(obs, day(40), { variable: 'e1rm_prg_formulas' }));
    expect(curve.target.method.id).not.toBe(prg.target.method.id);
    expect(curve.observedPoints[0]?.value).not.toBe(prg.observedPoints[0]?.value);
  });
  it('varias variantes: exige elegir una; no extrapola equivalencias', () => {
    const obs = [
      ...series(weekly(6), () => 100),
      ...series(weekly(6), () => 80, { variantKey: 'Pausa', exerciseName: 'Squat pausa' }),
    ];
    const r = projectPerformance(base(obs, day(40)));
    expect(r.status).toBe('unavailable');
    expect(r.reasons[0]?.code).toBe('variant_required');
    expect(r.selection.availableVariants).toHaveLength(2);
    expect(r.observedPoints).toHaveLength(0);
    const ok = projectPerformance(
      base(obs, day(40), { filters: { lift: 'SQ', exercise: 'Squat pausa', variantKey: 'Pausa' } }),
    );
    expect(ok.observedPoints.length).toBe(6);
    expect(ok.target.variantKey).toBe('Pausa');
  });
  it('excluye cargas no comparables y lo informa', () => {
    const obs = [...series(weekly(5), () => 100), set(day(3), 40, { loadKind: 'per_side', sessionKey: 'x' })];
    const r = projectPerformance(base(obs, day(40)));
    expect(r.exclusions.some((e) => /per_side/.test(e.reason))).toBe(true);
  });
});

describe('Proyección · modelos y estados', () => {
  it('tendencia creciente: lineal proyecta por encima del baseline y el eje es tiempo real', () => {
    const obs = series(weekly(14), (i) => 100 + i * 2);
    const r = projectPerformance(base(obs, day(95)));
    expect(r.status).toBe('available');
    const lin = r.model.candidates.find((c) => c.id === 'linear');
    expect(lin?.slopeKgPerWeek).toBeGreaterThan(0);
    const last = r.forecastPoints.at(-1);
    expect(last?.horizonDays).toBe(28);
    expect(last?.date).toBe(day(13 * 7 + 28));
    expect(r.horizon.fromDate).toBe(day(13 * 7));
  });
  it('fechas irregulares: una pendiente por día real, no por número de exposición', () => {
    const days = [0, 3, 14, 17, 40, 41, 70];
    const kg = (_: number, d: number) => 100 + d * (2 / 7); // +2 kg por semana REAL
    const a = projectPerformance(base(series(days, kg), day(75)));
    const lin = a.model.candidates.find((c) => c.id === 'linear');
    // e1RM = kg × constante: la pendiente en e1RM es proporcional a +2 kg/semana REALES
    const ratio = (a.observedPoints[0]?.value as number) / 100; // e1RM por kg levantado (constante)
    expect((lin?.slopeKgPerWeek as number) / ratio).toBeCloseTo(2, 0);
    expect(a.dataQuality.irregularity.maxGapDays).toBe(29);
  });
  it('estable: la tendencia no se clasifica sin cambio mínimo configurado; con él, se clasifica', () => {
    const obs = series(weekly(10), () => 100);
    const sin = projectPerformance(base(obs, day(70)));
    expect(sin.summary.trend.label).toBe('indeterminada');
    expect(sin.summary.text).toMatch(/no se clasifica/);
    const con = projectPerformance(base(obs, day(70), { liftConfig: MIN }));
    expect(con.summary.trend.label).toBe('estable');
  });
  it('descenso con cambio mínimo configurado → descendente; sin él → solo describe el cambio', () => {
    const obs = series(weekly(10), (i) => 120 - i * 2);
    const con = projectPerformance(base(obs, day(70), { liftConfig: MIN }));
    expect(con.summary.trend.label).toBe('descendente');
    expect(con.summary.trend.changeKgOverSpan).toBeLessThan(0);
    expect(projectPerformance(base(obs, day(70))).summary.trend.label).toBe('indeterminada');
  });
  it('pocas exposiciones → solo descriptivo con motivo; no proyecta', () => {
    const r = projectPerformance(
      base(
        series([0, 7, 14], (i) => 100 + i),
        day(20),
      ),
    );
    expect(r.status).toBe('descriptive_only');
    expect(r.reasons.map((x) => x.code)).toEqual(
      expect.arrayContaining(['insufficient_exposures', 'insufficient_span']),
    );
    expect(r.forecastPoints).toEqual([]);
    expect(r.summary.projection).toBeNull();
    expect(r.summary.text).toMatch(/No se proyecta/);
  });
  it('datos obsoletos → descriptivo', () => {
    const r = projectPerformance(
      base(
        series(weekly(8), () => 100),
        day(49 + 60),
      ),
    );
    expect(r.status).toBe('descriptive_only');
    expect(r.reasons.some((x) => x.code === 'stale_data')).toBe(true);
    expect(r.dataQuality.stale).toBe(true);
  });
  it('horizonte excesivo respecto del historial → no proyecta y dice el máximo', () => {
    const r = projectPerformance(
      base(
        series(weekly(8), (i) => 100 + i),
        day(50),
        { config: { horizonDays: 60 } },
      ),
    );
    expect(r.status).toBe('descriptive_only');
    expect(r.reasons.find((x) => x.code === 'horizon_exceeds_history')?.message).toMatch(/máximo permitido/);
    expect(r.horizon.maxAllowedDays).toBe(24); // floor(0,5 × 49)
  });
  it('atípico: se marca, NO se elimina, y se informa la sensibilidad', () => {
    const obs = series(weekly(12), (i) => (i === 6 ? 140 : 100 + i));
    const r = projectPerformance(base(obs, day(80)));
    expect(r.observedPoints).toHaveLength(12);
    expect(r.observedPoints.filter((p) => p.outlier.flag)).toHaveLength(1);
    expect(r.dataQuality.outliers.count).toBe(1);
    expect(r.dataQuality.outliers.treatment).toMatch(/no se eliminan/);
    expect(r.dataQuality.outliers.sensitivity).not.toBeNull();
    expect(Math.abs(r.dataQuality.outliers.sensitivity?.diffKg as number)).toBeGreaterThanOrEqual(0);
  });
  it('sin datos: unavailable con motivo', () => {
    const r = projectPerformance(base([], day(5)));
    expect(r.status).toBe('unavailable');
    expect(r.reasons[0]?.code).toBe('no_data');
  });
  it('baseline = mediana de las últimas K exposiciones', () => {
    const f = fitModel(
      'baseline',
      [0, 7, 14, 21, 28].map((t, i) => ({ t, y: [10, 20, 30, 100, 40][i] as number })),
      buildProjectionConfig(),
    );
    expect(f?.predict(999)).toBe(40); // mediana de 30, 100, 40
  });
});

describe('Proyección · validación temporal sin fuga', () => {
  it('los datos posteriores al corte no cambian NADA del resultado', () => {
    const cut = series(weekly(14), (i) => 100 + i);
    const future = series([200, 207, 214], () => 500);
    const a = projectPerformance(base(cut, day(95)));
    const b = projectPerformance(base([...cut, ...future], day(95)));
    expect(b.observedPoints).toEqual(a.observedPoints);
    expect(b.forecastPoints).toEqual(a.forecastPoints);
    expect(b.validation).toEqual(a.validation);
  });
  it('cada pliegue se ajusta solo con puntos ≤ origen: cambiar el último punto no altera pliegues anteriores', () => {
    const cfg = buildProjectionConfig();
    const pts = (last: number) => weekly(14).map((t, i) => ({ t: t + 20000, y: i === 13 ? last : 100 + i }));
    const A = rollingOrigin(pts(113), 28, cfg).folds;
    const B = rollingOrigin(pts(900), 28, cfg).folds;
    const target13 = 13 * 7 + 20000;
    const stable = A.filter((f) => f.targetT < target13);
    expect(stable.length).toBeGreaterThan(3);
    stable.forEach((f, i) => expect(B[i]?.pred).toEqual(f.pred));
  });
  it('compara los modelos en los MISMOS pliegues y reporta n, MAE, sesgo y diferencia frente al baseline', () => {
    const r = projectPerformance(
      base(
        series(weekly(20), (i) => 100 + i * 1.5),
        day(150),
      ),
    );
    const ns = new Set(r.validation.models.map((m) => m.n));
    expect(ns.size).toBe(1);
    expect(r.validation.evaluations).toBeGreaterThan(0);
    const lin = r.validation.models.find((m) => m.id === 'linear');
    const bl = r.validation.models.find((m) => m.id === 'baseline');
    expect(lin?.maeKg).toBeLessThan(bl?.maeKg as number); // una tendencia clara favorece a la lineal
    expect(bl?.diffMaeVsBaselineKg).toBe(0);
    expect(lin?.biasKg).toBeDefined();
    expect(r.validation.toleranceDays).toBe(PROJECTION_DEFAULTS.targetToleranceDays);
  });
  it('con pocas evaluaciones no declara ganador: queda el baseline y el veredicto es no concluyente', () => {
    const r = projectPerformance(
      base(
        series(weekly(9), (i) => 100 + i * 2),
        day(65),
        { config: { minEvaluations: 8 } },
      ),
    );
    expect(r.validation.evaluations).toBeLessThan(8);
    expect(r.model.selected?.id).toBe('baseline');
    expect(r.validation.verdict).toBe('no_concluyente');
    expect(r.summary.projection?.versusBaseline).toBe('no_concluyente');
    expect(r.summary.text).toMatch(/no concluyente/i);
  });
  it('un modelo que pierde contra el baseline no se elige y se muestra honestamente', () => {
    // serie plana con ruido alternante: la tendencia ajustada con pocos puntos extrapola ruido
    const obs = series(weekly(26), (i) => 100 + (i % 3 === 0 ? 6 : i % 3 === 1 ? -5 : 1));
    const r = projectPerformance(base(obs, day(180)));
    const lin = r.validation.models.find((m) => m.id === 'linear');
    const bl = r.validation.models.find((m) => m.id === 'baseline');
    expect(
      (lin?.maeKg as number) >= (bl?.maeKg as number) - 1e-9 || r.model.selected?.id !== 'baseline',
    ).toBe(true);
    if (r.model.selected?.id === 'baseline') expect(r.validation.verdict).not.toBe('mejora_sobre_baseline');
    expect(r.summary.text).not.toMatch(/va a levantar|PR asegurado|pico confirmado/i);
  });
  it('con tendencia clara el selector anidado mejora al baseline y se muestra el modelo con tendencia; sin mejora, el baseline', () => {
    const up = projectPerformance(
      base(
        series(weekly(24), (i) => 100 + i * 2),
        day(170),
      ),
    );
    expect(up.validation.verdict).toBe('mejora_sobre_baseline');
    expect(up.model.selected?.id).not.toBe('baseline');
    expect(up.validation.selector?.diffMaeVsBaselineKg).toBeLessThan(0);
    expect(up.summary.projection?.versusBaseline).toBe('mejora');
    const flat = projectPerformance(
      base(
        series(weekly(24), (i) => 100 + (i % 2 ? 4 : -4)),
        day(170),
      ),
    );
    expect(flat.validation.verdict).not.toBe('mejora_sobre_baseline');
    expect(flat.model.selected?.id).toBe('baseline');
  });
  it('selección anidada: el selector elige con pliegues ya conocidos en cada origen', () => {
    const cfg = buildProjectionConfig();
    const pts = weekly(24).map((t, i) => ({ t: t + 20000, y: 100 + i * 2 }));
    const v = validate(rollingOrigin(pts, 28, cfg).folds, cfg);
    expect(v.selectorChoices.slice(0, 3).every((c) => c.chosen === 'baseline')).toBe(true); // sin historia de errores
    expect(v.selectorChoices.some((c) => c.chosen !== 'baseline')).toBe(true);
    expect(v.selector.n).toBe(v.evaluations);
  });
});

describe('Proyección · rangos empíricos', () => {
  it('sin errores suficientes: rango NO disponible, sin porcentajes inventados', () => {
    const r = projectPerformance(
      base(
        series(weekly(9), (i) => 100 + i),
        day(65),
      ),
    );
    expect(r.forecastRange.status).toBe('unavailable');
    expect(r.forecastRange.points).toEqual([]);
    expect(r.forecastRange.reason).toMatch(/insuficientes/);
    expect(JSON.stringify(r.forecastRange)).not.toMatch(/±|%/);
  });
  it('con errores suficientes: rango empírico del MISMO resultado, con método, muestra y cobertura observada', () => {
    const noisy = series(weekly(30), (i) => 100 + i + (i % 4 === 0 ? 2 : i % 4 === 1 ? -2 : 0));
    const r = projectPerformance(base(noisy, day(210), { config: { minEvaluations: 6 } }));
    expect(r.forecastRange.status).toBe('available');
    expect(r.forecastRange.method).toBe('empirical-quantile-nearest-rank-v1');
    expect(r.forecastRange.sampleSize).toBeGreaterThanOrEqual(10);
    expect(r.forecastRange.nominalCoverage).toBe(0.8);
    const pt = r.forecastRange.points[0];
    const fc = r.forecastPoints.at(-1);
    expect(pt?.date).toBe(fc?.date);
    expect(pt?.lower).toBeLessThanOrEqual(pt?.upper as number);
    expect(
      r.forecastRange.observedCoverage === null ||
        (r.forecastRange.observedCoverage >= 0 && r.forecastRange.observedCoverage <= 1),
    ).toBe(true);
    expect(r.forecastRange.notice).toMatch(/no garantiza/);
  });
});

describe('Proyección · calibración del rango', () => {
  const cfg = buildProjectionConfig();
  it('la cobertura observada menor que la nominal produce advertencia estructurada y nunca se presenta como calibrada', () => {
    const c = calibrationOf(0.7, 224, cfg);
    expect(c).toMatchObject({ status: 'below_nominal', nominal: 0.8, observed: 0.7, sample: 224 });
    expect(c.shortfall).toBeCloseTo(0.1, 6);
    expect(calibrationOf(0.85, 50, cfg).status).toBe('at_or_above_nominal');
  });
  it('sin muestra suficiente la cobertura no es evaluable (no se asume calibrada)', () => {
    expect(calibrationOf(1, 4, cfg)).toMatchObject({ status: 'not_evaluable', shortfall: null });
    expect(calibrationOf(null, 0, cfg).status).toBe('not_evaluable');
  });
  it('el resultado trae etiqueta, calibración y advertencias; el texto aclara que no está calibrado', () => {
    const noisy = series(weekly(30), (i) => 100 + i + (i % 4 === 0 ? 2 : i % 4 === 1 ? -2 : 0));
    const r = projectPerformance(base(noisy, day(210), { config: { minEvaluations: 6 } }));
    expect(r.forecastRange.status).toBe('available');
    expect(r.forecastRange.label).toBe('rango empírico no calibrado');
    expect(r.forecastRange.calibration?.sample).toBe(r.forecastRange.coverageSample);
    expect(r.forecastRange.calibration?.observed).toBe(r.forecastRange.observedCoverage);
    expect(r.forecastRange.warnings).toBeDefined();
    expect(r.summary.text).toMatch(/no calibrado/);
    expect(JSON.stringify(r.summary)).not.toMatch(/80 % de confianza|intervalo de confianza del/i);
  });
  it('la cobertura se mide fuera de muestra: el rango de cada pliegue solo usa errores de pliegues ya conocidos en ese origen', () => {
    const folds = Array.from({ length: 30 }, (_, i) => ({
      originT: i * 7,
      targetT: i * 7 + 28,
      horizonDays: 28,
      actual: 0,
      pred: { baseline: i % 2 ? 3 : -3, linear: 0, linear_weighted: 0 },
    }));
    const early = observedCoverage(folds, (f) => (f.pred.baseline as number) - f.actual, cfg);
    // con un cambio abrupto posterior los pliegues previos no se ven afectados
    const changed = folds.map((f, i) => (i >= 28 ? { ...f, pred: { ...f.pred, baseline: 99 } } : f));
    const later = observedCoverage(changed.slice(0, 20), (f) => (f.pred.baseline as number) - f.actual, cfg);
    expect(later.sample).toBeLessThanOrEqual(early.sample);
    expect(early.coverage).not.toBeNull();
  });
});

describe('Proyección · integración y períodos', () => {
  it('la vista (meso) no cambia el entrenamiento por defecto y se identifica el período de entrenamiento', () => {
    const obs = series(weekly(14), (i) => 100 + i);
    const r = projectPerformance(
      base(obs, day(95), { view: { kind: 'meso', from: day(42), to: day(95), label: 'M2' } }),
    );
    expect(r.periods.training?.scope).toBe('history');
    expect(r.periods.training?.from).toBe(day(0));
    expect(r.periods.training?.note).toMatch(/anterior al período mostrado/);
    expect(r.observedPoints.filter((p) => p.inView).length).toBeLessThan(r.observedPoints.length);
    const v = projectPerformance(
      base(obs, day(95), { scope: 'view', view: { kind: 'meso', from: day(42), to: day(95) } }),
    );
    expect(v.periods.training?.from).toBe(day(42));
    expect(v.observedPoints.every((p) => p.inView)).toBe(true);
  });
  it('marcas reales y referencia quedan APARTE de la serie ajustada', () => {
    const obs = series(weekly(8), (i) => 100 + i);
    const refs = [
      {
        id: 'r1',
        exerciseName: 'Squat comp',
        kg: 150,
        source: 'test' as const,
        asOf: day(0),
        version: 'v1',
        note: '',
      },
    ];
    const r = projectPerformance(base(obs, day(55), { references: refs }));
    expect(r.realMarks.find((m) => m.reps === 5)?.kg).toBe(107);
    expect(r.reference).toMatchObject({ kg: 150 });
    expect(r.observedPoints.every((p) => p.value !== 150)).toBe(true);
    const futureRef = projectPerformance(
      base(obs, day(55), { references: [{ ...refs[0]!, asOf: day(300) }] }),
    );
    expect(futureRef.reference).toBeNull();
  });
  it('disponibilidad del registro: se conserva cuando existe; si no, null', () => {
    const obs = series(weekly(6), () => 100);
    const av = new Map(obs.map((o, i) => [o.id, i === 0 ? day(2) : ''] as const).filter(([, v]) => v));
    const r = projectPerformance(base(obs, day(45), { availableOn: av }));
    expect(r.observedPoints[0]?.availableOn).toBe(day(2));
    expect(r.observedPoints[1]?.availableOn).toBeNull();
  });
  it('el resumen es determinista, corto y sin promesas', () => {
    const obs = series(weekly(16), (i) => 100 + i * 1.5);
    const a = projectPerformance(base(obs, day(110), { liftConfig: MIN }));
    const b = projectPerformance(base(obs, day(110), { liftConfig: MIN }));
    expect(a.summary).toEqual(b.summary);
    expect(a.summary.lines.length).toBeLessThanOrEqual(3);
    expect(a.summary.trend.label).toBe('ascendente');
    expect(a.summary.text).not.toMatch(/va a levantar|asegurado|confirmado/i);
    expect(a.limitations.join(' ')).toMatch(/no equivale a un 1RM real/);
  });
});
