import { describe, expect, it } from 'vitest';
import {
  ProgramError,
  applyTemplate,
  changeProtocol,
  duplicateSession,
  moveSession,
  plannedAvailability,
  previewChange,
  repeatStructure,
  repeatWeek,
  resolvePlannedKg,
  saveTemplate,
  selectSets,
  withDerivedLoads,
} from '../src/program.js';
import type { PlannedSet, Protocol } from '../src/types.js';
import { Fixture } from './helpers.js';

const proto = (p: Partial<Protocol>): Protocol => ({
  loadMode: 'kg',
  pct: null,
  capKg: null,
  segment: 'work',
  tempo: null,
  pauseSec: null,
  instructions: null,
  ...p,
});
/** Una semana de bloque B1: dos sesiones (squat día 1 y bench día 3), 3 series cada una. */
function plan(): PlannedSet[] {
  const fx = new Fixture();
  fx.session(
    '2026-03-02',
    [
      { reps: 5, kg: 150, rpe: null, target: 8, plannedKg: 150 },
      { reps: 5, kg: 150, rpe: null, target: 8, plannedKg: 150 },
      { reps: 5, kg: 150, rpe: null, target: 8, plannedKg: 150 },
    ],
    { key: 'B1-w1-d1', block: 'B1', week: 1, day: 1, exposure: 'squat-primaria', refKg: 180 },
  );
  fx.session(
    '2026-03-04',
    [
      { reps: 5, kg: 100, rpe: null, target: 8, plannedKg: 100 },
      { reps: 5, kg: 100, rpe: null, target: 8, plannedKg: 100 },
    ],
    {
      key: 'B1-w1-d3',
      block: 'B1',
      week: 1,
      day: 3,
      exposure: 'banca-primaria',
      exercise: 'Bench comp',
      lift: 'BP',
      refKg: 120,
    },
  );
  return fx.planned.map((s) => ({ ...s, status: undefined }) as unknown as PlannedSet);
}
const ids = (xs: PlannedSet[]) => xs.map((x) => x.id);

describe('Protocolos: carga prevista calculable o no disponible (nunca estimada)', () => {
  const base = plan()[0] as PlannedSet;
  it('carga fija, porcentaje de la referencia y RPE por tabla', () => {
    expect(resolvePlannedKg(base)).toEqual({ kg: 150, source: 'fixed', missing: [] });
    expect(
      resolvePlannedKg({ ...base, plannedKg: null, protocol: proto({ loadMode: 'pct', pct: 80 }) }),
    ).toMatchObject({ kg: 144, source: 'derived' });
    const rpe = resolvePlannedKg({
      ...base,
      plannedKg: null,
      targetRpe: 8,
      protocol: proto({ loadMode: 'rpe' }),
    });
    expect(rpe.kg).toBeCloseTo(180 * 0.811, 6);
    expect(
      resolvePlannedKg({ ...base, plannedKg: null, targetRpe: 8, protocol: proto({ loadMode: 'rpe' }) }, 2.5)
        .kg,
    ).toBe(145); // redondeo hacia abajo al paso
  });
  it('RPE con tope usa el menor entre la carga por RPE y el tope', () => {
    expect(
      resolvePlannedKg({
        ...base,
        plannedKg: null,
        targetRpe: 8,
        protocol: proto({ loadMode: 'rpe_cap', capKg: 140 }),
      }).kg,
    ).toBe(140);
    expect(
      resolvePlannedKg({
        ...base,
        plannedKg: null,
        targetRpe: 8,
        protocol: proto({ loadMode: 'rpe_cap', capKg: 200 }),
      }).kg,
    ).toBeCloseTo(180 * 0.811, 6);
  });
  it('sin referencia, sin RPE o fuera de la tabla devuelve null con el motivo', () => {
    expect(
      resolvePlannedKg({
        ...base,
        plannedKg: null,
        refKg: null,
        protocol: proto({ loadMode: 'pct', pct: 80 }),
      }),
    ).toMatchObject({ kg: null, missing: ['referencia de fuerza'] });
    expect(
      resolvePlannedKg({ ...base, plannedKg: null, targetRpe: null, protocol: proto({ loadMode: 'rpe' }) })
        .missing,
    ).toContain('RPE objetivo');
    expect(
      resolvePlannedKg({
        ...base,
        plannedKg: null,
        reps: 20,
        protocol: proto({ loadMode: 'rpe' }),
      }).missing.join(),
    ).toMatch(/dominio de la tabla/);
    expect(
      resolvePlannedKg({
        ...base,
        plannedKg: null,
        targetRpe: 8,
        protocol: proto({ loadMode: 'rpe_cap', capKg: null }),
      }).missing,
    ).toContain('tope de carga');
  });
  it('las instrucciones libres (tempo, pausa, texto) nunca alimentan el cálculo', () => {
    const a = resolvePlannedKg({
      ...base,
      plannedKg: null,
      protocol: proto({
        loadMode: 'pct',
        pct: 80,
        instructions: 'subir 5 kg si va fácil',
        tempo: '3-1-0',
        pauseSec: 2,
      }),
    });
    const b = resolvePlannedKg({ ...base, plannedKg: null, protocol: proto({ loadMode: 'pct', pct: 80 }) });
    expect(a).toEqual(b);
  });
  it('withDerivedLoads marca lo derivado y no pisa una carga fija', () => {
    const [d] = withDerivedLoads([
      { ...base, plannedKg: null, plannedKgSource: null, protocol: proto({ loadMode: 'pct', pct: 80 }) },
    ]);
    expect(d).toMatchObject({ plannedKg: 144, plannedKgSource: 'derived' });
    expect(withDerivedLoads([base])[0]).toEqual(base);
  });
});

