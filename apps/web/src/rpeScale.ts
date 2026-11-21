import type { CSSProperties } from 'react';

/**
 * Escala visual del RPE (solo presentación, no calcula reglas): verde clarito en 0 → verde → amarillo → naranja → rojo en 10.
 * Los medios puntos (5,5 · 6,5 · …) salen del color intermedio exacto entre sus vecinos enteros.
 * El número siempre se escribe dentro del color: el color señaliza, no reemplaza el dato.
 * Valores de la marca: marca-ttal/ronda-10-paletas/escala-rpe.json.
 */
export const RPE_ANCHORS = [
  '#EAF6E0', // 0
  '#DDF1CC', // 1
  '#CCEBB5', // 2
  '#B8E39A', // 3
  '#A3DB7F', // 4
  '#C5DD5C', // 5
  '#E0D94F', // 6
  '#F2C94C', // 7
  '#F29A3C', // 8
  '#E8643A', // 9
  '#D9372A', // 10
] as const;

const ink = '#141517';
const white = '#FFFFFF';

const channels = (hex: string) =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** Color de fondo para un RPE (se limita a 0–10). */
export function rpeColor(value: number): string {
  const v = Math.min(10, Math.max(0, value));
  const lo = Math.floor(v);
  const f = v - lo;
  if (f === 0 || lo >= 10) return RPE_ANCHORS[Math.min(lo, 10)]!;
  const a = channels(RPE_ANCHORS[lo]!);
  const b = channels(RPE_ANCHORS[lo + 1]!);
  return toHex(a.map((x, i) => x + (b[i]! - x) * f));
}

const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Color del número: grafito o blanco, el que mejor contraste dé sobre el fondo. */
export function rpeTextColor(bg: string): string {
  return contrast(ink, bg) >= contrast(white, bg) ? ink : white;
}

/** Interpreta lo que escribe una persona («7,5» o «7.5»). Devuelve null si no es un RPE válido (0–10). */
export function parseRpe(text: string | null | undefined): number | null {
  if (text == null) return null;
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return v >= 0 && v <= 10 ? v : null;
}

/** Variables CSS para `.rpe-chip` / `.rpe-input`. Sin valor válido no hay estilo (dato faltante ≠ cero). */
export function rpeStyle(value: number | null | undefined): CSSProperties | undefined {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 10) return undefined;
  const bg = rpeColor(value);
  return { '--rpe-bg': bg, '--rpe-fg': rpeTextColor(bg) } as CSSProperties;
}
