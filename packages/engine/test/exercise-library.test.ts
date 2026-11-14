import { describe, expect, it } from 'vitest';
import { FIXED_EXERCISES, fixedItems } from '../src/exercise-library.js';

describe('biblioteca fija de ejercicios', () => {
  it('no repite nombres y cada ejercicio tiene músculos y patrón (si no, el análisis lo dejaría sin mapear)', () => {
    const names = FIXED_EXERCISES.map((x) => x.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const sinMapa = fixedItems()
      .filter((x) => !x.muscles || !x.pattern)
      .map((x) => x.name);
    expect(sinMapa).toEqual([]);
  });
  it('las variantes de competencia declaran su movimiento', () => {
    const f = fixedItems();
    expect(f.find((x) => x.name === 'Sentadilla competencia')?.lift).toBe('SQ');
    expect(f.find((x) => x.name === 'Press banca competencia')?.lift).toBe('BP');
    expect(f.find((x) => x.name === 'Peso muerto sumo')?.lift).toBe('DL');
  });
});
