import type { AttemptInput, CompetitionInput, ProfileInput } from '@coaching/contracts';
import { shiftIsoDate as addDays, daysBetween, e1rm, type Lift } from '@coaching/engine';
import type { AthletesRepo } from '../repositories/athletes.js';
import type { CompetitionRow, HistoryRepo } from '../repositories/history.js';
import type { RecordsRepo } from '../repositories/records.js';
import type { ExtrasRepo } from '../repositories/extras.js';
import { NotFoundError } from './errors.js';

const LIFTS: Lift[] = ['SQ', 'BP', 'DL'];
const slug = (s: string) => s.trim().toLowerCase();

export interface CompetitionView extends CompetitionRow {
  /** Días hasta la fecha (negativo = ya pasó). */
  daysLeft: number;
  attempts: (AttemptInput & { competitionId: string })[];
  /** Mejor intento VÁLIDO por movimiento y total (solo si hay un válido en los tres movimientos). */
  best: Partial<Record<Lift, number>>;
  total: number | null;
}
export interface LiftMarks {
  lift: Lift;
  competition: { kg: number; date: string; competition: string } | null;
  /** Mayor carga hecha en la variante de competencia (serie real con carga y repeticiones). */
  trainingHeaviest: { kg: number; reps: number; date: string } | null;
  /** Mayor carga hecha a 1 repetición en la variante de competencia. */
  trainingSingle: { kg: number; date: string } | null;
  /** Mejor e1RM con RPE real (curva RTS) en la variante de competencia. */
  trainingE1rm: { kg: number; date: string } | null;
  /** Competencia − mejor single de entrenamiento (descriptivo: no dice cuál es «mejor»). */
  diffKg: number | null;
}
export interface AgendaSession {
  sessionKey: string;
  date: string;
  exercises: string[];
  setsPlanned: number;
  setsDone: number;
  setsSkipped: number;
  /** hecha = todo hecho; parcial = algo hecho; sin_registro = fecha pasada sin ninguna serie registrada; pendiente = fecha de hoy o futura. */
  status: 'hecha' | 'parcial' | 'sin_registro' | 'pendiente';
}
export interface Agenda {
  today: string;
  week: { from: string; to: string };
  sessions: AgendaSession[];
  checkInToday: boolean;
  lastCheckIn: string | null;
  /** Series con molestia > 0 en los últimos 7 días (dato del atleta, no diagnóstico). */
  painSets7d: { count: number; max: number | null };
  nextCompetition: { name: string; date: string; daysLeft: number } | null;
}

const monday = (d: string): string => {
  const dow = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
  return addDays(d, -dow);
};

export class CoachExtrasService {
  constructor(
    private athletes: AthletesRepo,
    private records: RecordsRepo,
    private history: HistoryRepo,
    private extras: ExtrasRepo,
    private today: () => string,
    private nowIso: () => string,
  ) {}

  private async must(id: string) {
    const a = await this.athletes.get(id);
    if (!a) throw new NotFoundError('Atleta inexistente');
    return a;
  }

  async profile(id: string): Promise<ProfileInput & { updatedAt: string | null }> {
    await this.must(id);
    const p = await this.extras.getProfile(id);
    return (
      p ?? {
        birthDate: null,
        sex: null,
        bodyweightKg: null,
        weightClass: '',
        federation: '',
        equipment: null,
        trainingSince: null,
        daysPerWeek: null,
        goals: '',
        historyNotes: '',
        constraintsNotes: '',
        updatedAt: null,
      }
    );
  }
  async putProfile(id: string, p: ProfileInput): Promise<void> {
    await this.must(id);
    await this.extras.putProfile(id, p, this.nowIso());
  }

  async competitions(id: string): Promise<CompetitionView[]> {
    await this.must(id);
    const [comps, attempts] = await Promise.all([
      this.history.listCompetitions(id),
      this.extras.listAttempts(id),
    ]);
    const t = this.today();
    return comps.map((c) => {
      const at = attempts.filter((a) => a.competitionId === c.id);
      const best: Partial<Record<Lift, number>> = {};
      for (const l of LIFTS) {
        const ok = at.filter((a) => a.lift === l && a.result === 'valido' && a.actualKg !== null);
        if (ok.length) best[l] = Math.max(...ok.map((a) => a.actualKg as number));
      }
      const total = LIFTS.every((l) => best[l] !== undefined)
        ? LIFTS.reduce((acc, l) => acc + (best[l] as number), 0)
        : null;
      return { ...c, daysLeft: daysBetween(c.date, t), attempts: at, best, total };
    });
  }
  async addCompetition(id: string, c: CompetitionInput): Promise<string> {
    await this.must(id);
    return await this.history.addCompetition(id, c);
  }
  async updateCompetition(
    id: string,
    compId: string,
    patch: Partial<CompetitionInput>,
    full: (m: CompetitionInput) => CompetitionInput,
  ) {
    await this.must(id);
    const cur = (await this.history.listCompetitions(id)).find((c) => c.id === compId);
    if (!cur) throw new NotFoundError('Competencia inexistente');
    const { id: _i, athleteId: _a, ...rest } = cur;
    void [_i, _a];
    await this.history.updateCompetition(id, compId, full({ ...rest, ...patch }));
  }
  async deleteCompetition(id: string, compId: string): Promise<void> {
    await this.must(id);
    if (!(await this.history.deleteCompetition(id, compId)))
      throw new NotFoundError('Competencia inexistente');
  }
  async putAttempts(id: string, compId: string, attempts: AttemptInput[]): Promise<void> {
    await this.must(id);
    if (!(await this.history.listCompetitions(id)).some((c) => c.id === compId))
      throw new NotFoundError('Competencia inexistente');
    const seen = new Set<string>();
    for (const a of attempts) {
      const k = `${a.lift}${a.attemptNo}`;
      if (seen.has(k)) throw new Error(`Intento repetido: ${a.lift} ${a.attemptNo}`);
      seen.add(k);
    }
    await this.extras.putAttempts(
      compId,
      attempts.map((a) => ({ ...a, result: a.actualKg === null ? null : a.result })),
    );
  }

