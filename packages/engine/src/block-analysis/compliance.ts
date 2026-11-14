import type { ActualSet, PlannedSet } from '../types.js';

/**
 * Cumplimiento del bloque: lo previsto contra lo hecho, lado a lado (plan y real NO se mezclan ni se completan entre sí).
 * Solo series de trabajo (sin calentamientos) con fecha ≤ corte. Una serie prevista sin registro es FALTANTE (`unknown`), no «omitida» ni «hecha».
 * Las comparaciones carga/reps/RPE usan SOLO los pares con ambos datos (si falta el previsto o el real, el par no entra y se informa cuántos entraron).
 * Es descriptivo: no dice si cumplir más o menos es mejor.
 */
export interface ComplianceTotals {
  sessionsPlanned: number;
  /** Sesiones con al menos una serie hecha. */
  sessionsWithWork: number;
  /** Sesiones con todas sus series hechas. */
  sessionsComplete: number;
  setsPlanned: number;
  setsDone: number;
  setsSkipped: number;
  /** Previstas sin registro (faltante). */
  setsUnknown: number;
  /** done / planned; null si no hay series previstas. */
  setsDoneShare: number | null;
  /** Hechas sobre las que tienen registro (hechas + omitidas); null si no hay registros. */
  setsDoneOfRecorded: number | null;
}
export interface PairStat {
  /** Series con previsto y real a la vez. */
  pairs: number;
  /** Promedio real/previsto en % (100 = igual); null si no hay pares. */
  meanPct: number | null;
}
export interface RpePairStat {
  pairs: number;
  /** Promedio (RPE real − RPE objetivo); null si no hay pares. */
  meanDiff: number | null;
}
export interface WeekCompliance extends ComplianceTotals {
  weekNo: number;
}
export interface BlockCompliance {
  blockKey: string;
  weeks: WeekCompliance[];
  total: ComplianceTotals;
  load: PairStat;
  reps: PairStat;
  rpe: RpePairStat;
}

const empty = (): ComplianceTotals => ({
  sessionsPlanned: 0,
  sessionsWithWork: 0,
  sessionsComplete: 0,
  setsPlanned: 0,
  setsDone: 0,
  setsSkipped: 0,
  setsUnknown: 0,
  setsDoneShare: null,
  setsDoneOfRecorded: null,
});

function close(t: ComplianceTotals): ComplianceTotals {
  const rec = t.setsDone + t.setsSkipped;
  return {
    ...t,
    setsDoneShare: t.setsPlanned ? t.setsDone / t.setsPlanned : null,
    setsDoneOfRecorded: rec ? t.setsDone / rec : null,
  };
}

export function blockCompliance(
  planned: PlannedSet[],
  actual: ActualSet[],
  blockKey: string,
  asOf: string,
): BlockCompliance {
  const amap = new Map(actual.map((a) => [a.plannedSetId, a]));
  const rows = planned.filter((s) => !s.isWarmup && s.blockKey === blockKey && s.plannedDate <= asOf);
  const perWeek = new Map<number, ComplianceTotals>();
  const sessions = new Map<string, { week: number; n: number; done: number }>();
  let loadSum = 0;
  let loadN = 0;
  let repsSum = 0;
  let repsN = 0;
  let rpeSum = 0;
  let rpeN = 0;
  for (const s of rows) {
    const w = perWeek.get(s.weekNo) ?? empty();
    perWeek.set(s.weekNo, w);
    const ss = sessions.get(s.sessionKey) ?? { week: s.weekNo, n: 0, done: 0 };
    sessions.set(s.sessionKey, ss);
    w.setsPlanned++;
    ss.n++;
    const a = amap.get(s.id);
    if (a?.status === 'done' && a.performedOn && a.performedOn <= asOf) {
      w.setsDone++;
      ss.done++;
      if (a.kg !== null && s.plannedKg) {
        loadSum += (100 * a.kg) / s.plannedKg;
        loadN++;
      }
      if (a.reps !== null) {
        repsSum += (100 * a.reps) / s.reps;
        repsN++;
      }
      if (a.rpe !== null && s.targetRpe !== null) {
        rpeSum += a.rpe - s.targetRpe;
        rpeN++;
      }
    } else if (a?.status === 'skipped') w.setsSkipped++;
    else w.setsUnknown++;
  }
  for (const ss of sessions.values()) {
    const w = perWeek.get(ss.week) as ComplianceTotals;
    w.sessionsPlanned++;
    if (ss.done > 0) w.sessionsWithWork++;
    if (ss.done === ss.n) w.sessionsComplete++;
  }
  const weeks = [...perWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekNo, t]) => ({ weekNo, ...close(t) }));
  const total = close(
    weeks.reduce((acc, w) => {
      acc.sessionsPlanned += w.sessionsPlanned;
      acc.sessionsWithWork += w.sessionsWithWork;
      acc.sessionsComplete += w.sessionsComplete;
      acc.setsPlanned += w.setsPlanned;
      acc.setsDone += w.setsDone;
      acc.setsSkipped += w.setsSkipped;
      acc.setsUnknown += w.setsUnknown;
      return acc;
    }, empty()),
  );
  return {
    blockKey,
    weeks,
    total,
    load: { pairs: loadN, meanPct: loadN ? loadSum / loadN : null },
    reps: { pairs: repsN, meanPct: repsN ? repsSum / repsN : null },
    rpe: { pairs: rpeN, meanDiff: rpeN ? rpeSum / rpeN : null },
  };
}
