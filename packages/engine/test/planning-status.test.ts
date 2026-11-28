import { describe, expect, it } from 'vitest';
import { planningStatus } from '../src/planning-status.js';

const day = (date: string, blockKey = 'b1') => ({ blockKey, date });
// 2026-11-27 es viernes: semana 23/11–29/11, siguiente 30/11–06/12
const TODAY = '2026-11-27';

describe('estado de planificación', () => {
  it('usa semanas de lunes a domingo, también si hoy es lunes o domingo', () => {
    for (const today of ['2026-11-23', TODAY, '2026-11-29']) {
      const s = planningStatus([], [], today);
      expect(s.currentWeek).toEqual({ from: '2026-11-23', to: '2026-11-29' });
      expect(s.nextWeek).toEqual({ from: '2026-11-30', to: '2026-12-06' });
    }
  });
  it('sin plan: nada cargado y ningún bloque por terminar', () => {
    expect(planningStatus([], [], TODAY)).toMatchObject({
      hasCurrent: false,
      hasNext: false,
      plannedUntil: null,
      endingBlocks: [],
    });
  });
  it('con la semana siguiente cargada del mismo bloque no está terminando', () => {
    const s = planningStatus([day('2026-11-24'), day('2026-12-06')], [], TODAY);
    expect(s).toMatchObject({ hasCurrent: true, hasNext: true, endingBlocks: [] });
  });
  it('avisa el fin de bloque aunque el bloque siguiente ya esté cargado', () => {
    const s = planningStatus([day('2026-11-24'), day('2026-11-30', 'b2')], [], TODAY);
    expect(s.hasNext).toBe(true);
    expect(s.endingBlocks).toEqual([{ blockKey: 'b1', endDate: '2026-11-24' }]);
  });
  it('un fin declarado posterior evita el aviso', () => {
    const s = planningStatus([day('2026-11-24')], [{ blockKey: 'b1', endDate: '2026-12-13' }], TODAY);
    expect(s).toMatchObject({ hasNext: false, endingBlocks: [] });
  });
  it('un bloque ya terminado antes de esta semana no cuenta', () => {
    const s = planningStatus([day('2026-11-20')], [], TODAY);
    expect(s).toMatchObject({ hasCurrent: false, plannedUntil: '2026-11-20', endingBlocks: [] });
  });
});
