import { describe, expect, it } from 'vitest';
import { nextWeekDefaults } from './weekDefaults';

// Lunes 02-11 y jueves 05-11 (S1); lunes 09-11 y jueves 12-11 (S2). El orden de llegada es del más nuevo al más viejo.
const block = [
  { weekNo: 2, date: '2026-11-12' },
  { weekNo: 2, date: '2026-11-09' },
  { weekNo: 1, date: '2026-11-05' },
  { weekNo: 1, date: '2026-11-02' },
];

describe('destino por defecto de la siguiente semana', () => {
  it('conserva los días de la semana: la primera sesión cae el lunes siguiente', () => {
    expect(nextWeekDefaults(block, 2, '2026-11-27')).toEqual({ week: 3, date: '2026-11-16' });
  });
  it('desde una semana intermedia propone la primera libre, no una que ya existe', () => {
    expect(nextWeekDefaults(block, 1, '2026-11-27')).toEqual({ week: 3, date: '2026-11-16' });
  });
  it('sin sesiones usa una semana después de la fecha dada', () => {
    expect(nextWeekDefaults([], 1, '2026-11-27')).toEqual({ week: 2, date: '2026-12-04' });
  });
});
