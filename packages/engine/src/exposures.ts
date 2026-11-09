import { daysBetween } from './dates.js';
import { e1rm } from './e1rm.js';
import { median } from './format.js';
import type { ActualSet, DataQuality, Exposure, PlannedSet } from './types.js';

export function emptyQuality(): DataQuality {
  return {
    futureIgnored: 0,
    doneWithoutDate: 0,
    setsWithoutRpe: 0,
    outsideTable: 0,
    setsWithoutTargetRpe: 0,
    sessionsWithoutRecord: 0,
  };
}

/**
 * Agrupa las series previstas del ejercicio de referencia por sesión y calcula, por exposición realizada:
 * E (mejor e1RM de tabla entre series hechas CON RPE), cumplimiento, desvío de RPE vs objetivo y reps hechas vs previstas.
 * Los registros con fecha posterior al corte se ignoran (sin fuga de futuro). Dato ausente ≠ cero.
 */
export function buildExposures(
  planned: PlannedSet[],
  actual: Map<string, ActualSet>,
  cutoff: string,
  quality: DataQuality,
): Exposure[] {
  const sessions = new Map<string, PlannedSet[]>();
  for (const s of planned) {
    if (s.isWarmup) continue;
    const arr = sessions.get(s.sessionKey) ?? [];
    arr.push(s);
    sessions.set(s.sessionKey, arr);
  }
  const out: Exposure[] = [];
  for (const [sessionKey, sets] of sessions) {
    const first = sets[0] as PlannedSet;
    let skipped = 0;
    let repsPlanned = 0;
    let repsDone = 0;
    let best: Exposure['best'] = null;
    let E: number | null = null;
    const devs: number[] = [];
    const dates: string[] = [];
    const doneIds: string[] = [];
    for (const s of sets) {
      repsPlanned += s.reps;
      const a = actual.get(s.id);
      if (!a) continue;
      if (a.performedOn && a.performedOn > cutoff) {
        quality.futureIgnored++;
        continue;
      }
      if (a.status === 'skipped') {
        skipped++;
        continue;
      }
      if (
        a.status !== 'done' ||
        !(a.kg !== null && a.kg > 0) ||
        !Number.isInteger(a.reps) ||
        (a.reps as number) <= 0
      )
        continue;
      if (!a.performedOn) {
        quality.doneWithoutDate++;
        continue;
      }
      doneIds.push(s.id);
      repsDone += a.reps as number;
      dates.push(a.performedOn);
      if (a.rpe === null) {
        quality.setsWithoutRpe++;
        continue;
      }
      const e = e1rm(a.kg, a.reps as number, a.rpe);
      if (e === null) {
        quality.outsideTable++;
        continue;
      }
      if (E === null || e > E) {
        E = e;
        best = { setId: s.id, kg: a.kg, reps: a.reps as number, rpe: a.rpe };
      }
      if (s.targetRpe !== null) devs.push(a.rpe - s.targetRpe);
      else quality.setsWithoutTargetRpe++;
    }
    if (!doneIds.length) {
      if (first.plannedDate < cutoff) quality.sessionsWithoutRecord++;
      continue;
    }
    out.push({
      sessionKey,
      exposureId: first.exposureId,
      variantKey: first.variantKey,
      location: first.slotKey,
      date: [...dates].sort().pop() as string,
      setsPlanned: sets.length,
      setsDone: doneIds.length,
      setsSkipped: skipped,
      compliance: doneIds.length / sets.length,
      repsPlanned,
      repsDone,
      e: E,
      best,
      rpeDev: devs.length ? median(devs) : null,
      doneSetIds: doneIds,
      plannedSets: sets,
    });
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

/** Próxima sesión prevista del slot, sin series hechas, desde el corte: serie con RPE objetivo explícito y mayor kg previsto. */
export function nextPlanned(
  planned: PlannedSet[],
  actual: Map<string, ActualSet>,
  cutoff: string,
  exposureId: string,
): { reps: number; rpe: number; plannedKg: number | null; date: string } | null {
  const sessions = new Map<string, { date: string; sets: PlannedSet[]; done: boolean }>();
  for (const s of planned) {
    if (s.exposureId !== exposureId || s.isWarmup) continue;
    const o = sessions.get(s.sessionKey) ?? { date: s.plannedDate, sets: [], done: false };
    o.sets.push(s);
    const a = actual.get(s.id);
    if (a?.status === 'done' && a.performedOn && a.performedOn <= cutoff) o.done = true;
    sessions.set(s.sessionKey, o);
  }
  const next = [...sessions.values()]
    .filter((o) => !o.done && daysBetween(o.date, cutoff) >= 0)
    .sort((x, y) => (x.date < y.date ? -1 : 1))[0];
  if (!next) return null;
  let best: { reps: number; rpe: number; plannedKg: number | null; date: string } | null = null;
  for (const s of next.sets) {
    if (s.targetRpe === null) continue;
    if (!best || (s.plannedKg !== null && (best.plannedKg === null || s.plannedKg > best.plannedKg))) {
      best = { reps: s.reps, rpe: s.targetRpe, plannedKg: s.plannedKg, date: next.date };
    }
  }
  return best;
}
