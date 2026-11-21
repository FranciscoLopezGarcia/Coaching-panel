import { describe, expect, it } from 'vitest';
import { RPE_ANCHORS, contrast, parseRpe, rpeColor, rpeStyle, rpeTextColor } from './rpeScale';

describe('escala RPE', () => {
  it('los enteros usan el color de la marca', () => {
    expect(rpeColor(0)).toBe('#EAF6E0');
    expect(rpeColor(7)).toBe('#F2C94C');
    expect(rpeColor(10)).toBe('#D9372A');
  });
  it('los medios puntos son el punto medio entre vecinos', () => {
    expect(rpeColor(7.5)).toBe('#F2B244');
    expect(rpeColor(9.5)).toBe('#E14E32');
    expect(rpeColor(5.5)).toBe('#D3DB56');
  });
  it('limita fuera de rango', () => {
    expect(rpeColor(-3)).toBe(RPE_ANCHORS[0]);
    expect(rpeColor(14)).toBe(RPE_ANCHORS[10]);
  });
  it('el número es legible en toda la escala', () => {
    for (let v = 0; v <= 10; v += 0.5) {
      const bg = rpeColor(v);
      expect(contrast(rpeTextColor(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(rpeTextColor(rpeColor(10))).toBe('#FFFFFF');
  });
  it('interpreta lo escrito y no inventa valores', () => {
    expect(parseRpe('7,5')).toBe(7.5);
    expect(parseRpe('8.5')).toBe(8.5);
    expect(parseRpe('')).toBeNull();
    expect(parseRpe('abc')).toBeNull();
    expect(parseRpe('11')).toBeNull();
    expect(parseRpe(null)).toBeNull();
    expect(rpeStyle(null)).toBeUndefined();
    expect(rpeStyle(8)).toBeDefined();
  });
});