describe('Duplicar y repetir programación', () => {
  it('duplicar una sesión crea instancias nuevas con linaje, conserva la identidad y no toca el original', () => {
    const p = plan();
    const before = JSON.stringify(p);
    const r = duplicateSession(p, {
      sessionKey: 'B1-w1-d1',
      newSessionKey: 'B1-w1-d5',
      plannedDate: '2026-03-06',
      dayNo: 5,
      slotKey: 'squat-comp|D5',
    });
    expect(ids(r.added)).toEqual(['B1-w1-d5-1', 'B1-w1-d5-2', 'B1-w1-d5-3']);
    expect(
      r.added.every(
        (s) =>
          s.exposureId === 'squat-primaria' &&
          s.sessionKey === 'B1-w1-d5' &&
          s.dayNo === 5 &&
          s.plannedDate === '2026-03-06',
      ),
    ).toBe(true);
    expect(r.added.map((s) => s.copiedFrom)).toEqual(ids(p.filter((s) => s.sessionKey === 'B1-w1-d1')));
    expect(new Set(r.added.map((s) => s.id)).size).toBe(3);
    expect(JSON.stringify(p)).toBe(before); // el original no cambió
  });
  it('no copia resultados, cuestionarios ni estados de completado (solo hay prescripción)', () => {
    const r = duplicateSession(plan(), {
      sessionKey: 'B1-w1-d1',
      newSessionKey: 'B1-w1-d5',
      plannedDate: '2026-03-06',
    });
    for (const s of r.added) {
      expect(Object.keys(s)).not.toEqual(
        expect.arrayContaining(['kg', 'rpe', 'status', 'performedOn', 'pain']),
      );
    }
  });
  it('rechaza una sesión inexistente o un identificador ya usado', () => {
    expect(() =>
      duplicateSession(plan(), { sessionKey: 'nope', newSessionKey: 'x', plannedDate: '2026-03-06' }),
    ).toThrow(ProgramError);
    expect(() =>
      duplicateSession(plan(), {
        sessionKey: 'B1-w1-d1',
        newSessionKey: 'B1-w1-d3',
        plannedDate: '2026-03-06',
      }),
    ).toThrow(/Ya existe la sesión/);
  });
  it('crea la semana siguiente desde la anterior: fechas +7, semana +1, mismas identidades, ids nuevos', () => {
    const p = plan();
    const r = repeatWeek(p, { blockKey: 'B1', sourceWeek: 1, targetWeek: 2 });
    expect(r.added).toHaveLength(5);
    expect(r.added.every((s) => s.weekNo === 2)).toBe(true);
    expect([...new Set(r.added.map((s) => s.plannedDate))].sort()).toEqual(['2026-03-09', '2026-03-11']);
    expect(new Set(r.added.map((s) => s.exposureId))).toEqual(new Set(['squat-primaria', 'banca-primaria']));
    expect(ids(r.added).some((i) => ids(p).includes(i))).toBe(false);
    expect(r.overwrites).toHaveLength(0);
  });
  it('no sobrescribe en silencio: si el destino ya tiene series falla salvo confirmación explícita', () => {
    const p = plan();
    const w2 = repeatWeek(p, { blockKey: 'B1', sourceWeek: 1, targetWeek: 2 }).added;
    const both = [...p, ...w2];
    expect(() => repeatWeek(both, { blockKey: 'B1', sourceWeek: 1, targetWeek: 2 })).toThrow(
      /no se sobrescribe/,
    );
    const again = repeatWeek(both, { blockKey: 'B1', sourceWeek: 1, targetWeek: 2, replaceExisting: true });
    expect(again.overwrites).toHaveLength(5);
  });
  it('repetir la estructura solo en semanas explícitas y sin tocar las demás', () => {
    const p = plan();
    const r = repeatStructure(p, { blockKey: 'B1', sourceWeek: 1, targetWeeks: [3, 5] });
    expect([...new Set(r.added.map((s) => s.weekNo))].sort()).toEqual([3, 5]);
    expect(r.added).toHaveLength(10);
    expect([...new Set(r.added.map((s) => s.plannedDate))].sort()).toEqual([
      '2026-03-16',
      '2026-03-18',
      '2026-03-30',
      '2026-04-01',
    ]);
    expect(() => repeatStructure(p, { blockKey: 'B1', sourceWeek: 1, targetWeeks: [] })).toThrow(
      /semanas de destino/,
    );
  });
  it('la copia es determinista: aplicar dos veces la misma operación da los mismos ids', () => {
    const a = repeatWeek(plan(), { blockKey: 'B1', sourceWeek: 1, targetWeek: 2 });
    const b = repeatWeek(plan(), { blockKey: 'B1', sourceWeek: 1, targetWeek: 2 });
    expect(ids(a.added)).toEqual(ids(b.added));
  });
});

