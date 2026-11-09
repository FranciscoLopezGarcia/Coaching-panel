import type { Readiness } from './types.js';

export interface CheckInAnswers {
  date: string;
  sleep: number | null;
  energy: number | null;
  motivation: number | null;
  stress: number | null;
  pain: number | null;
}

/** Disposición 1–10 PROPIA (no es TRAC de RTS): promedio de sueño, energía, ganas, (11−estrés) y (10−dolor). Requiere los 5 campos. */
export function readinessOf(c: CheckInAnswers): number | null {
  const { sleep, energy, motivation, stress, pain } = c;
  if (sleep === null || energy === null || motivation === null || stress === null || pain === null)
    return null;
  return (sleep + energy + motivation + (11 - stress) + (10 - pain)) / 5;
}

/** Último check-in completo hasta el corte (sin datos posteriores). */
export function latestReadiness(rows: CheckInAnswers[], cutoff: string, maxAgeDays = 14): Readiness | null {
  let best: Readiness | null = null;
  for (const r of rows) {
    const v = readinessOf(r);
    if (v === null || r.date > cutoff) continue;
    const age = (Date.parse(cutoff) - Date.parse(r.date)) / 86_400_000;
    if (age >= maxAgeDays) continue;
    if (!best || r.date > best.date) best = { date: r.date, value: v };
  }
  return best;
}

/** Último valor de disposición del historial hasta el corte (sin datos posteriores) y con antigüedad < maxAgeDays. */
export function latestFrom(history: Readiness[], cutoff: string, maxAgeDays = 14): Readiness | null {
  let best: Readiness | null = null;
  for (const r of history) {
    if (r.date > cutoff) continue;
    const age = (Date.parse(cutoff) - Date.parse(r.date)) / 86_400_000;
    if (age >= maxAgeDays) continue;
    if (!best || r.date > best.date) best = r;
  }
  return best;
}
