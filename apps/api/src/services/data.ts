import {
  readinessOf,
  type ActualSet,
  type ChangeEvent,
  type CoachReview,
  type EngineParams,
  type FamilyMeta,
  type Intervention,
  type Lift,
  type MacroMeta,
  type MesoMeta,
  type MicroMeta,
  type ObservedSet,
  type PlannedSet,
  type Readiness,
  type SessionFeedback,
  type StrengthReference,
  observedFromPlan,
} from '@coaching/engine';
import type { AthleteRow, AthletesRepo } from '../repositories/athletes.js';
import type { HistoryRepo } from '../repositories/history.js';
import type { InterventionsRepo } from '../repositories/interventions.js';
import type { ObservedRepo } from '../repositories/observed.js';
import type { ProgrammingRepo } from '../repositories/programming.js';
import type { RecordsRepo } from '../repositories/records.js';
import type { ReferencesRepo } from '../repositories/references.js';
import { NotFoundError } from './errors.js';
import { familiesOf, toEngineParams } from './params.js';

/** Todo lo que el motor necesita de un atleta, leído de la DB en una sola pasada (sin escribir nada). */
export interface AthleteData {
  athlete: AthleteRow;
  params: EngineParams;
  families: Record<string, FamilyMeta>;
  planned: PlannedSet[];
  /** Series que ya no están en la programación vigente pero se conservan por tener ejecución. */
  retiredIds: Set<string>;
  actual: ActualSet[];
  /** Observaciones ejecutadas con prescripción (plan) + las importadas sin ella (p. ej. Hevy). Las fuentes NO se deduplican entre sí. */
  observed: ObservedSet[];
  readinessHistory: Readiness[];
  feedback: SessionFeedback[];
  reviews: CoachReview[];
  references: StrengthReference[];
  interventions: Intervention[];
  events: ChangeEvent[];
  macros: MacroMeta[];
  mesos: MesoMeta[];
  micros: MicroMeta[];
  competitionExercises: Partial<Record<Lift, string>>;
  /** Vínculos explícitos de identidad aplicados al plan (from → to). */
  appliedLinks: { from: string; to: string }[];
}

export class DataLoader {
  constructor(
    private athletes: AthletesRepo,
    private records: RecordsRepo,
    private history: HistoryRepo,
    private observed: ObservedRepo,
    private references: ReferencesRepo,
    private interventions: InterventionsRepo,
    private programming: ProgrammingRepo,
  ) {}

  /** `cutoff` recorta lo ejecutado/observado (sin fuga de futuro). La programación se carga completa. */
  load(athleteId: string, cutoff?: string): AthleteData {
    const athlete = this.athletes.get(athleteId);
    if (!athlete) throw new NotFoundError('Atleta inexistente');
    const readinessHistory: Readiness[] = [];
    for (const c of this.records.listCheckIns(athleteId)) {
      const value = readinessOf({
        date: c.date,
        sleep: c.sleep,
        energy: c.energy,
        motivation: c.motivation,
        stress: c.stress,
        pain: c.pain,
      });
      if (value !== null) readinessHistory.push({ date: c.date, value });
    }
    const links = this.programming.links(athleteId);
    const map = new Map(links.map((l) => [l.from, l.to]));
    // Un vínculo EXPLÍCITO reasigna la identidad de exposición; sin vínculo no se infiere nada.
    const planned = this.records
      .listPlanned(athleteId)
      .map((s) => (map.has(s.exposureId) ? { ...s, exposureId: map.get(s.exposureId) as string } : s));
    const actual = this.records.listActual(athleteId);
    const activeIds = new Set(this.records.listActivePlanned(athleteId).map((x) => x.id));
    const retiredIds = new Set(planned.filter((x) => !activeIds.has(x.id)).map((x) => x.id));
    const top = cutoff ?? '9999-12-31';
    return {
      athlete,
      params: toEngineParams(athlete.params),
      families: familiesOf(athlete.params),
      planned,
      retiredIds,
      actual,
      observed: [...observedFromPlan(planned, actual, top), ...this.observed.list(athleteId, { to: top })],
      readinessHistory,
      feedback: this.history.listFeedback(athleteId),
      reviews: this.history.listReviews(athleteId),
      references: this.references.list(athleteId),
      interventions: this.interventions.list(athleteId),
      events: this.history.listEvents(athleteId),
      macros: this.programming.listMacros(athleteId),
      mesos: this.programming.listMesos(athleteId),
      micros: this.programming.listMicros(athleteId),
      competitionExercises: athlete.competitionExercises,
      appliedLinks: links.map((l) => ({ from: l.from, to: l.to })),
    };
  }
}