describe('Plantillas', () => {
  it('guardar y aplicar: sin fechas ni ids de instancia, con destino explícito y protegido', () => {
    const p = plan();
    const t = saveTemplate(p, { name: 'Fuerza 2 días', blockKey: 'B1', weekNo: 1 });
    expect(t.sessions.map((s) => s.offsetDays)).toEqual([0, 2]);
    expect(JSON.stringify(t)).not.toMatch(/2026-03/);
    expect(t.sets.every((s) => !('id' in s) && !('sessionKey' in s))).toBe(true);
    const r = applyTemplate(p, t, { blockKey: 'B2', weekNo: 1, startDate: '2026-04-06', familyKey: 'F2' });
    expect(r.added).toHaveLength(5);
    expect([...new Set(r.added.map((s) => s.plannedDate))].sort()).toEqual(['2026-04-06', '2026-04-08']);
    expect(r.added.every((s) => s.blockKey === 'B2' && s.familyKey === 'F2' && s.copiedFrom === null)).toBe(
      true,
    );
    expect(new Set(r.added.map((s) => s.exposureId))).toEqual(new Set(['squat-primaria', 'banca-primaria']));
    expect(() =>
      applyTemplate([...p, ...r.added], t, { blockKey: 'B2', weekNo: 1, startDate: '2026-04-06' }),
    ).toThrow(/no se sobrescribe/);
  });
});

