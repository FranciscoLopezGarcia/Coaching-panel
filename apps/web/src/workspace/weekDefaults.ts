import { shift } from './ui';

export const mondayOf = (date: string) => shift(date, -((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7));

/**
 * Destino por defecto al copiar una semana: la primera semana libre después de la última del bloque, con los mismos días de la
 * semana que el origen. La fecha corresponde a la PRIMERA sesión copiada (así la usa el motor).
 */
export function nextWeekDefaults(
  sessions: { weekNo: number; date: string }[],
  sourceWeek: number,
  fallback: string,
): { week: number; date: string } {
  const source = sessions
    .filter((s) => s.weekNo === sourceWeek)
    .map((s) => s.date)
    .sort()[0];
  const week = Math.max(sourceWeek, ...sessions.map((s) => s.weekNo)) + 1;
  const last = sessions
    .map((s) => s.date)
    .sort()
    .at(-1);
  if (!source || !last) return { week, date: shift(fallback, 7) };
  const weekday = (new Date(source + 'T12:00:00Z').getUTCDay() + 6) % 7;
  return { week, date: shift(mondayOf(last), 7 + weekday) };
}
