import { describe, expect, it } from 'vitest';
import { AVAILABILITY_MATRIX, METRIC_CATALOG, metricDefinition, sameScale } from '../src/catalog.js';
import { estimateCurve, estimatePrg } from '../src/e1rm-methods.js';
import { computeObservedMetrics } from '../src/metrics-observed.js';
import type { LoadKind, ObservedSet, SetType } from '../src/observed.js';
import {
  DEFAULT_PARAMS,
  PARAM_REGISTRY,
  buildParams,
  missingConfig,
  paramProvenance,
  stepFor,
  validateParams,
} from '../src/params.js';
import { computeRecords, recordFor } from '../src/records.js';
import type { StrengthReference } from '../src/references.js';

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
  setType: 'work' as SetType,
  kg,
  reps,
  rpe,
  loadKind: 'total' as LoadKind,
  plannedSetId: null,
  refKg: null,
  refSource: null,
  refAsOf: null,
  ...x,
});
const win = { from: '2026-03-01', to: '2026-03-14', cutoff: '2026-03-14', scope: { lift: 'SQ' as const } };

describe('e1RM: dos métodos separados, con y sin RPE', () => {
  it('por fórmulas de PRG coincide con la implementación de referencia (redondeo de JS)', () => {
    expect(estimatePrg(100, 5).value).toBe(115);
    expect(estimatePrg(140, 3).value).toBe(153);
    expect(estimatePrg(120, 8).value).toBe(149);
    expect(estimatePrg(80, 10).value).toBe(104);
    expect(estimatePrg(100, 2).value).toBe(106);
  });
  it('respeta el dominio: reps = 1 devuelve el peso; fuera de 2–10 no se extrapola', () => {
    expect(estimatePrg(180, 1).value).toBe(180);
    expect(estimatePrg(100, 11)).toMatchObject({ value: null, status: 'unavailable' });
    expect(estimatePrg(100, 0).status).toBe('unavailable');
  });
  it('advierte que sin conocer el esfuerzo una serie submáxima se subestima', () => {
    expect(estimatePrg(100, 5).warnings.join(' ')).toMatch(/subestima/);
  });
  it('por curva exige RPE real: nunca lo completa', () => {
    expect(estimateCurve(150, 5, null)).toMatchObject({ value: null, reason: 'sin RPE real registrado' });
    expect(estimateCurve(140, 3, 8).value).toBeCloseTo(162.22, 2);
    expect(estimateCurve(150, 16, 8).status).toBe('unavailable');
    expect(estimateCurve(150, 5, 8.25).status).toBe('unavailable');
  });
  it('los métodos tienen identificador y versión distintos', () => {
    expect(estimateCurve(140, 3, 8).method.id).not.toBe(estimatePrg(140, 3).method.id);
  });
});

describe('Un historial SIN RPE no apaga el análisis: se abstienen solo las métricas que lo requieren', () => {
  const sets = [
    o('2026-03-02', 150, 5),
    o('2026-03-02', 150, 5),
    o('2026-03-02', 150, 5),
    o('2026-03-09', 152.5, 5),
    o('2026-03-09', 100, 5, null, { setType: 'warmup' }),
  ];
  const m = computeObservedMetrics({ ...win, obs: sets });
  it('NL, series, tonelaje y frecuencia siguen disponibles', () => {
    expect(m.nl).toMatchObject({ status: 'available', value: 20 });
    expect(m.sets).toMatchObject({ status: 'available', value: 4 });
    expect(m.tonnage).toMatchObject({ status: 'available', value: 150 * 15 + 152.5 * 5 });
    expect(m.frequency?.value).toBeCloseTo(2 / 2, 5);
    expect(m.nl?.excluded.map((e) => e.reason).join(' ')).toMatch(/calentamientos/);
  });
  it('el e1RM por fórmulas está disponible y el de curva se abstiene con el motivo', () => {
    expect(m.e1rm_prg_formulas?.status).toBe('available');
    expect(m.e1rm_table_rpe).toMatchObject({ status: 'unavailable', value: null });
    expect(m.e1rm_table_rpe?.missing).toContain('RPE real');
    expect(m.si_rts_total?.status).toBe('unavailable');
  });
  it('cada resultado trae período, método, registros usados y corte', () => {
    expect(m.nl?.period).toMatchObject({
      from: '2026-03-01',
      to: '2026-03-14',
      days: 14,
      weeks: 2,
      partial: false,
    });
    expect(m.nl?.cutoff).toBe('2026-03-14');
    expect(m.nl?.method.id).toBe('sum-reps');
    expect(m.nl?.usedRecords.length).toBe(4);
  });
});