describe('Cambiar protocolos en un conjunto explícito de destinos', () => {
  it('modifica solo las series seleccionadas', () => {
    const p = plan();
    const r = changeProtocol(p, { sessionKeys: ['B1-w1-d1'] }, { reps: 3, targetRpe: 7, plannedKg: 160 });
    expect(r.changed).toHaveLength(3);
    expect(
      r.sets
        .filter((s) => s.sessionKey === 'B1-w1-d1')
        .every(
          (s) => s.reps === 3 && s.targetRpe === 7 && s.plannedKg === 160 && s.plannedKgSource === 'fixed',
        ),
    ).toBe(true);
    expect(JSON.stringify(r.sets.filter((s) => s.sessionKey === 'B1-w1-d3'))).toBe(
      JSON.stringify(p.filter((s) => s.sessionKey === 'B1-w1-d3')),
    );
  });
  it('una selección vacía o sin coincidencias es un error: no cambia otras semanas por defecto', () => {
    expect(() => changeProtocol(plan(), {}, { reps: 3 })).toThrow(/selección explícita/);
    expect(() => changeProtocol(plan(), { sessionKeys: ['zzz'] }, { reps: 3 })).toThrow(/ninguna serie/);
    expect(() => selectSets(plan(), {})).toThrow(ProgramError);
  });
  it('combina campos de protocolo (top set con tope, tempo y pausa) sin convertir texto libre en cálculo', () => {
    const r = changeProtocol(
      plan(),
      { exposureIds: ['squat-primaria'] },
      {
        protocol: {
          loadMode: 'rpe_cap',
          capKg: 150,
          segment: 'top',
          tempo: '2-0-1',
          pauseSec: 3,
          instructions: 'cuidar la profundidad',
        },
      },
    );
    expect(r.changed[0]!.protocol).toMatchObject({
      loadMode: 'rpe_cap',
      capKg: 150,
      segment: 'top',
      tempo: '2-0-1',
      pauseSec: 3,
      instructions: 'cuidar la profundidad',
    });
  });
});

describe('Mover una sesión: la ubicación cambia, la identidad no', () => {
  it('puede pasar la sesión a otra semana (weekNo) sin tocar el resto', () => {
    const p = plan();
    const m = moveSession(p, { sessionKey: 'B1-w1-d1', plannedDate: '2026-02-24', weekNo: 2 });
    expect(
      m
        .filter((s) => s.sessionKey === 'B1-w1-d1')
        .every((s) => s.weekNo === 2 && s.plannedDate === '2026-02-24'),
    ).toBe(true);
    expect(m.filter((s) => s.sessionKey !== 'B1-w1-d1').map((s) => s.weekNo)).toEqual(
      p.filter((s) => s.sessionKey !== 'B1-w1-d1').map((s) => s.weekNo),
    );
  });
  it('conserva ids y exposureId; cambia fecha, día y slot', () => {
    const p = plan();
    const m = moveSession(p, {
      sessionKey: 'B1-w1-d1',
      plannedDate: '2026-03-03',
      dayNo: 2,
      slotKey: 'squat-comp|D2',
    });
    const a = m.filter((s) => s.sessionKey === 'B1-w1-d1');
    expect(
      a.every(
        (s) =>
          s.plannedDate === '2026-03-03' &&
          s.dayNo === 2 &&
          s.slotKey === 'squat-comp|D2' &&
          s.exposureId === 'squat-primaria',
      ),
    ).toBe(true);
    expect(ids(m)).toEqual(ids(p));
    expect(() => moveSession(p, { sessionKey: 'nope', plannedDate: '2026-03-03' })).toThrow(ProgramError);
  });
});

describe('Vista previa de diferencias y métricas previstas', () => {
  it('clasifica el cambio como el historial automático y no guarda nada', () => {
    const p = plan();
    const { sets } = changeProtocol(p, { sessionKeys: ['B1-w1-d3'] }, { reps: 8 });
    const pv = previewChange(p, sets);
    expect(pv.event.changes[0]).toMatchObject({ lift: 'BP', classification: 'volumen_aumentado' });
    expect(pv.addedSets).toBe(0);
  });
  it('informa disponibilidad parcial y el motivo si faltan carga, referencia o RPE objetivo', () => {
    const p = plan().map((s) =>
      s.sessionKey === 'B1-w1-d3' ? { ...s, plannedKg: null, targetRpe: null, refKg: null } : s,
    );
    const av = plannedAvailability(p);
    const bp = av.find((a) => a.lift === 'BP')!;
    expect(bp.metrics.find((m) => m.id === 'tonnage')).toMatchObject({ status: 'unavailable' });
    expect(bp.metrics.find((m) => m.id === 'si_rts_total')!.missing.join()).toMatch(
      /no se completa con supuestos/,
    );
    const sq = av.find((a) => a.lift === 'SQ')!;
    expect(sq.metrics.every((m) => m.status === 'available')).toBe(true);
    const mixed = plannedAvailability(plan().map((s, i) => (i === 0 ? { ...s, plannedKg: null } : s)));
    expect(mixed.find((a) => a.lift === 'SQ')!.metrics.find((m) => m.id === 'tonnage')!.status).toBe(
      'partial',
    );
  });
});
