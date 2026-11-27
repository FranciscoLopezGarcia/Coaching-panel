import {
  buildBlockExport,
  knownAt,
  orderedBlocks,
  readinessOf,
  type BlockExportInput,
  type ExportSelection,
} from '@coaching/engine';
import type { AccountsRepo } from '../repositories/accounts.js';
import type { DecisionsRepo } from '../repositories/decisions.js';
import type { HistoryRepo } from '../repositories/history.js';
import type { RecordsRepo } from '../repositories/records.js';
import type { CoachExtrasService } from './coach-extras.js';
import type { DataLoader } from './data.js';
import { NotFoundError } from './errors.js';

export interface BlockExportOptions {
  selection: ExportSelection[];
  asOf: string;
  today: string;
  generatedAt: string;
  /** Quita el nombre, la fecha de nacimiento y los lugares. Los textos libres quedan tal como se escribieron. */
  anonymous: boolean;
}

const ageAt = (birth: string, on: string) =>
  Number(on.slice(0, 4)) - Number(birth.slice(0, 4)) - (on.slice(5) < birth.slice(5) ? 1 : 0);

/** Junta lo que el exportador necesita de un atleta. SOLO LECTURA; no incluye accesos, correos ni contraseñas. */
export class BlockExportService {
  constructor(
    private loader: DataLoader,
    private records: RecordsRepo,
    private history: HistoryRepo,
    private accounts: AccountsRepo,
    private decisions: DecisionsRepo,
    private extras: CoachExtrasService,
  ) {}

  async build(athleteId: string, o: BlockExportOptions) {
    const d = await this.loader.load(athleteId, o.asOf);
    const [versions, finishes, notes, checkins, checkinExtras, profile, competitions, decisions] =
      await Promise.all([
        this.history.listVersions(athleteId),
        this.history.listFinishes(athleteId),
        this.accounts.notes(athleteId),
        this.records.listCheckIns(athleteId),
        this.records.listCheckInExtras(athleteId),
        this.extras.profile(athleteId),
        this.extras.competitions(athleteId),
        this.decisions.list(athleteId),
      ]);
    const k = knownAt(
      {
        plannedSets: d.planned,
        actualSets: d.actual,
        snapshots: versions,
        coachReviews: d.reviews,
        changeEvents: d.events,
      },
      o.asOf,
    );
    // Al corte de hoy vale el plan tal como está (con las indicaciones más recientes); a un corte pasado, el conocido entonces.
    const current = o.asOf >= o.today;
    const planned = current ? d.planned : k.plannedSets;
    const available = new Set(orderedBlocks(planned, o.asOf).map((b) => b.blockKey));
    const weeks = new Set(planned.map((s) => `${s.weekNo}:${s.blockKey}`));
    const unknown = o.selection.flatMap((s) =>
      !available.has(s.blockKey)
        ? [s.blockKey]
        : (s.weeks ?? []).filter((n) => !weeks.has(`${n}:${s.blockKey}`)).map((n) => `${s.blockKey} S${n}`),
    );
    if (unknown.length) throw new NotFoundError(`No hay series programadas en: ${unknown.join(', ')}`);
    const extrasByDate = new Map(checkinExtras.map((e) => [e.date, e]));
    const input: BlockExportInput = {
      asOf: o.asOf,
      generatedAt: o.generatedAt,
      selection: o.selection,
      planned,
      retiredIds: d.retiredIds,
      actual: current ? d.actual : k.actualSets,
      unplanned: d.observed.filter((x) => x.plannedSetId === null),
      feedback: finishes,
      exerciseNotes: notes,
      checkins: checkins.map((c) => {
        const x = extrasByDate.get(c.date);
        return {
          ...c,
          readiness: readinessOf(c),
          soreness: x?.soreness ?? null,
          confidence: x?.confidence ?? null,
          sleepHours: x?.sleepHours ?? null,
          bodyweightKg: x?.bodyweightKg ?? null,
          note: x?.note ?? '',
        };
      }),
      reviews: k.coachReviews,
      changeEvents: k.changeEvents,
      mesos: d.mesos,
      macros: d.macros,
      micros: d.micros,
      zoneCuts: d.athlete.params.intensityCuts,
    };
    const { guia, bloques, ...head } = buildBlockExport(input);
    const { birthDate, updatedAt: _updatedAt, ...rest } = profile;
    void _updatedAt;
    return {
      ...head,
      guia,
      atleta: {
        nombre: o.anonymous ? null : d.athlete.name,
        edad: birthDate ? ageAt(birthDate, o.asOf) : null,
        ...(o.anonymous ? {} : { fechaNacimiento: birthDate }),
        perfil: rest,
        ejerciciosDeCompetencia: d.competitionExercises,
      },
      referenciasDeFuerza: d.references
        .filter((r) => r.asOf <= o.asOf)
        .map((r) => ({
          ejercicio: r.exerciseName,
          kg: r.kg,
          fuente: r.source,
          fecha: r.asOf,
          nota: r.note,
        })),
      competencias: competitions.map((c) => {
        const happened = c.date <= o.asOf;
        return {
          nombre: c.name,
          fecha: c.date,
          fase: c.phase,
          lugar: o.anonymous ? null : c.location,
          categoria: c.weightClass,
          pesoCorporalKg: happened ? c.bodyweightKg : null,
          notasCoach: c.notes,
          mejores: happened ? c.best : null,
          total: happened ? c.total : null,
          intentos: c.attempts.map((a) => ({
            movimiento: a.lift,
            intento: a.attemptNo,
            previstoKg: a.plannedKg,
            realKg: happened ? a.actualKg : null,
            resultado: happened ? a.result : null,
            nota: a.note,
          })),
        };
      }),
      /** Propuestas del sistema sobre las que el coach decidió o escribió algo. */
      decisionesCoach: decisions
        .filter((x) => (x.coachNote || x.decidedOn) && (x.decidedOn || x.evaluatedOn) <= o.asOf)
        .map((x) => ({
          fecha: x.decidedOn || x.evaluatedOn,
          movimiento: x.lift,
          regla: x.ruleId,
          hallazgo: x.summary,
          propuesta: x.proposal,
          estado: x.lifecycle,
          notaCoach: x.coachNote || null,
        })),
      bloques,
    };
  }
}
