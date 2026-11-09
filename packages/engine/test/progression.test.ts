import { describe, expect, it } from 'vitest';
import { suggestProgression } from '../src/progression.js';

const plan = (n: number, reps: number, max: number | null, rpe: number | null) =>
  Array.from({ length: n }, () => ({ reps, repsMax: max, rpe }));

describe('progresión sugerida', () => {
  it('rango 8-10: 10-8-8 a 50 kg → misma carga, 9 reps en todas', () => {
    const s = suggestProgression(plan(3, 8, 10, 8), [
      { kg: 50, reps: 10, rpe: 8 },
      { kg: 50, reps: 8, rpe: 8.5 },
      { kg: 50, reps: 8, rpe: 9 },
    ]);
    expect(s.action).toBe('subir_reps');
    expect(s.sets).toEqual([9, 9, 9].map((reps) => ({ reps, kg: 50 })));
    expect(s.fatigueDrop).toBe(2);
    expect(s.e1rm).toBeGreaterThan(60);
  });
  it('rango 8-10: 3×10 en objetivo → sube la carga y vuelve a 8', () => {
    const s = suggestProgression(plan(3, 8, 10, 8), Array(3).fill({ kg: 50, reps: 10, rpe: 8 }));
    expect(s.action).toBe('subir_carga');
    expect(s.sets[0]).toEqual({ reps: 8, kg: 52.5 });
  });
  it('RPE muy por encima del objetivo → mantiene', () => {
    const s = suggestProgression(plan(3, 8, 10, 8), Array(3).fill({ kg: 50, reps: 9, rpe: 10 }));
    expect(s.action).toBe('mantener');
    expect(s.sets[0]).toEqual({ reps: 9, kg: 50 });
  });
  it('básico con reps fijas: la carga sale del 1RM estimado y la curva', () => {
    const s = suggestProgression(plan(3, 5, null, 7), Array(3).fill({ kg: 100, reps: 5, rpe: 6 }));
    expect(s.action).toBe('subir_carga');
    expect(s.sets[0]!.kg).toBeGreaterThan(100);
  });
  it('sin entreno previo: sin datos, sin inventar carga', () => {
    const s = suggestProgression(plan(3, 8, 10, 8), []);
    expect(s.action).toBe('sin_datos');
    expect(s.sets.every((x) => x.kg === null)).toBe(true);
  });
  it('sin RPE cargado usa el objetivo y lo avisa', () => {
    const s = suggestProgression(plan(3, 8, 10, 8), Array(3).fill({ kg: 50, reps: 9, rpe: null }));
    expect(s.rationale[0]).toMatch(/sin RPE/);
  });
});
