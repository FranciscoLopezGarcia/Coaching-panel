import { e1rm, pctFromTable } from './e1rm.js';

/**
 * Progresión sugerida del próximo entreno de un ejercicio, a partir de lo que el atleta HIZO en el último.
 * Es una GUÍA para el coach (y, si el coach lo decide, para el atleta): nunca modifica el plan.
 *
 *  · Con rango de repeticiones (p. ej. 3×8-10@8): doble progresión. Si todas las series llegaron al tope con RPE dentro del objetivo →
 *    subir carga y volver al piso del rango; si no → sumar una repetición a la serie más floja (sin pasar el tope); si el RPE se
 *    pasó del objetivo → mantener.
 *  · Con repeticiones fijas (p. ej. 3×5@7, básicos): la carga sale del 1RM estimado reciente y de la curva reps×RPE de cada serie prevista.
 *
 * El 1RM estimado y la caída entre series se calculan de las series realizadas; sin RPE cargado se usa el RPE objetivo (y se avisa).
 */
export interface ProgSet {
  kg: number | null;
  reps: number | null;
  rpe: number | null;
}
export interface ProgPlannedSet {
  reps: number;
  repsMax: number | null;
  rpe: number | null;
}
export type ProgAction = 'subir_carga' | 'subir_reps' | 'mantener' | 'bajar_carga' | 'sin_datos';
export interface ProgSuggestion {
  action: ProgAction;
  /** Una entrada por serie prevista. kg null = no se sugiere carga (sin datos). */
  sets: { reps: number; kg: number | null }[];
  /** Frase corta para el atleta (sin números internos). */
  athleteText: string;
  e1rm: number | null;
  /** Repeticiones que se pierden de la primera a la última serie del último entreno (0 = ninguna). */
  fatigueDrop: number | null;
  lastKg: number | null;
  lastSummary: string;
  rationale: string[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const stepDown = (x: number, step: number) => Math.floor(x / step + 1e-9) * step;
const stepNear = (x: number, step: number) => Math.round(x / step) * step;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const fmt = (x: number) => String(r1(x)).replace('.', ',');

export function suggestProgression(planned: ProgPlannedSet[], last: ProgSet[], stepKg = 2.5): ProgSuggestion {
  const done = last.filter((s) => s.kg && s.reps && s.kg > 0 && s.reps > 0) as {
    kg: number;
    reps: number;
    rpe: number | null;
  }[];
  const empty = (why: string): ProgSuggestion => ({
    action: 'sin_datos',
    sets: planned.map((p) => ({ reps: p.reps, kg: null })),
    athleteText: '',
    e1rm: null,
    fatigueDrop: null,
    lastKg: null,
    lastSummary: '',
    rationale: [why],
  });
  if (!planned.length) return empty('No hay series previstas.');
  if (!done.length)
    return empty('Todavía no hay un entreno anterior con carga y repeticiones para este ejercicio.');

  const first = planned[0] as ProgPlannedSet;
  const lo = Math.min(...planned.map((p) => p.reps));
  const hi = Math.max(...planned.map((p) => p.repsMax ?? p.reps));
  const target = first.rpe ?? 8;
  const noRpe = done.some((d) => d.rpe === null) || planned.some((p) => p.rpe === null);
  // carga más usada del último entreno (si hay empate, la mayor)
  const counts = new Map<number, number>();
  for (const d of done) counts.set(d.kg, (counts.get(d.kg) ?? 0) + 1);
  const kg0 = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
  const at = done.filter((d) => d.kg === kg0);
  const reps = at.map((d) => d.reps);
  const rpes = at.map((d) => d.rpe ?? target);
  const over = rpes.reduce((a, b) => a + b, 0) / rpes.length - target;
  const ests = at
    .map((d) => e1rm(d.kg, d.reps, d.rpe ?? target, 'amplio'))
    .filter((x): x is number => x !== null);
  const est = ests.length ? median(ests) : null;
  const drop = reps.length > 1 ? Math.max(0, (reps[0] as number) - (reps[reps.length - 1] as number)) : null;
  const inc = Math.max(stepKg, stepNear(kg0 * 0.025, stepKg));
  const lastSummary = `${at.length}×${kg0 % 1 ? fmt(kg0) : kg0} kg: ${reps.join('-')} reps`;
  const why: string[] = [
    `Último entreno: ${lastSummary}${noRpe ? ' (sin RPE cargado en alguna serie: se usó el objetivo)' : ` · RPE medio ${fmt(rpes.reduce((a, b) => a + b, 0) / rpes.length)} (objetivo ${fmt(target)})`}.`,
  ];
  if (est) why.push(`1RM estimado con esas series: ${fmt(est)} kg.`);
  if (drop !== null)
    why.push(
      drop === 0
        ? 'Sostuvo las repeticiones entre series (sin caída).'
        : `Perdió ${drop} rep. de la primera a la última serie (fatiga entre series).`,
    );
  const base = { e1rm: est ? r1(est) : null, fatigueDrop: drop, lastKg: kg0, lastSummary };

  if (hi > lo) {
    // doble progresión
    const minR = Math.min(...reps);
    if (reps.every((x) => x >= hi) && over <= 0.5) {
      const kg1 = kg0 + (over <= -1.5 ? inc * 2 : inc);
      why.push(
        `Llegó al tope (${hi}) en todas las series con RPE en objetivo: toca subir la carga y volver a ${lo}.`,
      );
      return {
        ...base,
        action: 'subir_carga',
        sets: planned.map(() => ({ reps: lo, kg: kg1 })),
        athleteText: `Subí a ${fmt(kg1)} kg y buscá ${lo} reps`,
        rationale: why,
      };
    }
    if (over > 1) {
      const n = Math.max(lo, minR);
      why.push(`El RPE se pasó ${fmt(over)} puntos del objetivo: mantener carga y repeticiones.`);
      return {
        ...base,
        action: 'mantener',
        sets: planned.map(() => ({ reps: n, kg: kg0 })),
        athleteText: `Mantené ${fmt(kg0)} kg y buscá ${n} reps en todas`,
        rationale: why,
      };
    }
    if (minR < lo - 1 && over > 0.5) {
      const kg1 = Math.max(stepKg, kg0 - inc);
      why.push(`Quedó ${lo - minR} reps por debajo del piso con RPE alto: bajar un escalón de carga.`);
      return {
        ...base,
        action: 'bajar_carga',
        sets: planned.map(() => ({ reps: lo, kg: kg1 })),
        athleteText: `Bajá a ${fmt(kg1)} kg y buscá ${lo} reps`,
        rationale: why,
      };
    }
    const n = Math.min(hi, Math.max(lo, minR + 1));
    why.push(`La serie más floja fue de ${minR}: buscar ${n} en todas, con la misma carga.`);
    const alt = est ? stepDown(est * (pctFromTable(hi, target, 'amplio') ?? 0), stepKg) : 0;
    if (alt > kg0) why.push(`Con ese 1RM, ${hi} reps @${fmt(target)} serían ≈ ${fmt(alt)} kg.`);
    return {
      ...base,
      action: 'subir_reps',
      sets: planned.map(() => ({ reps: n, kg: kg0 })),
      athleteText: `Mantené ${fmt(kg0)} kg y buscá ${n} reps en todas`,
      rationale: why,
    };
  }

  // repeticiones fijas: carga por serie desde el 1RM reciente
  if (!est)
    return {
      ...empty('No se pudo estimar el 1RM (faltan repeticiones o RPE en el dominio).'),
      ...base,
      action: 'sin_datos',
    };
  const sets = planned.map((p) => {
    const pct = pctFromTable(p.reps, p.rpe ?? target, 'amplio');
    return { reps: p.reps, kg: pct ? Math.max(stepKg, stepDown(est * pct, stepKg)) : null };
  });
  const mid = median(sets.map((s) => s.kg ?? kg0));
  const action: ProgAction =
    mid > kg0 + stepKg / 2 ? 'subir_carga' : mid < kg0 - stepKg / 2 ? 'bajar_carga' : 'mantener';
  why.push(
    `Carga sugerida por serie = 1RM estimado × % de la curva (reps × RPE de cada serie): ${sets.map((s) => (s.kg === null ? '—' : fmt(s.kg))).join(' · ')} kg.`,
  );
  return {
    ...base,
    action,
    sets,
    athleteText:
      action === 'subir_carga'
        ? 'Podés subir un poco la carga'
        : action === 'bajar_carga'
          ? 'Bajá un poco la carga'
          : 'Mantené la carga',
    rationale: why,
  };
}