  /** Marcas de competencia vs. entrenamiento, lado a lado (no se mezclan ni se estima una a partir de la otra). */
  async marks(id: string): Promise<LiftMarks[]> {
    const a = await this.must(id);
    const [comps, sets] = await Promise.all([this.competitions(id), this.records.listDoneLiftSets(id)]);
    return LIFTS.map((lift): LiftMarks => {
      let competition: LiftMarks['competition'] = null;
      for (const c of comps) {
        const kg = c.best[lift];
        if (kg !== undefined && (!competition || kg > competition.kg))
          competition = { kg, date: c.date, competition: c.name };
      }
      const name = a.competitionExercises[lift];
      const mine = name ? sets.filter((s) => s.lift === lift && slug(s.exerciseName) === slug(name)) : [];
      let heavy: LiftMarks['trainingHeaviest'] = null;
      let single: LiftMarks['trainingSingle'] = null;
      let est: LiftMarks['trainingE1rm'] = null;
      for (const s of mine) {
        if (!heavy || s.kg > heavy.kg) heavy = { kg: s.kg, reps: s.reps, date: s.date };
        if (s.reps === 1 && (!single || s.kg > single.kg)) single = { kg: s.kg, date: s.date };
        const e = s.rpe === null ? null : e1rm(s.kg, s.reps, s.rpe);
        if (e !== null && (!est || e > est.kg)) est = { kg: e, date: s.date };
      }
      return {
        lift,
        competition,
        trainingHeaviest: heavy,
        trainingSingle: single,
        trainingE1rm: est,
        diffKg: competition && single ? competition.kg - single.kg : null,
      };
    });
  }

  /** Panel «hoy / semana» de un atleta: sesiones de la semana con su estado de registro. Solo lectura. */
  async agenda(id: string, date?: string): Promise<Agenda> {
    await this.must(id);
    const today = date ?? this.today();
    const from = monday(today);
    const to = addDays(from, 6);
    const [planned, actual, checks, comps] = await Promise.all([
      this.records.listActivePlannedBetween(id, from, to),
      this.records.listActualBetween(id, from, to),
      this.records.listCheckInsSince(id, addDays(today, -7)),
      this.history.listCompetitions(id),
    ]);
    const amap = new Map(actual.map((x) => [x.plannedSetId, x]));
    const by = new Map<string, AgendaSession>();
    for (const s of planned) {
      if (s.isWarmup) continue;
      const g = by.get(s.sessionKey) ?? {
        sessionKey: s.sessionKey,
        date: s.plannedDate,
        exercises: [],
        setsPlanned: 0,
        setsDone: 0,
        setsSkipped: 0,
        status: 'pendiente' as const,
      };
      by.set(s.sessionKey, g);
      if (!g.exercises.includes(s.exerciseName)) g.exercises.push(s.exerciseName);
      g.setsPlanned++;
      const r = amap.get(s.id);
      if (r?.status === 'done') g.setsDone++;
      else if (r?.status === 'skipped') g.setsSkipped++;
    }
    const sessions = [...by.values()]
      .map((g) => ({
        ...g,
        status: (g.setsDone === g.setsPlanned
          ? 'hecha'
          : g.setsDone > 0
            ? 'parcial'
            : g.date < today
              ? 'sin_registro'
              : 'pendiente') as AgendaSession['status'],
      }))
      .sort((x, y) => x.date.localeCompare(y.date) || x.sessionKey.localeCompare(y.sessionKey));
    const since = addDays(today, -7);
    const pains = actual
      .filter(
        (x) =>
          x.pain !== null && x.pain > 0 && x.performedOn && x.performedOn >= since && x.performedOn <= today,
      )
      .map((x) => x.pain as number);
    const next = comps.filter((c) => c.date >= today).sort((x, y) => x.date.localeCompare(y.date))[0];
    return {
      today,
      week: { from, to },
      sessions,
      checkInToday: checks.some((c) => c.date === today),
      lastCheckIn: checks.at(-1)?.date ?? null,
      painSets7d: { count: pains.length, max: pains.length ? Math.max(...pains) : null },
      nextCompetition: next
        ? { name: next.name, date: next.date, daysLeft: daysBetween(next.date, today) }
        : null,
    };
  }
}
