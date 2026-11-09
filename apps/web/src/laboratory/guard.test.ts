import { describe, it, expect, vi, afterEach } from 'vitest';
import { guardLaboratoryWrite } from './guard';
import { configureInstance } from './environment';
const lab = {
  mode: 'laboratory' as const,
  fictitious: true,
  datasetId: 'prueba-lab',
  label: null,
  createdAt: null,
  cases: [],
};
afterEach(() => vi.unstubAllGlobals());
describe('separación del laboratorio por identidad del servidor', () => {
  it('permite escribir solo si la API confirma el mismo laboratorio', async () => {
    configureInstance(lab);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => lab }));
    await expect(guardLaboratoryWrite()).resolves.toBeUndefined();
  });
  it('bloquea una API personal o cambio de conjunto sin enviar escrituras', async () => {
    configureInstance(lab);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ ...lab, mode: 'personal', fictitious: false }) }),
    );
    await expect(guardLaboratoryWrite()).rejects.toThrow('No se enviaron cambios');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...lab, datasetId: 'otra-base' }) }),
    );
    await expect(guardLaboratoryWrite()).rejects.toThrow('No se enviaron cambios');
  });
  it('si falla la verificación no autoriza escribir', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(guardLaboratoryWrite()).rejects.toThrow('No se enviaron cambios');
  });
});