describe('Disponibilidad parcial', () => {
  it('con RPE solo en algunas series: e1RM y SI quedan parciales y se aclara', () => {
    const m = computeObservedMetrics({
      ...win,
      obs: [o('2026-03-02', 150, 5, 8), o('2026-03-02', 150, 5, null), o('2026-03-09', 152.5, 5, 8)],
    });
    expect(m.e1rm_table_rpe?.status).toBe('partial');
    expect(m.e1rm_table_rpe?.excluded.map((e) => e.reason).join(' ')).toMatch(/sin RPE real registrado/);
    expect(m.si_rts_total?.status).toBe('partial');
    expect(m.si_rts_total?.warnings.join(' ')).toMatch(/PARCIAL/);
  });
  it('no mezcla modelos de SI: cada uno nombra su escala y no se comparan', () => {
    const m = computeObservedMetrics({ ...win, obs: [o('2026-03-02', 150, 5, 8, { refKg: 180 })] });
    expect(m.si_rts_total?.unit).toMatch(/rts-aprox-v1/);
    expect(m.si_prg?.unit).toMatch(/prg-si-v1/);
    expect(m.si_efort_xl?.unit).toMatch(/efort-xl-v1/);
    expect(sameScale('si_rts_total', 'si_prg')).toBe(false);
    expect(sameScale('si_rts_total', 'si_rts_central')).toBe(true);
    expect(sameScale('e1rm_table_rpe', 'e1rm_prg_formulas')).toBe(false);
  });
  it('el SI de PRG no usa un RPE implícito: sin RPE real la serie se excluye', () => {
    const m = computeObservedMetrics({ ...win, obs: [o('2026-03-02', 150, 5, null, { refKg: 180 })] });
    expect(m.si_prg?.status).toBe('unavailable');
    expect(m.inol_prg?.status).toBe('available'); // INOL no requiere RPE
  });
});

describe('Tipos de carga: no se confunden', () => {
  it('mancuerna por lado, peso corporal y carga desconocida se excluyen del tonelaje con motivo', () => {
    const m = computeObservedMetrics({
      ...win,
      scope: {},
      obs: [
        o('2026-03-02', 100, 5),
        o('2026-03-02', 30, 10, null, { loadKind: 'per_side', exerciseName: 'Row (Dumbbell)', lift: null }),
        o('2026-03-02', null, 12, null, { loadKind: 'bodyweight', exerciseName: 'Pull Up', lift: null }),
        o('2026-03-02', 20, 8, null, { loadKind: 'unknown', lift: null }),
      ],
    });
    expect(m.tonnage).toMatchObject({ status: 'partial', value: 500 });
    const why = m.tonnage?.excluded.map((e) => e.reason).join(' | ');
    expect(why).toMatch(/por lado/);
    expect(why).toMatch(/peso corporal/);
    expect(why).toMatch(/desconocido/);
    expect(m.nl?.value).toBe(5 + 10 + 12 + 8); // NL sí cuenta todas las repeticiones
  });
});

describe('Referencia de fuerza fechada (separada del e1RM)', () => {
  const refs: StrengthReference[] = [
    {
      id: 'r1',
      exerciseName: 'Squat (Barbell)',
      kg: 180,
      source: 'test',
      asOf: '2026-01-10',
      version: 'v1',
      note: '',
    },
    {
      id: 'r2',
      exerciseName: 'Squat (Barbell)',
      kg: 190,
      source: 'competencia',
      asOf: '2026-03-10',
      version: 'v1',
      note: '',
    },
  ];
  const sets = [o('2026-03-02', 144, 5), o('2026-03-12', 144, 5)];
  it('sin referencia no hay intensidad relativa (y no se usa una futura)', () => {
    expect(computeObservedMetrics({ ...win, obs: sets }).intensity_rel).toMatchObject({
      status: 'unavailable',
      value: null,
    });
    const early = computeObservedMetrics({
      ...win,
      to: '2026-03-05',
      cutoff: '2026-03-05',
      obs: sets.slice(0, 1),
      references: [refs[1]!],
    });
    expect(early.intensity_rel?.status).toBe('unavailable');
  });
  it('el cálculo original usa la referencia vigente a la fecha de cada serie y la identifica', () => {
    const m = computeObservedMetrics({ ...win, obs: sets, references: refs });
    expect(m.intensity_rel?.value).toBeCloseTo((100 * 144) / 180 / 2 + (100 * 144) / 190 / 2, 6);
    expect(m.intensity_rel?.warnings.join(' ')).toMatch(/varias referencias/);
  });
  it('un recálculo retrospectivo se distingue del original y no lo reescribe', () => {
    const orig = computeObservedMetrics({ ...win, obs: sets, references: refs });
    const retro = computeObservedMetrics({
      ...win,
      obs: sets,
      references: refs,
      referenceMode: 'retrospective',
    });
    expect(retro.intensity_rel?.value).toBeCloseTo((100 * 144) / 190, 6);
    expect(retro.intensity_rel?.method.version).toBe('v1:retrospectivo');
    expect(retro.intensity_rel?.warnings.join(' ')).toMatch(/RETROSPECTIVO/);
    expect(orig.intensity_rel?.value).not.toBeCloseTo(retro.intensity_rel?.value as number, 3);
    expect(retro.intensity_rel?.reference).toMatchObject({ source: 'competencia', asOf: '2026-03-10' });
  });
  it('la referencia explícita de la serie (plan) tiene procedencia declarada', () => {
    const m = computeObservedMetrics({
      ...win,
      obs: [o('2026-03-02', 144, 5, 8, { refKg: 180, refSource: 'plan', refAsOf: '2026-01-10' })],
    });
    expect(m.intensity_rel?.reference).toMatchObject({ kg: 180, source: 'plan', asOf: '2026-01-10' });
  });
});

