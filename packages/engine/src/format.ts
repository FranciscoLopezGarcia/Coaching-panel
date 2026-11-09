export function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
}
/** Número con coma decimal (es-AR) y `d` decimales como máximo. */
export function f(x: number, d = 1): string {
  const k = 10 ** d;
  return String(Math.round(x * k) / k).replace('.', ',');
}
export function signed(x: number, d = 1): string {
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${f(Math.abs(x), d)}`;
}
export function floorToStep(x: number, step: number): number {
  return Math.floor(x / step + 1e-9) * step;
}
