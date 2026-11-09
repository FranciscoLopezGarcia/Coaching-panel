/** Fechas civiles ISO (yyyy-mm-dd) sin depender de zona horaria ni de medianoche. */
export function isoToDays(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}
/** Días entre `from` y `to` (to − from). Positivo si `from` es anterior. */
export function daysBetween(to: string, from: string): number {
  return isoToDays(to) - isoToDays(from);
}
