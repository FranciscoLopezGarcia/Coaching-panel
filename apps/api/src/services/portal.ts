import { suggestProgression, type ActualSet, type PlannedSet, type ProgSuggestion } from '@coaching/engine';
import { modeFrom, type AccountsRepo, type ViewMode } from '../repositories/accounts.js';
import type { AthletesRepo } from '../repositories/athletes.js';
import type { HistoryRepo } from '../repositories/history.js';
import type { ProgrammingRepo } from '../repositories/programming.js';
import type { RecordsRepo } from '../repositories/records.js';
import { NotFoundError, UnprocessableError } from './errors.js';

export type SetKind = 'warmup' | 'top' | 'backoff' | 'work';
export interface SetView {
  id: string;
  setNo: number;
  kind: SetKind;
  reps: number;
  repsMax: number | null;
  /** Solo viene lo que el coach decidió mostrar. */
  rpe: number | null;
  kg: number | null;
  kgSource: 'fixed' | 'derived' | null;
  pct: number | null;
  note: string | null;
  tempo: string | null;
  pauseSec: number | null;
  actual: { kg: number | null; reps: number | null; rpe: number | null; status: string } | null;
  /** Meta sugerida para esta serie (solo si el coach decidió mostrarla). */
  goal: { reps: number | null; kg: number | null } | null;
}
export interface ExerciseView {
  name: string;
  lift: string | null;
  priority: number | null;
  /** Qué se muestra en este ejercicio (el del ejercicio manda sobre el de la sesión). */
  mode: ViewMode;
  /** Indicaciones del coach para el ejercicio (sin repetir por serie). */
  coachNotes: string[];
  /** Frase de progresión (solo si el coach la habilitó para este ejercicio). */
  goalText: string;
  /** Lo que escribió el atleta debajo de este ejercicio. */
  athleteNote: string;
  sets: SetView[];
  previous: { date: string; sets: { kg: number | null; reps: number | null; rpe: number | null }[] } | null;
}
export interface SessionMeta {
  key: string;
  date: string;
  blockKey: string;
  weekNo: number;
  dayNo: number;
  title: string;
  exercises: string[];
  status: 'done' | 'part' | 'none';
  doneSets: number;
  totalSets: number;
}
export interface BlockInfo {
  key: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  weeks: number;
  objective: string | null;
  currentWeek: number | null;
}

/** Frase para el atleta según lo que el coach decidió mostrar (con carga solo si 'reps_kg' y la vista muestra kg). */
function goalTextFor(sg: ProgSuggestion, withKg: boolean, mode: ViewMode): string {
  const kgOk = withKg && (mode === 'completo' || mode === 'solo_carga');
  const reps = sg.sets[0]?.reps;
  const kg = sg.sets[0]?.kg;
  const parts: string[] = [];
  if (kgOk && kg) parts.push(`${String(kg).replace('.', ',')} kg`);
  if (reps) parts.push(`${reps} reps`);
  const verb =
    sg.action === 'subir_carga'
      ? 'Subí'
      : sg.action === 'bajar_carga'
        ? 'Bajá'
        : sg.action === 'mantener'
          ? 'Mantené'
          : 'Meta';
  return parts.length ? `${verb === 'Meta' ? 'Meta' : `${verb} · meta`}: ${parts.join(' × ')}` : '';
}
const round1 = (x: number) => Math.round(x * 10) / 10;
const repsMaxOf = (p: PlannedSet): number | null => {
  const m = (p.protocol as { repsMax?: number | null } | null)?.repsMax;
  return typeof m === 'number' ? m : null;
};

/** Lo que el atleta ve y hace: sus sesiones, su próximo entreno, el registro de series y el TRAC. Todo se filtra por atleta y por modo de vista. */
type Loaded = {
  planned: PlannedSet[];
  actual: Map<string, ActualSet>;
  bySession: Map<string, PlannedSet[]>;
};
export class PortalService {
  constructor(
    private athletes: AthletesRepo,
    private records: RecordsRepo,
    private programming: ProgrammingRepo,
    private history: HistoryRepo,
    private accounts: AccountsRepo,
    private today: () => string,
    private nowIso: () => string,
  ) {}

