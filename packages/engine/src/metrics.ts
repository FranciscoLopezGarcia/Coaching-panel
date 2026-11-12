import { median } from './format.js';
import { addStress, stressOfSet, zeroStress, type Stress } from './si.js';
import type { Lift } from './types.js';
import type { SetView } from './views.js';

export interface WeekMetrics {
  weekNo: number;
  sets: number;
  /** NL = Σ repeticiones. NO es la cantidad de series. */
  nl: number;
  /** Σ kg×reps; null si falta algún kg. */
  tonnage: number | null;
  /** Sesiones/días distintos con exposición al lift (dos ejercicios del mismo lift el mismo día cuentan una vez). */
  frequency: number;
  days: number[];
  /** NL por día de la semana. */
  nlByDay: Record<number, number>;
  meanKg: number | null;
  /** Intensidad relativa media (kg / referencia fechada); null si falta referencia o kg en alguna serie. */
  meanPct: number | null;
  /** Igual que meanPct pero ponderada por repeticiones. */
  meanPctByReps: number | null;
  /** Series sin referencia (no entran en meanPct). */
  pctMissing: number;
  meanRpe: number | null;
  /** SI solo si TODAS las series tienen reps y RPE; si no, null (nunca se completa con supuestos). */
  si: Stress | null;
  siMissing: number;
}

export function weekMetrics(views: SetView[], weekNo: number): WeekMetrics {
  const v = views.filter((x) => x.weekNo === weekNo);
  const sessions = new Set(v.map((x) => x.sessionKey));
  const days = [...new Set(v.map((x) => x.dayNo))].sort((a, b) => a - b);
  const nlByDay: Record<number, number> = {};
  for (const x of v) nlByDay[x.dayNo] = (nlByDay[x.dayNo] ?? 0) + x.reps;
  const kgs = v.map((x) => x.kg);
  const allKg = v.length > 0 && kgs.every((k) => k !== null);
  const pcts = v.map((x) => (x.kg !== null && x.refKg ? x.kg / x.refKg : null));
  const withPct = v
    .map((x, i) => ({ p: pcts[i] as number | null, reps: x.reps }))
    .filter((x) => x.p !== null) as {
    p: number;
    reps: number;
  }[];
  const repsPct = withPct.reduce((a, x) => a + x.reps, 0);
  const rpes = v.map((x) => x.rpe).filter((r): r is number => r !== null);
  const withRpe = v.filter((x) => x.rpe !== null);
  let si: Stress | null = null;
  if (v.length && withRpe.length === v.length)
    si = v.reduce((acc, x) => addStress(acc, stressOfSet(x.reps, x.rpe as number)), zeroStress());
  return {
    weekNo,
    sets: v.length,
    nl: v.reduce((s, x) => s + x.reps, 0),
    tonnage: allKg ? v.reduce((s, x) => s + (x.kg as number) * x.reps, 0) : null,
    frequency: sessions.size,
    days,
    nlByDay,
    meanKg: allKg ? (kgs as number[]).reduce((a, b) => a + b, 0) / v.length : null,
    // Series sin referencia no anulan la semana: se promedia lo que tiene referencia y se informa cuántas faltan (pctMissing).
    meanPct: withPct.length ? withPct.reduce((a, x) => a + x.p, 0) / withPct.length : null,
    meanPctByReps: repsPct ? withPct.reduce((a, x) => a + x.p * x.reps, 0) / repsPct : null,
    pctMissing: v.length - withPct.length,
    meanRpe: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null,
    si,
    siMissing: v.length - withRpe.length,
  };
}

export interface BlockMetrics {
  lift: Lift | 'ALL';
  blockKey: string;
  weeks: number[];
  /** Medias POR SEMANA (normalizadas): comparar un bloque de 4 semanas con uno de 6 por total bruto es engañoso. */
  perWeek: {
    sets: number;
    nl: number;
    frequency: number;
    meanKg: number | null;
    meanPct: number | null;
    meanPctByReps: number | null;
    meanRpe: number | null;
    si: Stress | null;
    nlByDay: Record<number, number>;
  };
  totals: { sets: number; nl: number; tonnage: number | null };
  exercises: string[];
  refKgs: number[];
  weekly: WeekMetrics[];
  /** SI semanal completo en todas las semanas del bloque. */
  siComplete: boolean;
}

const meanOrNull = (xs: (number | null)[]): number | null =>
  xs.length && xs.every((x) => x !== null) ? (xs as number[]).reduce((a, b) => a + b, 0) / xs.length : null;

const poolPct = (v: SetView[], byReps: boolean): number | null => {
  const xs = v.filter((x) => x.kg !== null && x.refKg);
  const w = (x: SetView) => (byReps ? x.reps : 1);
  const d = xs.reduce((a, x) => a + w(x), 0);
  return d ? xs.reduce((a, x) => a + ((x.kg as number) / (x.refKg as number)) * w(x), 0) / d : null;
};

/** Métricas de un bloque para un lift, en un universo ya filtrado. `weeks` opcional recorta a "las primeras N semanas compartidas". */
export function blockMetrics(
  views: SetView[],
  lift: Lift | 'ALL',
  blockKey: string,
  weeks?: number[],
): BlockMetrics | null {
  const v = views.filter(
    (x) =>
      (lift === 'ALL' || x.lift === lift) && x.blockKey === blockKey && (!weeks || weeks.includes(x.weekNo)),
  );
  if (!v.length) return null;
  const ws = [...new Set(v.map((x) => x.weekNo))].sort((a, b) => a - b);
  const weekly = ws.map((w) => weekMetrics(v, w));
  const n = weekly.length;
  const avg = (f: (w: (typeof weekly)[number]) => number) => weekly.reduce((s, w) => s + f(w), 0) / n;
  const nlByDay: Record<number, number> = {};
  for (const w of weekly)
    for (const [d, x] of Object.entries(w.nlByDay)) nlByDay[Number(d)] = (nlByDay[Number(d)] ?? 0) + x / n;
  const siComplete = weekly.every((w) => w.si !== null);
  const tons = weekly.map((w) => w.tonnage);
  return {
    lift,
    blockKey,
    weeks: ws,
    perWeek: {
      sets: avg((w) => w.sets),
      nl: avg((w) => w.nl),
      frequency: avg((w) => w.frequency),
      meanKg: meanOrNull(weekly.map((w) => w.meanKg)),
      // Pool de todas las series del bloque (no media de medias semanales): semanas con distinto número de series no distorsionan.
      meanPct: poolPct(v, false),
      meanPctByReps: poolPct(v, true),
      meanRpe: meanOrNull(weekly.map((w) => w.meanRpe)),
      si: siComplete
        ? {
            central: avg((w) => (w.si as Stress).central),
            peripheral: avg((w) => (w.si as Stress).peripheral),
            total: avg((w) => (w.si as Stress).total),
          }
        : null,
      nlByDay,
    },
    totals: {
      sets: v.length,
      nl: v.reduce((s, x) => s + x.reps, 0),
      tonnage: tons.every((t) => t !== null) ? (tons as number[]).reduce((a, b) => a + b, 0) : null,
    },
    exercises: [...new Set(v.map((x) => x.exerciseName))].sort(),
    refKgs: [...new Set(v.map((x) => x.refKg).filter((r): r is number => r !== null))].sort((a, b) => a - b),
    weekly,
    siComplete,
  };
}

export const medianOf = median;
