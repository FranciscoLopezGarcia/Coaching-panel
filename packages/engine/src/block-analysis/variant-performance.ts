import { e1rm } from '../e1rm.js';
import type { ActualSet, Lift, PlannedSet } from '../types.js';
import type { BestStatus, VariantPerformance, VariantWeekPoint } from './contracts.js';

/**
 * e1RM OBSERVADO por variante y bloque (solo series hechas con RPE real, fecha <= corte).
 * Máximo semanal por variante; semanas sin benchmark = hueco. Empates: se elige la última (igual que computeTtp, `>=`) y se informan todas.
 * Nunca se mezclan variantes ni se usa el RPE objetivo.
 */
export function variantPerformance(
  planned: PlannedSet[],
  actual: ActualSet[],
  blockKey: string,
  cutoff: string,
  closed: boolean,
  lift?: Lift,
): VariantPerformance[] {
  const amap = new Map(actual.map((a) => [a.plannedSetId, a]));
  type Obs = { e: number; week: number; date: string; session: string; rpe: number };
  const groups = new Map<string, { lift: Lift; name: string; obs: Obs[] }>();
  for (const s of planned) {
    if (s.isWarmup || s.lift === null || s.blockKey !== blockKey || (lift && s.lift !== lift)) continue;
    const g = groups.get(s.variantKey) ?? { lift: s.lift, name: s.exerciseName, obs: [] };
    groups.set(s.variantKey, g);
    const a = amap.get(s.id);
    if (!a || a.status !== 'done' || !a.performedOn || a.performedOn > cutoff) continue;
    if (a.kg === null || a.reps === null || a.rpe === null) continue;
    const e = e1rm(a.kg, a.reps, a.rpe);
    if (e === null) continue;
    g.obs.push({ e, week: s.weekNo, date: a.performedOn, session: s.sessionKey, rpe: a.rpe });
  }
  const out: VariantPerformance[] = [];
  for (const [variantKey, g] of groups) {
    const byWeek = new Map<number, Obs[]>();
    for (const o of g.obs) byWeek.set(o.week, [...(byWeek.get(o.week) ?? []), o]);
    const weekly: VariantWeekPoint[] = [...byWeek.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([week, os]) => {
        const top = os.reduce((m, o) => (o.e > m.e ? o : m), os[0] as Obs);
        const rpes = os.map((o) => o.rpe);
        return {
          week,
          e1rm: top.e,
          n: new Set(os.map((o) => o.session)).size,
          lastDate: os
            .map((o) => o.date)
            .sort()
            .at(-1) as string,
          rpeMin: Math.min(...rpes),
          rpeMax: Math.max(...rpes),
        };
      });
    let bestKg: number | null = null;
    let bestWeek: number | null = null;
    let bestDate: string | null = null;
    let tiedDates: string[] = [];
    if (g.obs.length) {
      const sorted = [...g.obs].sort((a, b) => (a.date < b.date ? -1 : 1));
      let best = sorted[0] as Obs;
      for (const o of sorted) if (o.e >= best.e) best = o;
      bestKg = best.e;
      bestWeek = best.week;
      bestDate = best.date;
      tiedDates = sorted.filter((o) => o.e === best.e).map((o) => o.date);
    }
    const sessions = new Set(g.obs.map((o) => o.session)).size;
    const after = bestDate
      ? new Set(g.obs.filter((o) => o.date > (bestDate as string)).map((o) => o.session)).size
      : 0;
    let status: BestStatus;
    if (!g.obs.length) status = 'not_observed';
    else if (sessions < 4) status = 'observed_but_sparse';
    else if (!closed || after < 2) status = 'best_observed_open';
    else status = 'best_observed_delimited';
    out.push({
      lift: g.lift,
      variantKey,
      exerciseName: g.name,
      blockKey,
      source: 'actual',
      weekly,
      bestKg,
      bestWeek,
      bestDate,
      tiedDates,
      status,
      methodId: 'e1rm_table_rpe',
    });
  }
  return out.sort((a, b) => (a.variantKey < b.variantKey ? -1 : 1));
}