describe('Récords tipados', () => {
  const sets = [
    o('2026-03-01', 180, 1),
    o('2026-03-02', 150, 5, 8),
    o('2026-03-03', 140, 8, 9),
    o('2026-03-04', 160, 3, null, { setType: 'dropset' }),
    o('2026-03-05', 100, 5, null, { setType: 'warmup' }),
    o('2026-03-06', 200, 1, null, { variantKey: 'pausa', exerciseName: 'Squat pausa' }),
  ];
  const r = computeRecords(sets, '2026-03-31');
  it('distingue single, carga para reps, reps con carga y marca a un RPE', () => {
    expect(recordFor(r, { type: 'single', exercise: 'Squat (Barbell)', key: 'reps=1' })?.value).toBe(180);
    expect(recordFor(r, { type: 'load_for_reps', exercise: 'Squat (Barbell)', key: 'reps=5' })?.value).toBe(
      150,
    );
    expect(recordFor(r, { type: 'load_for_reps', exercise: 'Squat (Barbell)', key: 'reps=8' })?.value).toBe(
      140,
    );
    expect(recordFor(r, { type: 'reps_at_load', exercise: 'Squat (Barbell)', key: 'kg=140' })?.value).toBe(8);
    expect(
      recordFor(r, { type: 'rpe_comparable', exercise: 'Squat (Barbell)', key: 'reps=5@rpe=8' })?.value,
    ).toBe(150);
  });
  it('excluye calentamientos y dropsets', () => {
    // el único set de 3 reps era un dropset: no genera ningún récord
    expect(recordFor(r, { type: 'load_for_reps', exercise: 'Squat (Barbell)', key: 'reps=3' })).toBeNull();
    expect(r.some((x) => x.value === 160)).toBe(false);
    expect(r.some((x) => x.setRef.id === sets[4]!.id)).toBe(false);
  });
  it('un mejor e1RM NO es un récord real y los métodos van separados', () => {
    const best = r.filter((x) => x.type === 'best_e1rm' && x.exercise === 'Squat (Barbell)');
    expect(best.length).toBeGreaterThanOrEqual(2);
    expect(best.every((x) => x.isRealPR === false && x.method !== null)).toBe(true);
    expect(new Set(best.map((x) => x.method?.id)).size).toBe(best.length);
    expect(r.filter((x) => x.type !== 'best_e1rm').every((x) => x.isRealPR)).toBe(true);
  });
  it('las variantes no son marcas equivalentes: récords separados por ejercicio+variante', () => {
    expect(recordFor(r, { type: 'single', exercise: 'Squat pausa', key: 'reps=1' })?.value).toBe(200);
    expect(recordFor(r, { type: 'single', exercise: 'Squat (Barbell)', key: 'reps=1' })?.value).toBe(180);
  });
  it('no usa datos posteriores al corte', () => {
    expect(computeRecords(sets, '2026-03-01').some((x) => x.value === 200)).toBe(false);
  });
});

