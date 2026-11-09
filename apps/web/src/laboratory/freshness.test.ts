import { afterEach, describe, it, expect, vi } from 'vitest';
import { pendingEvaluation, trackWrite } from './freshness';
afterEach(() => vi.unstubAllGlobals());
function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  return values;
}
describe('datos guardados y evaluación son estados distintos', () => {
  it('un registro guardado queda pendiente hasta ejecutar evaluación, incluso al releer el estado', () => {
    storage();
    trackWrite('/api/athletes/a/sets', { sets: [] });
    expect(pendingEvaluation('a')).not.toBeNull();
    expect(pendingEvaluation('b')).toBeNull();
    trackWrite('/api/athletes/a/evaluate', { cutoff: '2026-11-01' });
    expect(pendingEvaluation('a')).toBeNull();
  });
  it('un preview o borrador no invalida una evaluación pero publicar sí', () => {
    storage();
    trackWrite('/api/athletes/a/program', { mode: 'preview' });
    trackWrite('/api/athletes/a/program', { mode: 'draft' });
    expect(pendingEvaluation('a')).toBeNull();
    trackWrite('/api/athletes/a/program', { mode: 'apply' });
    expect(pendingEvaluation('a')).not.toBeNull();
  });
  it('no convierte un guardado exitoso en error si el almacenamiento local falla', () => {
    storage();
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denegado');
      },
      setItem: () => {
        throw new Error('denegado');
      },
    });
    expect(() => trackWrite('/api/athletes/a/checkins', {})).not.toThrow();
    expect(pendingEvaluation('a')).toBeNull();
  });
});
