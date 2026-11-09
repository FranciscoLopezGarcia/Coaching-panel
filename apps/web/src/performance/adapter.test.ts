import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PerformanceProjection } from '@coaching/contracts';
import fixture from '../../test/fixtures/projection-synthetic.json';
import { presentProjection, fetchProjection, projectionVariable } from './adapter';
const example = () => structuredClone(fixture) as unknown as PerformanceProjection;
afterEach(() => vi.unstubAllGlobals());
it('no sustituye un método desconocido por curva RPE', () => {
  expect(projectionVariable('nuevo-metodo')).toBeNull();
  expect(projectionVariable('table-rpe')).toBe('e1rm_table_rpe');
  expect(projectionVariable('prg-6-formulas')).toBe('e1rm_prg_formulas');
});
it('identifica el baseline seleccionado sin generar una curva nueva', () => {
  const p = example();
  p.model.selected = {
    id: 'baseline',
    version: 'baseline-nivel-reciente-v1',
    label: 'Mantiene el nivel reciente',
  };
  const view = presentProjection(p);
  expect(view.selectedBaseline).toBe(true);
  expect(view.forecast).toEqual(p.forecastPoints);
});
describe('presentación de rendimiento sin modelos en cliente', () => {
  it('mantiene método, resumen y valores del servidor; recorta puntos ajenos a la vista', () => {
    const p = example();
    p.observedPoints[0]!.inView = false;
    const v = presentProjection(p);
    expect(v.observations).toHaveLength(p.observedPoints.length - 1);
    expect(v.method).toEqual(p.target.method);
    expect(v.summary).toEqual(p.summary);
    expect(v.forecast).toEqual(p.forecastPoints);
  });
  it('no dibuja proyección ni banda en modo descriptivo, aunque el payload contenga puntos', () => {
    const p = example();
    p.status = 'descriptive_only';
    p.forecastRange.status = 'available';
    p.forecastRange.points = [{ date: p.cutoff, lower: 120, upper: 130 }];
    const v = presentProjection(p);
    expect(v.forecast).toEqual([]);
    expect(v.range).toEqual([]);
    expect(v.observations.length).toBeGreaterThan(0);
  });
  it('respeta abstención y disponibilidad de la banda', () => {
    const p = example();
    p.status = 'unavailable';
    const v = presentProjection(p);
    expect(v.trend).toEqual([]);
    expect(v.observations).toEqual([]);
    expect(v.forecast).toEqual([]);
    p.status = 'available';
    p.forecastRange.status = 'unavailable';
    expect(presentProjection(p).range).toEqual([]);
  });
  it('un 404 conserva el recorrido histórico y un error de red es recuperable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 }));
    expect(await fetchProjection('a', {})).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500, ok: false }));
    await expect(fetchProjection('a', {})).rejects.toThrow('Reintentá');
  });
});
