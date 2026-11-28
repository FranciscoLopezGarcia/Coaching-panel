import { isoToDays, shiftIsoDate } from './dates.js';

/** Un día con sesiones en el plan vigente. */
export interface PlanDay {
  blockKey: string;
  date: string;
}
/** Fin declarado de un bloque (ficha del mesociclo o microciclo). */
export interface DeclaredEnd {
  blockKey: string;
  endDate: string | null;
}

export interface PlanningStatus {
  /** Semana calendario (lunes a domingo) que contiene a `today`, y la siguiente. */
  currentWeek: { from: string; to: string };
  nextWeek: { from: string; to: string };
  hasCurrent: boolean;
  hasNext: boolean;
  /** Último día con sesiones en el plan vigente (null = sin plan). */
  plannedUntil: string | null;
  /** Bloques entrenados esta semana cuyo final cae dentro de ella. Es independiente de que la semana que viene esté cargada. */
  endingBlocks: { blockKey: string; endDate: string }[];
}

/**
 * Estado de la planificación respecto de hoy. «Planificada» = la semana tiene al menos una sesión en el plan vigente.
 * El final de un bloque es la fecha más tardía entre sus sesiones y sus fines declarados: si no se declaró un fin y todavía no se
 * cargó la semana siguiente del bloque, la actual cuenta como la última.
 */
export function planningStatus(days: PlanDay[], declared: DeclaredEnd[], today: string): PlanningStatus {
  const monday = shiftIsoDate(today, -((isoToDays(today) + 3) % 7));
  const week = (from: string) => ({ from, to: shiftIsoDate(from, 6) });
  const currentWeek = week(monday);
  const nextWeek = week(shiftIsoDate(monday, 7));
  const within = (w: { from: string; to: string }) => days.filter((d) => d.date >= w.from && d.date <= w.to);
  const current = within(currentWeek);
  const endingBlocks = [...new Set(current.map((d) => d.blockKey))].flatMap((blockKey) => {
    const endDate = [...days, ...declared.map((d) => ({ blockKey: d.blockKey, date: d.endDate }))]
      .flatMap((d) => (d.blockKey === blockKey && d.date ? [d.date] : []))
      .sort()
      .pop() as string;
    return endDate <= currentWeek.to ? [{ blockKey, endDate }] : [];
  });
  return {
    currentWeek,
    nextWeek,
    hasCurrent: current.length > 0,
    hasNext: within(nextWeek).length > 0,
    plannedUntil:
      days
        .map((d) => d.date)
        .sort()
        .pop() ?? null,
    endingBlocks,
  };
}