  private async load(athleteId: string) {
    // las dos lecturas son independientes: van juntas (cada ida a la base en la nube cuesta)
    const [planned, actualRows] = await Promise.all([
      this.records.listActivePlanned(athleteId),
      this.records.listActual(athleteId),
    ]);
    const actual = new Map(actualRows.map((a) => [a.plannedSetId, a]));
    const bySession = new Map<string, PlannedSet[]>();
    for (const p of planned) bySession.set(p.sessionKey, [...(bySession.get(p.sessionKey) ?? []), p]);
    return { planned, actual, bySession };
  }
  /** Progresión sugerida de cada ejercicio de una sesión (por exposición), a partir del último entreno realizado del mismo ejercicio. */
  async progression(
    athleteId: string,
    key: string,
    loaded?: Loaded,
  ): Promise<{ exposureId: string; exerciseName: string; suggestion: ProgSuggestion }[]> {
    const { planned, actual, bySession } = loaded ?? (await this.load(athleteId));
    const sets = bySession.get(key);
    if (!sets?.length) throw new NotFoundError('Esa sesión no existe');
    const date = (sets[0] as PlannedSet).plannedDate;
    const out: { exposureId: string; exerciseName: string; suggestion: ProgSuggestion }[] = [];
    const ids = [...new Set(sets.map((s) => s.exposureId))];
    for (const ex of ids) {
      const g = sets.filter((s) => s.exposureId === ex && !s.isWarmup).sort((a, b) => a.setNo - b.setNo);
      if (!g.length) continue;
      const name = (g[0] as PlannedSet).exerciseName;
      const prev = planned.filter(
        (p) =>
          p.exerciseName === name &&
          !p.isWarmup &&
          p.plannedDate < date &&
          actual.get(p.id)?.status === 'done',
      );
      const lastDate = prev
        .map((p) => p.plannedDate)
        .sort()
        .pop();
      const last = prev
        .filter((p) => p.plannedDate === lastDate)
        .sort((a, b) => a.setNo - b.setNo)
        .map((p) => ({
          kg: actual.get(p.id)?.kg ?? null,
          reps: actual.get(p.id)?.reps ?? null,
          rpe: actual.get(p.id)?.rpe ?? null,
        }));
      out.push({
        exposureId: ex,
        exerciseName: name,
        suggestion: suggestProgression(
          g.map((p) => ({ reps: p.reps, repsMax: repsMaxOf(p), rpe: p.targetRpe })),
          last,
        ),
      });
    }
    return out;
  }
  private meta(key: string, sets: PlannedSet[], actual: Map<string, ActualSet>): SessionMeta {
    const first = sets[0] as PlannedSet;
    const work = sets.filter((s) => !s.isWarmup);
    const base = work.length ? work : sets;
    const done = base.filter((s) => actual.get(s.id)?.status === 'done').length;
    const names = [...new Set(sets.map((s) => s.exerciseName))];
    const main = [...sets]
      .filter((s) => s.priority != null)
      .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9))[0];
    return {
      key,
      date: first.plannedDate,
      blockKey: first.blockKey,
      weekNo: first.weekNo,
      dayNo: first.dayNo,
      title: main?.exerciseName ?? names[0] ?? 'Entrenamiento',
      exercises: names,
      status: done === 0 ? 'none' : done >= base.length ? 'done' : 'part',
      doneSets: done,
      totalSets: base.length,
    };
  }
  private async allMeta(athleteId: string): Promise<SessionMeta[]> {
    return this.metas(await this.load(athleteId));
  }
  private metas({ bySession, actual }: Loaded): SessionMeta[] {
    return [...bySession.entries()]
      .map(([k, s]) => this.meta(k, s, actual))
      .sort((a, b) => a.date.localeCompare(b.date) || a.dayNo - b.dayNo);
  }
  private async block(
    athleteId: string,
    blockKey: string,
    currentWeek: number | null,
    ctx?: { planned: PlannedSet[]; mesos: Awaited<ReturnType<ProgrammingRepo['listMesos']>> },
  ): Promise<BlockInfo> {
    const mesos = ctx?.mesos ?? (await this.programming.listMesos(athleteId));
    const m = mesos.find((x) => x.blockKey === blockKey);
    const sets = (ctx?.planned ?? (await this.records.listActivePlanned(athleteId))).filter(
      (p) => p.blockKey === blockKey,
    );
    const dates = sets.map((s) => s.plannedDate).sort();
    return {
      key: blockKey,
      name: m?.name ?? blockKey,
      startDate: m?.startDate ?? dates[0] ?? null,
      endDate: m?.endDate ?? dates[dates.length - 1] ?? null,
      weeks: Math.max(0, ...sets.map((s) => s.weekNo)),
      objective: m?.objective ?? null,
      currentWeek,
    };
  }
  private nextOf(all: SessionMeta[]): SessionMeta | null {
    const t = this.today();
    return (
      all.find((s) => s.status !== 'done' && s.date >= t) ?? all.find((s) => s.status !== 'done') ?? null
    );
  }

  async home(athleteId: string) {
    const [a, loaded, checks, mesos] = await Promise.all([
      this.athletes.get(athleteId),
      this.load(athleteId),
      this.records.listCheckIns(athleteId),
      this.programming.listMesos(athleteId),
    ]);
    if (!a) throw new NotFoundError('Atleta inexistente');
    const all = this.metas(loaded);
    const t = this.today();
    const todays = all.filter((s) => s.date === t);
    const session = todays.find((s) => s.status !== 'done') ?? todays[0] ?? null;
    const next = this.nextOf(all);
    const focus = session ?? next;
    const todayCheck = checks.find((c) => c.date === t) ?? null;
    return {
      athlete: { id: a.id, name: a.name },
      today: t,
      session,
      todaysCount: todays.length,
      next,
      block: focus
        ? await this.block(athleteId, focus.blockKey, focus.weekNo, { planned: loaded.planned, mesos })
        : null,
      trac: { doneToday: !!todayCheck, today: todayCheck, recent: checks.slice(-14) },
    };
  }
  async plan(athleteId: string) {
    const loaded = await this.load(athleteId);
    const all = this.metas(loaded);
    const mesos = await this.programming.listMesos(athleteId);
    const keys = [...new Set(all.map((s) => s.blockKey))];
    const blocks = (
      await Promise.all(
        keys.map(async (k) => {
          const ss = all.filter((s) => s.blockKey === k);
          const weeks = [...new Set(ss.map((s) => s.weekNo))].sort((x, y) => x - y);
          return {
            ...(await this.block(athleteId, k, null, { planned: loaded.planned, mesos })),
            weeksList: weeks.map((w) => ({ weekNo: w, sessions: ss.filter((s) => s.weekNo === w) })),
            first: ss[0]?.date ?? '',
          };
        }),
      )
    ).sort((x, y) => x.first.localeCompare(y.first));
    return { today: this.today(), next: this.nextOf(all), blocks };
  }
  async next(athleteId: string) {
    return { next: this.nextOf(await this.allMeta(athleteId)) };
  }
  async hasSession(athleteId: string, key: string): Promise<boolean> {
    return !!(await this.load(athleteId)).bySession.get(key)?.length;
  }
  async session(athleteId: string, key: string) {
    // una sola lectura del plan y de lo hecho; el resto (independiente) se pide en paralelo
    const loaded = await this.load(athleteId);
    const { actual, bySession } = loaded;
    const sets = bySession.get(key);
    if (!sets?.length) throw new NotFoundError('Esa sesión no existe');
    const [settings, notes, mesos, feedback] = await Promise.all([
      this.accounts.viewSettings(athleteId),
      this.accounts.notes(athleteId, key),
      this.programming.listMesos(athleteId),
      this.history.listFeedback(athleteId),
    ]);
    const mode: ViewMode = modeFrom(settings, key);
    const meta = this.meta(key, sets, actual);
    const past = loaded.planned.filter((p) => p.plannedDate < meta.date);
    const myNotes = new Map(notes.map((n) => [n.exerciseName, n.note]));
    const groups = new Map<string, PlannedSet[]>();
    for (const s of sets) groups.set(s.exposureId, [...(groups.get(s.exposureId) ?? []), s]);
    const prog = new Map(
      (await this.progression(athleteId, key, loaded)).map((x) => [x.exposureId, x.suggestion]),
    );
    const exercises: ExerciseView[] = await Promise.all(
      [...groups.values()].map(async (g) => {
        const first = g[0] as PlannedSet;
        const show = g.map((s) => s.protocol?.athleteProgression).find((m) => !!m) ?? null;
        const sg = show ? prog.get(first.exposureId) : undefined;
        const goalSets = sg && sg.action !== 'sin_datos' ? sg.sets : null;
        const exMode: ViewMode =
          (g.map((s) => s.protocol?.athleteView).find((m) => !!m) as ViewMode | undefined) ??
          modeFrom(settings, key, first.lift);
        const prevSets = past
          .filter((p) => p.exerciseName === first.exerciseName && actual.get(p.id)?.status === 'done')
          .sort((x, y) => y.plannedDate.localeCompare(x.plannedDate) || x.setNo - y.setNo);
        const prevDate = prevSets[0]?.plannedDate;
        return {
          name: first.exerciseName,
          lift: first.lift,
          priority:
            g
              .map((s) => s.priority)
              .filter((p): p is number => p != null)
              .sort()[0] ?? null,
          mode: exMode,
          goalText: goalSets && sg ? goalTextFor(sg, show === 'reps_kg', exMode) : '',
          coachNotes: [
            ...new Set(
              g
                .map((s) => s.protocol?.instructions?.trim() ?? '')
                .filter((n) => n && !/^reps \d+[–-]\d+ \(rango/.test(n)),
            ),
          ],
          athleteNote: myNotes.get(first.exerciseName) ?? '',
          sets: [...g]
            .sort((x, y) => x.setNo - y.setNo)
            .map((p, i) => {
              const eff = [...g].filter((x) => !x.isWarmup).sort((x, y) => x.setNo - y.setNo);
              const idx = eff.findIndex((x) => x.id === p.id);
              const gs = goalSets && idx >= 0 ? (goalSets[Math.min(idx, goalSets.length - 1)] ?? null) : null;
              void i;
              const showKg = show === 'reps_kg' && (exMode === 'completo' || exMode === 'solo_carga');
              return this.view(
                p,
                actual.get(p.id),
                exMode,
                gs ? { reps: gs.reps, kg: showKg ? gs.kg : null } : null,
              );
            }),
          previous: prevDate
            ? {
                date: prevDate,
                sets: prevSets
                  .filter((p) => p.plannedDate === prevDate)
                  .map((p) => ({
                    kg: actual.get(p.id)?.kg ?? null,
                    reps: actual.get(p.id)?.reps ?? null,
                    rpe: actual.get(p.id)?.rpe ?? null,
                  })),
              }
            : null,
        };
      }),
    );
    const fb = feedback.find((f) => f.sessionKey === key);
    return {
      ...meta,
      mode,
      block: await this.block(athleteId, meta.blockKey, meta.weekNo, { planned: loaded.planned, mesos }),
      exercises,
      endFatigue: fb?.endFatigue ?? null,
    };
  }
  private view(
    p: PlannedSet,
    a: ActualSet | undefined,
    mode: ViewMode,
    goal: { reps: number | null; kg: number | null } | null = null,
  ): SetView {
    const showKg = mode === 'completo' || mode === 'solo_carga';
    const showRpe = mode !== 'solo_carga';
    const showPct = mode === 'completo' || mode === 'rpe_porcentaje';
    const pct = p.protocol?.pct ?? (p.plannedKg && p.refKg ? round1((p.plannedKg / p.refKg) * 100) : null);
    const seg = p.protocol?.segment;
    return {
      id: p.id,
      setNo: p.setNo,
      kind: p.isWarmup ? 'warmup' : seg === 'top' ? 'top' : seg === 'backoff' ? 'backoff' : 'work',
      reps: p.reps,
      repsMax: repsMaxOf(p),
      rpe: showRpe ? p.targetRpe : null,
      kg: showKg ? p.plannedKg : null,
      kgSource: showKg ? p.plannedKgSource : null,
      pct: showPct ? pct : null,
      note: p.protocol?.instructions ?? null,
      tempo: p.protocol?.tempo ?? null,
      pauseSec: p.protocol?.pauseSec ?? null,
      actual: a ? { kg: a.kg, reps: a.reps, rpe: a.rpe, status: a.status } : null,
      goal,
    };
  }
  /** Registra o corrige UNA serie del propio atleta. */
  async logSet(
    athleteId: string,
    b: {
      plannedSetId: string;
      status: 'done' | 'pending' | 'skipped';
      kg: number | null;
      reps: number | null;
      rpe: number | null;
      pain?: number | null;
    },
  ) {
    if (!(await this.records.listActivePlanned(athleteId)).some((p) => p.id === b.plannedSetId))
      throw new UnprocessableError('Esa serie no existe en tu plan.');
    await this.records.upsertActual(
      athleteId,
      [
        {
          plannedSetId: b.plannedSetId,
          status: b.status,
          kg: b.kg,
          reps: b.reps,
          rpe: b.rpe,
          performedOn: b.status === 'pending' ? null : this.today(),
          pain: b.pain ?? null,
        },
      ],
      this.nowIso(),
      'Registrado por el atleta',
    );
    return { ok: true };
  }
  async finish(athleteId: string, key: string, endFatigue: number | null, note?: string) {
    if (!(await this.load(athleteId)).bySession.has(key)) throw new NotFoundError('Esa sesión no existe');
    await this.history.upsertFeedback(athleteId, { sessionKey: key, endFatigue, note });
    return { ok: true };
  }
}
