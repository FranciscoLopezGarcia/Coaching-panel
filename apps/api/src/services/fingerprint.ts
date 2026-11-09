import { fingerprintText, knownAt } from '@coaching/engine';
import type { HistoryRepo } from '../repositories/history.js';
import type { DataLoader } from './data.js';

/**
 * Huella de las ENTRADAS que usa una evaluación a un corte (lo conocido a esa fecha): programación, ejecución, cuestionarios, revisiones,
 * cambios, referencias y parámetros. Si cambia después de evaluar, la evaluación guardada quedó desactualizada (ediciones desde cualquier cliente).
 */
export function inputsFingerprint(
  loader: DataLoader,
  history: HistoryRepo | undefined,
  athleteId: string,
  cutoff: string,
): string {
  const d = loader.load(athleteId, cutoff);
  const k = knownAt(
    {
      plannedSets: d.planned,
      actualSets: d.actual,
      snapshots: history?.listVersions(athleteId),
      sessionFeedback: d.feedback,
      coachReviews: d.reviews,
      changeEvents: d.events,
    },
    cutoff,
  );
  const payload = {
    planned: k.plannedSets.map((s) => [
      s.id,
      s.plannedDate,
      s.plannedKg,
      s.reps,
      s.targetRpe,
      s.isWarmup,
      s.exposureId,
      s.variantKey,
      s.refKg,
      s.protocol,
    ]),
    actual: [...k.actualSets]
      .sort((a, b) => (a.plannedSetId < b.plannedSetId ? -1 : 1))
      .map((a) => [a.plannedSetId, a.status, a.kg, a.reps, a.rpe, a.performedOn, a.pain]),
    readiness: d.readinessHistory.filter((r) => r.date <= cutoff).map((r) => [r.date, r.value]),
    feedback: k.sessionFeedback.map((f) => [f.sessionKey, f.endFatigue]),
    reviews: k.coachReviews.map((r) => [r.lift, r.date, r.verdict]),
    events: k.changeEvents.map((e) => e.id),
    refs: d.references.filter((r) => r.asOf <= cutoff).map((r) => [r.id, r.exerciseName, r.kg, r.asOf]),
    params: d.params,
    families: d.families,
  };
  return fingerprintText(JSON.stringify(payload));
}
