import { describe, expect, it } from 'vitest';
import { prescribedReps, repsMaxOf, validateRepsRange } from './prescription';
describe('Rangos de repeticiones del protocolo', () => {
  it('distingue rango, objetivo fijo y dato ausente sin modificar el protocolo', () => {
    const p = { loadMode: 'kg', repsMax: 10 };
    expect(prescribedReps(8, p)).toBe('8–10');
    expect(prescribedReps(8, null)).toBe('8');
    expect(prescribedReps(8, { repsMax: 8 })).toBe('8');
    expect(prescribedReps(undefined, p)).toBe('—');
    expect(p.repsMax).toBe(10);
  });
  it('admite limpiar el tope y rechaza un rango invertido', () => {
    expect(validateRepsRange('8', '')).toBe('');
    expect(validateRepsRange('8', '10')).toBe('');
    expect(validateRepsRange('10', '8')).not.toBe('');
    expect(repsMaxOf({ repsMax: null })).toBeNull();
    expect(repsMaxOf({ repsMax: '10' })).toBeNull();
  });
});
