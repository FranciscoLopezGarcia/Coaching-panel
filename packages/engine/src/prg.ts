import { daysBetween } from './dates.js';
import { median } from './format.js';
import type { ActualSet, Lift, PlannedSet } from './types.js';

/**
 * Métricas reconstruidas de PRG (R-EXPRESSION modo A). [recuperado del texto/código del cliente de PRG; NO verificado contra su motor completo].
 * Se calculan con el e1RM de tabla del proyecto, no con el promedio de 6 fórmulas de PRG: es una sustitución declarada.
 */
export const inolPrg = (reps: number, kg: number, ref: number): number | null =>
  ref > 0 && kg > 0 && reps > 0 ? reps / Math.max(1, 100 - (100 * kg) / ref) : null;

export interface DayPoint {
  date: string;
  v: number;
  known: boolean;
  sets: number;
  sets85: number;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Serie diaria de INOL PRG (últimos `n` días hasta el corte) para un lift.
 * Un día es CONOCIDO si hay registro (hecho u omitido), o si no había nada previsto ese día dentro del plan conocido (descanso programado).
 * Un día con series previstas y sin registro es DESCONOCIDO: no se toma como descanso. Series sin referencia fechada vuelven desconocido el día.
 */
export function dailyInol(
  planned: PlannedSet[],
  actual: ActualSet[],
  lift: Lift,
  cutoff: string,
  n: number,
): DayPoint[] {
  const amap = new Map(actual.map((a) => [a.plannedSetId, a]));
  const all = planned.filter((s) => !s.isWarmup);
  const first = all.map((s) => s.plannedDate).sort()[0];
  const out: DayPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(cutoff, -i);
    const plannedToday = all.filter((s) => s.lift === lift && s.plannedDate === date);
    const recs = all.filter((s) => s.lift === lift && amap.get(s.id)?.performedOn === date);
    let v = 0;
    let sets = 0;
    let sets85 = 0;
    let bad = false;
    for (const s of recs) {
      const a = amap.get(s.id) as ActualSet;
      if (a.status !== 'done' || a.kg === null || a.reps === null) continue;
      if (!s.refKg) {
        bad = true;
        continue;
      }
      v += inolPrg(a.reps, a.kg, s.refKg) ?? 0;
      sets++;
      if (a.kg / s.refKg >= 0.85) sets85++;
    }
    const anyRecord = all.some(
      (s) =>
        s.lift === lift &&
        amap.has(s.id) &&
        amap.get(s.id)?.status !== 'pending' &&
        (amap.get(s.id)?.performedOn === date ||
          (amap.get(s.id)?.status === 'skipped' && s.plannedDate === date)),
    );
    const known = !bad && (anyRecord || (plannedToday.length === 0 && first !== undefined && date >= first));
    out.push({ date, v, known, sets, sets85 });
  }
  return out;
}

export function acwrPrg(x: DayPoint[]): { value: number | null; reason: string } {
  if (x.length < 28) return { value: null, reason: 'Historial insuficiente' };
  const w = x.slice(-28);
  if (!w.every((d) => d.known))
    return {
      value: null,
      reason: 'Cobertura de calendario incompleta (días con series previstas y sin registro)',
    };
  const chronic = w.slice(0, 21).map((d) => d.v);
  if (chronic.filter((v) => v > 0).length < 3)
    return { value: null, reason: 'Menos de 3 días con carga en el crónico' };
  const den = chronic.reduce((a, b) => a + b, 0) / 3;
  if (!(den > 0)) return { value: null, reason: 'Denominador 0' };
  return { value: w.slice(21).reduce((a, d) => a + d.v, 0) / den, reason: '' };
}

/** PeakIndex = % de series ≥ 85 % de la referencia sobre las series válidas de 7 días. */
export function peakIndexPrg(x: DayPoint[]): number | null {
  const w = x.slice(-7);
  if (!w.every((d) => d.known)) return null;
  const total = w.reduce((a, d) => a + d.sets, 0);
  return total > 0 ? (100 * w.reduce((a, d) => a + d.sets85, 0)) / total : null;
}

/** FR: mejor e1RM diario, reciente→antiguo, pesos N..1. Requiere ≥ 2 fechas. */
export function frPrg(bestRecentFirst: number[]): number | null {
  const n = bestRecentFirst.length;
  if (n < 2) return null;
  let num = 0;
  let den = 0;
  bestRecentFirst.forEach((v, i) => {
    num += (n - i) * v;
    den += n - i;
  });
  return (bestRecentFirst[0] as number) / (num / den);
}

/** Tendencia 21–28: mejor valor de los últimos 7 días vs mejor valor de los días 21–27. */
export function trend2128(
  obs: { date: string; value: number }[],
  cutoff: string,
): 'Ascendente' | 'Estable' | 'Descendente' | null {
  const act = obs
    .filter((o) => daysBetween(cutoff, o.date) >= 0 && daysBetween(cutoff, o.date) < 7)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const cmp = obs.filter((o) => daysBetween(cutoff, o.date) >= 21 && daysBetween(cutoff, o.date) < 28);
  if (!act.length || !cmp.length) return null;
  const a = (act[act.length - 1] as { value: number }).value;
  const c = Math.max(...cmp.map((o) => o.value));
  return a > c ? 'Ascendente' : a < c ? 'Descendente' : 'Estable';
}

export const medianValue = median;
