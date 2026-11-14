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

  /** Solo el perfil (parámetros y ejercicios de competencia): para pantallas que no necesitan las series. */
  async loadProfile(
    athleteId: string,
  ): Promise<{ params: EngineParams; competitionExercises: Partial<Record<Lift, string>> }> {
    const athlete = await this.athletes.get(athleteId);
    if (!athlete) throw new NotFoundError('Atleta inexistente');
    return { params: toEngineParams(athlete.params), competitionExercises: athlete.competitionExercises };
  }

  private inflight = new Map<string, Promise<AthleteData>>();

  /**
   * `cutoff` recorta lo ejecutado/observado (sin fuga de futuro). La programación se carga completa.
   * Si ya hay una carga idéntica en curso (una pantalla dispara varios endpoints a la vez), se comparte: cuando termina, se descarta,
   * así que nunca se sirven datos viejos. El resultado es de solo lectura.
   */
  load(athleteId: string, cutoff?: string): Promise<AthleteData> {
    const key = `${athleteId}|${cutoff ?? ''}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.loadNow(athleteId, cutoff).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async loadNow(athleteId: string, cutoff?: string): Promise<AthleteData> {
    const athlete = await this.athletes.get(athleteId);
    if (!athlete) throw new NotFoundError('Atleta inexistente');
    const top = cutoff ?? '9999-12-31';
    // Consultas independientes en paralelo: contra Turso cada ida y vuelta cuesta, y en serie se sumaban.
    const [
      checkIns,
      links,
      plannedRaw,
      actual,
      activeIdList,
      observedExtra,
      feedback,
      reviews,
      references,
      interventions,
      events,
      macros,
      mesos,
      micros,
    ] = await Promise.all([
      this.records.listCheckIns(athleteId),
      this.programming.links(athleteId),
      this.records.listPlanned(athleteId),
      this.records.listActual(athleteId),
      this.records.listActivePlannedIds(athleteId),
      this.observed.list(athleteId, { to: top }),
      this.history.listFeedback(athleteId),
      this.history.listReviews(athleteId),
      this.references.list(athleteId),
      this.interventions.list(athleteId),
      this.history.listEvents(athleteId),
      this.programming.listMacros(athleteId),
      this.programming.listMesos(athleteId),
      this.programming.listMicros(athleteId),
    ]);
    const readinessHistory: Readiness[] = [];
    for (const c of checkIns) {
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
    const map = new Map(links.map((l) => [l.from, l.to]));
    // Un vínculo EXPLÍCITO reasigna la identidad de exposición; sin vínculo no se infiere nada.
    const planned = plannedRaw.map((s) =>
      map.has(s.exposureId) ? { ...s, exposureId: map.get(s.exposureId) as string } : s,
    );
    const activeIds = new Set(activeIdList);
    const retiredIds = new Set(planned.filter((x) => !activeIds.has(x.id)).map((x) => x.id));
    return {
      athlete,
      params: toEngineParams(athlete.params),
      families: familiesOf(athlete.params),
      planned,
      retiredIds,
      actual,
      observed: [...observedFromPlan(planned, actual, top), ...observedExtra],
      readinessHistory,
      feedback,
      reviews,
      references,
      interventions,
      events,
      macros,
      mesos,
      micros,
      competitionExercises: athlete.competitionExercises,
      appliedLinks: links.map((l) => ({ from: l.from, to: l.to })),
    };
  }
}
