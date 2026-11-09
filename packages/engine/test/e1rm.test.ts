import { describe, expect, it } from 'vitest';
import { e1rm, pctFromTable } from '../src/e1rm.js';

describe('e1RM por tabla [recuperado]', () => {
  it('fixtures del plan de pruebas (curva 0,863 / 0,892)', () => {
    expect(pctFromTable(3, 8)).toBe(0.863);
    expect(e1rm(140, 3, 8)).toBeCloseTo(162.22, 2);
    expect(e1rm(145, 3, 8)).toBeCloseTo(168.02, 2);
    expect(pctFromTable(3, 9)).toBe(0.892);
    expect(e1rm(145, 3, 9)).toBeCloseTo(162.56, 2);
  });
  it('misma carga con más RPE no es mejora (caso 4)', () => {
    expect(e1rm(145, 3, 9) as number).toBeLessThan(e1rm(145, 3, 8) as number);
  });
  it('fuera de dominio devuelve null; no se inventa', () => {
    expect(e1rm(100, 16, 8)).toBeNull();
    expect(e1rm(100, 3, 8.25)).toBeNull();
    expect(e1rm(0, 3, 8)).toBeNull();
    expect(pctFromTable(0, 8)).toBeNull();
  });
  it('reps 1 @ RPE 10 es 100 %', () => {
    expect(pctFromTable(1, 10)).toBe(1);
  });
});
