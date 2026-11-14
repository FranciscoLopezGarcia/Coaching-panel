import { describe, expect, it } from 'vitest';
import { intensityZones, sanitizeCuts } from '../src/block-analysis/zones.js';
import type { SetView } from '../src/views.js';

const v = (kg: number | null, refKg: number | null, reps = 5, lift = 'SQ'): SetView =>
  ({ blockKey: 'B1', lift, kg, refKg, reps }) as unknown as SetView;

describe('Zonas de intensidad (descriptivas)', () => {
  it('reparte por %1RM con cortes 75/90 y deja aparte lo que no tiene referencia', () => {
    const r = intensityZones(
      [v(70, 100), v(80, 100), v(95, 100), v(100, 100, 3), v(60, null), v(null, 100)],
      ['B1'],
      'ALL',
    );
    const b = r.byBlock[0]!;
    expect(b.withRef).toBe(4);
    expect(b.withoutRef).toBe(2); // faltante ≠ cero
    expect(b.zones.map((z) => z.sets)).toEqual([1, 1, 2]);
    expect(b.zones[2]!.reps).toBe(8);
    expect(b.zones[2]!.shareSets).toBe(0.5);
  });
  it('sin ninguna serie con referencia no inventa porcentajes', () => {
    const b = intensityZones([v(60, null)], ['B1'], 'ALL').byBlock[0]!;
    expect(b.zones.every((z) => z.shareSets === null)).toBe(true);
  });
  it('cortes propios y saneados', () => {
    expect(sanitizeCuts([90, 70, 70, 80])).toEqual([70, 80, 90]);
    expect(sanitizeCuts([])).toEqual([75, 90]);
    const r = intensityZones([v(65, 100), v(85, 100)], ['B1'], 'ALL', [70, 80, 90]);
    expect(r.byBlock[0]!.zones).toHaveLength(4);
  });
  it('filtra por movimiento', () => {
    const r = intensityZones([v(80, 100, 5, 'SQ'), v(80, 100, 5, 'BP')], ['B1'], 'BP');
    expect(r.byBlock[0]!.withRef).toBe(1);
  });
});
