import type { ChangeEvent } from './diff.js';
import type { PlanSnapshot } from './snapshot.js';
import type { ActualSet, CoachReview, PlannedSet, SessionFeedback } from './types.js';

export interface KnownAtInput {
  /** Plan completo actual (con identidades vinculadas y series retiradas con ejecución). */
  plannedSets: PlannedSet[];
  actualSets: ActualSet[];
  snapshots?: PlanSnapshot[];
  sessionFeedback?: SessionFeedback[];
  coachReviews?: CoachReview[];
  changeEvents?: ChangeEvent[];
}

export interface KnownAt {
  plannedSets: PlannedSet[];
  actualSets: ActualSet[];
  sessionFeedback: SessionFeedback[];
  coachReviews: CoachReview[];
  changeEvents: ChangeEvent[];
  knowledge: 'snapshot' | 'plan_completo_asumido';
  snapshotId: string | null;
  /** Series previstas posteriores al corte que NO se usan (publicadas después o sin ejecución conocida). */
  excludedPlanned: number;
}

/**
 * Lo conocido a una fecha de corte (sin fuga de futuro):
 *  - Programación: la última versión APLICADA con `detectedOn ≤ corte`. Cada serie toma su contenido de esa versión (no el actual),
 *    conservando la identidad de exposición vigente (vínculos explícitos). Series con ejecución ≤ corte se conservan aunque no estén en la versión.
 *  - Ejecución, cuestionarios de sesión, revisiones técnicas y cambios detectados: solo hasta el corte.
 * Sin versiones guardadas (datos migrados) se asume el plan completo y se informa.
 */
export function knownAt(inp: KnownAtInput, cutoff: string): KnownAt {
  const actualSets = inp.actualSets.filter((a) => !a.performedOn || a.performedOn <= cutoff);
  const sessionDate = new Map(inp.plannedSets.map((s) => [s.sessionKey, s.plannedDate]));
  const sessionFeedback = (inp.sessionFeedback ?? []).filter(
    (f) => (sessionDate.get(f.sessionKey) ?? '9999') <= cutoff,
  );
  const coachReviews = (inp.coachReviews ?? []).filter((r) => r.date <= cutoff);
  const changeEvents = (inp.changeEvents ?? []).filter((e) => e.detectedOn <= cutoff);
  const applied = (inp.snapshots ?? []).filter((s) => s.status === 'aplicado');
  if (!applied.length)
    return {
      plannedSets: inp.plannedSets,
      actualSets,
      sessionFeedback,
      coachReviews,
      changeEvents,
      knowledge: 'plan_completo_asumido',
      snapshotId: null,
      excludedPlanned: 0,
    };
  const snap = applied.filter((s) => s.detectedOn <= cutoff).sort((a, b) => b.seq - a.seq)[0];
  const current = new Map(inp.plannedSets.map((s) => [s.id, s]));
  const doneBefore = new Set(
    actualSets.filter((a) => a.status === 'done' && a.performedOn).map((a) => a.plannedSetId),
  );
  const out = new Map<string, PlannedSet>();
  for (const s of snap?.sets ?? [])
    out.set(s.id, { ...s, exposureId: current.get(s.id)?.exposureId ?? s.exposureId });
  for (const id of doneBefore) {
    const c = current.get(id);
    if (c && !out.has(id)) out.set(id, c);
  }
  const plannedSets = [...out.values()].sort((a, b) =>
    a.plannedDate < b.plannedDate ? -1 : a.plannedDate > b.plannedDate ? 1 : a.setNo - b.setNo,
  );
  return {
    plannedSets,
    actualSets: actualSets.filter((a) => out.has(a.plannedSetId)),
    sessionFeedback,
    coachReviews,
    changeEvents,
    knowledge: 'snapshot',
    snapshotId: snap?.id ?? null,
    excludedPlanned: inp.plannedSets.filter((s) => !out.has(s.id)).length,
  };
}