describe('Catálogo y matriz de disponibilidad', () => {
  it('toda definición tiene los campos exigidos', () => {
    for (const d of METRIC_CATALOG) {
      expect(d.id && d.name && d.definition && d.method && d.version && d.reference, d.id).toBeTruthy();
      expect(['recuperado', 'documentado', 'aproximado', 'propuesta', 'desconocido']).toContain(d.provenance);
      expect(d.doesNotConclude.length, `${d.id} debe decir qué no permite concluir`).toBeGreaterThan(0);
    }
  });
  it('cada métrica del catálogo y cada regla tienen una fila en la matriz, y viceversa', () => {
    const ids = new Set(AVAILABILITY_MATRIX.map((a) => a.id));
    for (const d of METRIC_CATALOG) expect(ids.has(d.id), `falta fila para ${d.id}`).toBe(true);
    for (const a of AVAILABILITY_MATRIX.filter((x) => x.kind === 'metrica'))
      expect(metricDefinition(a.id), a.id).toBeDefined();
    for (const rule of [
      'B-DOLOR',
      'B-TECNICA',
      'R-PROGRESS',
      'R-LOAD',
      'R-END',
      'R-PR',
      'R-EXPRESSION-A',
      'R-EXPRESSION-B',
      'R-VOLUME',
      'R-FREQUENCY',
    ])
      expect(ids.has(rule), rule).toBe(true);
    for (const a of AVAILABILITY_MATRIX) expect(a.abstention.length).toBeGreaterThan(5);
  });
  it('CTL/ATL queda marcado como evidencia contradictoria y no implementado; TRAC como desconocido', () => {
    expect(metricDefinition('ctl_atl')?.implementation).toBe('disputada_no_implementada');
    expect(metricDefinition('trac')?.provenance).toBe('desconocido');
  });
  it('las aproximaciones se rotulan como tales (no son fórmulas exactas)', () => {
    expect(metricDefinition('si_rts_total')?.provenance).toBe('aproximado');
    expect(metricDefinition('e1rm_table_rpe')?.provenance).toBe('recuperado');
    expect(metricDefinition('muscle_sets_equivalent')?.provenance).toBe('propuesta');
  });
});

describe('Registro de parámetros', () => {
  it('cada parámetro global del registro existe en los defaults efectivos', () => {
    for (const d of PARAM_REGISTRY.filter((x) => x.scopes.includes('global') && x.default !== null))
      expect(DEFAULT_PARAMS, d.id).toHaveProperty(d.id);
  });
  it('cada parámetro numérico/booleano de los defaults está en el registro (y viceversa)', () => {
    const ids = new Set(PARAM_REGISTRY.map((d) => d.id));
    for (const k of Object.keys(DEFAULT_PARAMS).filter((x) => x !== 'perLift'))
      expect(ids.has(k), `falta ${k} en el registro`).toBe(true);
    for (const d of PARAM_REGISTRY.filter((x) => x.default !== null && x.scopes.includes('global')))
      expect(DEFAULT_PARAMS, d.id).toHaveProperty(d.id);
    for (const v of Object.values(DEFAULT_PARAMS).filter((x) => typeof x !== 'object'))
      expect(v).not.toBeUndefined();
  });
  it('separa paso de carga, cambio mínimo y sensibilidad del método', () => {
    const concept = (id: string) => PARAM_REGISTRY.find((d) => d.id === id)?.concept;
    expect(concept('stepKg')).toBe('paso_de_carga');
    expect(concept('minChangePct')).toBe('cambio_minimo');
    expect(concept('rpeSensitivity')).toBe('sensibilidad_metodo');
  });
  it('precedencia lift > atleta > default', () => {
    const p = buildParams({ stepKg: 2, perLift: { SQ: { stepKg: 5 } } });
    expect(stepFor(p, 'SQ')).toBe(5);
    expect(stepFor(p, 'BP')).toBe(2);
    expect(stepFor(buildParams(), 'DL')).toBe(2.5);
    expect(paramProvenance({ stepKg: 2, perLift: { SQ: { stepKg: 5 } } }).stepKg).toEqual({ lift: ['SQ'] });
    expect(paramProvenance({}).stepKg).toBe('default');
  });
  it('valida rangos, enteros y alcance', () => {
    expect(validateParams({ windowDays: 3 }).map((i) => i.id)).toContain('windowDays');
    expect(
      validateParams({ nExposures: 2.5 })
        .map((i) => i.message)
        .join(),
    ).toMatch(/entero/);
    expect(validateParams({ perLift: { SQ: { minChangePct: -1 } } })).toHaveLength(1);
    expect(validateParams({ stepKg: 2.5, perLift: { SQ: { stepKg: 5 } } })).toHaveLength(0);
    expect(validateParams({ perLift: { SQ: { loadLimitKg: 300 } } })).toHaveLength(0);
    expect(validateParams({ minChangeKg: 2 } as never)).toHaveLength(0); // athlete-scope permitido
    expect(
      validateParams({ prReps: 5 } as never)
        .map((i) => i.message)
        .join(),
    ).toMatch(/nivel athlete/);
  });
  it('si falta un umbral esencial informa qué interpretación queda suspendida, sin bloquear lo independiente', () => {
    const miss = missingConfig(buildParams({ perLift: { SQ: { minChangePct: 1.5 } } }));
    expect(miss.map((x) => x.lift).sort()).toEqual(['BP', 'DL']);
    expect(miss[0]?.suspends.join(' ')).toMatch(/R-PROGRESS/);
    expect(miss[0]?.independentMetricsUnaffected).toBe(true);
  });
});
