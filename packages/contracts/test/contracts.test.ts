import { describe, expect, it } from 'vitest';
import { SI_MODEL as ENGINE_SI } from '@coaching/engine';
import { SI_MODEL, checkInSchema, compareQuerySchema, importPlanSchema, paramsSchema } from '../src/index.js';

describe('contracts', () => {
  it('el nombre del modelo de SI de la UI coincide con el del motor', () => {
    expect(SI_MODEL).toBe(ENGINE_SI);
  });
  it('valida fechas, escalas y enums de entrada', () => {
    expect(
      checkInSchema.safeParse({ date: '2026-03-10', sleep: 5, energy: 5, motivation: 5, stress: 5, pain: 5 })
        .success,
    ).toBe(true);
    expect(
      checkInSchema.safeParse({ date: '10/03/2026', sleep: 5, energy: 5, motivation: 5, stress: 5, pain: 5 })
        .success,
    ).toBe(false);
    expect(
      checkInSchema.safeParse({ date: '2026-03-10', sleep: 11, energy: 5, motivation: 5, stress: 5, pain: 5 })
        .success,
    ).toBe(false);
    expect(compareQuerySchema.safeParse({ lift: 'XX', a: 'a', b: 'b' }).success).toBe(false);
    expect(compareQuerySchema.parse({ lift: 'ALL', a: 'a', b: 'b' })).toMatchObject({
      universe: 'planned',
      scope: 'shared',
    });
  });
  it('un plan vacío o con un single @RPE fuera de rango se rechaza; los campos de bloque son opcionales', () => {
    const set = {
      id: 's',
      sessionKey: 'k',
      slotKey: 'l',
      exerciseName: 'e',
      lift: 'SQ',
      plannedDate: '2026-03-02',
      setNo: 1,
      reps: 5,
      targetRpe: 8,
      plannedKg: null,
    };
    expect(importPlanSchema.safeParse({ sets: [] }).success).toBe(false);
    expect(importPlanSchema.safeParse({ sets: [{ ...set, targetRpe: 11 }] }).success).toBe(false);
    expect(importPlanSchema.parse({ sets: [set] })).toMatchObject({ status: 'aplicado', replace: false });
  });
  it('los parámetros aceptan el single máximo solo como booleano explícito', () => {
    expect(paramsSchema.safeParse({ allowSingleMax: true }).success).toBe(true);
    expect(paramsSchema.safeParse({ allowSingleMax: 'si' }).success).toBe(false);
  });
});
