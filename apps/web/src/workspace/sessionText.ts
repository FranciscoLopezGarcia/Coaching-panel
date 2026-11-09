import type { SessionRow } from '@coaching/contracts';
import type { QuickSegment } from './quickSession';
import { suggestLift } from './quickSession';
import { repsMaxOf as protocolRepsMax } from './prescription';

/**
 * Sesiones como texto: serializar una sesión (o una semana) al mismo formato de la carga rápida, resumirla para las tarjetas
 * y calcular QUÉ cambió entre el texto editado y lo vigente para generar solo las operaciones necesarias.
 * Principio: lo que no cambia no se toca (conserva ids y ejecución); un cambio de valores en el mismo número de series
 * usa «change_protocol»; agregar/quitar series reemplaza solo ese ejercicio.
 */
const VIEW_SHORT: Record<string, string> = {
  completo: 'kg y RPE',
  solo_rpe: 'solo RPE',
  solo_carga: 'solo carga',
  rpe_porcentaje: 'RPE y %',
};
export type SetRow = SessionRow['sets'][number];
export interface ExGroup {
  name: string;
  lift: SetRow['lift'];
  priority: number | null;
  exposureId: string;
  sets: SetRow[];
}
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
const repsMaxOf = (s: SetRow) => protocolRepsMax(s.protocol) ?? null;
const rangoAuto = /^reps \d+[–-]\d+ \(rango/;
const noteOf = (s: SetRow) =>
  s.protocol?.instructions && !rangoAuto.test(s.protocol.instructions) ? s.protocol.instructions : '';

export function groupByExercise(sets: SetRow[]): ExGroup[] {
  const map = new Map<string, ExGroup>();
  for (const s of sets.filter((x) => !x.retired)) {
    const g = map.get(s.exerciseName) ?? {
      name: s.exerciseName,
      lift: s.lift,
      priority: s.priority,
      exposureId: s.exposureId,
      sets: [],
    };
    if (s.priority != null && (g.priority === null || s.priority < g.priority)) g.priority = s.priority;
    g.sets.push(s);
    map.set(s.exerciseName, g);
  }
  for (const g of map.values()) g.sets.sort((a, b) => a.setNo - b.setNo);
  return [...map.values()];
}

interface Run {
  sets: SetRow[];
}
/** Parte las series de un ejercicio en tramos consecutivos con las mismas reps/rango/tipo. */
function runs(sets: SetRow[]): Run[] {
  const out: Run[] = [];
  for (const s of sets) {
    const last = out[out.length - 1];
    const l = last?.sets[0];
    if (
      last &&
      l &&
      l.planned.reps === s.planned.reps &&
      same(repsMaxOf(l), repsMaxOf(s)) &&
      (l.protocol?.segment ?? 'work') === (s.protocol?.segment ?? 'work') &&
      l.isWarmup === s.isWarmup &&
      (l.planned.kg === null) === (s.planned.kg === null) &&
      (l.planned.targetRpe === null) === (s.planned.targetRpe === null)
    )
      last.sets.push(s);
    else out.push({ sets: [s] });
  }
  return out;
}
const uniq = (xs: (number | null)[]) => new Set(xs).size;
function blockText(r: Run, withTags: boolean): string[] {
  const s0 = r.sets[0] as SetRow;
  const kgs = r.sets.map((s) => s.planned.kg);
  const rpes = r.sets.map((s) => s.planned.targetRpe);
  // si varían a la vez cargas y RPE, un bloque por serie
  if (uniq(kgs) > 1 && uniq(rpes) > 1) return r.sets.flatMap((s) => blockText({ sets: [s] }, withTags));
  const n = r.sets.length;
  const reps = repsMaxOf(s0) ? `${s0.planned.reps}-${repsMaxOf(s0)}` : String(s0.planned.reps);
  const kg =
    s0.planned.kg === null
      ? ''
      : `x${uniq(kgs) > 1 ? kgs.map((k) => fmt(k as number)).join('-') : fmt(s0.planned.kg)}`;
  const rpe =
    s0.planned.targetRpe === null
      ? ''
      : `@${uniq(rpes) > 1 ? rpes.map((k) => fmt(k as number)).join('-') : fmt(s0.planned.targetRpe)}`;
  const seg = s0.protocol?.segment ?? 'work';
  const tag = `${seg === 'top' ? ' top' : seg === 'backoff' ? ' backoff' : ''}${s0.isWarmup ? ' aprox' : ''}`;
  return [`${n}x${reps}${kg}${rpe}${withTags ? tag : ''}`];
}
/** Solo el protocolo de un ejercicio, en la misma notación que se escribe: «3x5@4-5-6» o «1x3x140@4 + 1x3x160@4». */
export function protocolText(g: ExGroup): string {
  return runs(g.sets)
    .flatMap((r) => blockText(r, true))
    .join(' + ');
}
/** Una línea por ejercicio: «1° Squat comp 3x5@4-5-6». */
export function exerciseLine(g: ExGroup): string {
  const blocks = runs(g.sets).flatMap((r) => blockText(r, true));
  const note = noteOf(g.sets[g.sets.length - 1] as SetRow);
  return `${g.priority ? g.priority + '° ' : ''}${g.name} ${blocks.join(' + ')}${note ? ' # ' + note : ''}`;
}
export function setsToText(sets: SetRow[]): string {
  return groupByExercise(sets).map(exerciseLine).join('\n');
}
/** Resumen corto para tarjetas: «3×5 · RPE 4-5-6», «4×7 · RPE 7», «1×5 · 100 kg». */
export function summarizeExercise(g: ExGroup): string {
  return runs(g.sets)
    .flatMap((r) => {
      const s0 = r.sets[0] as SetRow;
      const kgs = r.sets.map((s) => s.planned.kg);
      const rpes = r.sets.map((s) => s.planned.targetRpe);
      const reps = repsMaxOf(s0) ? `${s0.planned.reps}-${repsMaxOf(s0)}` : String(s0.planned.reps);
      const one = (rs: SetRow[], k: (number | null)[], p: (number | null)[]) => {
        const parts = [`${rs.length}×${reps}`];
        if (k[0] !== null)
          parts.push(
            uniq(k) > 1 ? `${k.map((x) => fmt(x as number)).join('-')} kg` : `${fmt(k[0] as number)} kg`,
          );
        if (p[0] !== null)
          parts.push(
            uniq(p) > 1 ? `RPE ${p.map((x) => fmt(x as number)).join('-')}` : `RPE ${fmt(p[0] as number)}`,
          );
        const seg = rs[0]!.protocol?.segment;
        if (seg === 'top') parts.push('top');
        if (seg === 'backoff') parts.push('backoff');
        if (rs[0]!.isWarmup) parts.push('aprox.');
        return parts.join(' · ');
      };
      if (uniq(kgs) > 1 && uniq(rpes) > 1)
        return r.sets.map((s) => one([s], [s.planned.kg], [s.planned.targetRpe]));
      return [one(r.sets, kgs, rpes)];
    })
    .join('  +  ');
}

/* ------------------------------------------------------------------ edición ------------------------------------------------------------------ */
export interface SetSpec {
  reps: number;
  repsMax: number | null;
  kg: number | null;
  rpe: number | null;
  segment: 'work' | 'top' | 'backoff';
  warmup: boolean;
  note: string;
  /** Descanso en segundos (null = sin indicar) y vista del atleta ('' = lo habitual). */
  pause: number | null;
  view: string;
  prog: string;
}
const num = (s: string) => (s ? Number(s.replace(',', '.')) : null);
/** Expande los segmentos del texto a una lista de series por ejercicio, en el orden escrito. */
export function specsByExercise(segs: QuickSegment[]): {
  name: string;
  lift: QuickSegment['lift'];
  priority: number;
  prioExplicit: boolean;
  sets: SetSpec[];
  ref: number | null;
}[] {
  const out = new Map<
    string,
    {
      name: string;
      lift: QuickSegment['lift'];
      priority: number;
      prioExplicit: boolean;
      sets: SetSpec[];
      ref: number | null;
    }
  >();
  for (const s of segs) {
    if (!s.exerciseName) continue;
    const g = out.get(s.exerciseName) ?? {
      name: s.exerciseName,
      lift: s.lift,
      priority: Number(s.priority) || 3,
      prioExplicit: s.priorityExplicit !== false,
      sets: [],
      ref: num(s.ref),
    };
    const n = Number(s.count.replace(',', '.')) || 1;
    for (let i = 0; i < n; i++)
      g.sets.push({
        reps: Number(s.reps.replace(',', '.')),
        repsMax: num(s.repsMax),
        kg: num(s.kg),
        rpe: num(s.rpe),
        segment: s.segment,
        warmup: s.warmup,
        note: s.note,
        pause: num(s.pause),
        view: s.view ?? '',
        prog: s.prog ?? '',
      });
    out.set(s.exerciseName, g);
  }
  return [...out.values()];
}

export type EditOp =
  | { kind: 'move'; label: string; sessionKey: string; date: string; weekNo: number; dayNo: number }
  | { kind: 'change'; label: string; setIds: string[]; change: Record<string, unknown> }
  | { kind: 'remove'; label: string; setIds: string[]; executed: number }
  | { kind: 'add'; label: string; sets: Record<string, unknown>[] };
export interface EditPlan {
  ops: EditOp[];
  changes: string[];
  warnings: string[];
  unchanged: number;
}
export interface SessionCtx {
  sessionKey: string;
  date: string;
  blockKey: string;
  weekNo: number;
  dayNo: number;
}
const loadMode = (kg: number | null, rpe: number | null, old?: SetRow) =>
  kg !== null
    ? 'kg'
    : old?.protocol?.loadMode === 'pct' || old?.protocol?.loadMode === 'rpe_cap'
      ? rpe !== null
        ? 'rpe'
        : 'kg'
      : rpe !== null
        ? 'rpe'
        : 'kg';

/** Construye series nuevas (como la creación de sesión) para un ejercicio. */
export function buildSets(
  ctx: SessionCtx,
  g: { name: string; lift: QuickSegment['lift']; priority: number; sets: SetSpec[]; ref: number | null },
  slotIndex: number,
  exposureId?: string,
  refKg?: number | null,
): Record<string, unknown>[] {
  return g.sets.map((s, i) => ({
    id: crypto.randomUUID(),
    sessionKey: ctx.sessionKey,
    slotKey: `${ctx.blockKey}:w${ctx.weekNo}:d${ctx.dayNo}:e${slotIndex}`,
    exposureId: exposureId ?? `${ctx.blockKey}:d${ctx.dayNo}:${g.name}:`,
    variantKey: g.name,
    exerciseName: g.name,
    lift: g.lift || null,
    plannedDate: ctx.date,
    blockKey: ctx.blockKey,
    weekNo: ctx.weekNo,
    dayNo: ctx.dayNo,
    familyKey: ctx.blockKey,
    setNo: i + 1,
    reps: s.reps,
    plannedKg: s.kg,
    targetRpe: s.rpe,
    refKg: refKg ?? g.ref ?? null,
    isWarmup: s.warmup,
    priority: g.priority,
    protocol: {
      repsMax: s.repsMax,
      loadMode: s.kg !== null ? 'kg' : s.rpe !== null ? 'rpe' : 'kg',
      segment: s.segment,
      pct: null,
      capKg: null,
      tempo: null,
      pauseSec: s.pause,
      instructions: s.note || null,
      athleteView: s.view || null,
      athleteProgression: s.prog || null,
    },
  }));
}

/**
 * Compara el texto editado con la sesión vigente. Mismo ejercicio y mismo número de series → solo se cambian los valores distintos
 * (conserva ejecución); distinto número de series o de prioridad → se reemplaza ese ejercicio; ejercicios nuevos se agregan y los
 * que ya no están se quitan. Las series con ejecución se retiran del plan pero su historia se conserva.
 */
export function planSessionEdit(
  session: Pick<SessionRow, 'sessionKey' | 'date' | 'blockKey' | 'weekNo' | 'dayNo' | 'sets'>,
  segs: QuickSegment[],
): EditPlan {
  const plan: EditPlan = { ops: [], changes: [], warnings: [], unchanged: 0 };
  const olds = groupByExercise(session.sets);
  const news = specsByExercise(segs);
  const ctx: SessionCtx = {
    sessionKey: session.sessionKey,
    date: session.date,
    blockKey: session.blockKey,
    weekNo: session.weekNo,
    dayNo: session.dayNo,
  };
  const executed = (g: ExGroup) => g.sets.filter((s) => s.actual?.status === 'done').length;
  let slot = 100;
  const replace = (o: ExGroup, n: (typeof news)[number], why: string) => {
    const ex = executed(o);
    plan.ops.push({
      kind: 'remove',
      label: `Quitar ${o.name}`,
      setIds: o.sets.map((s) => s.plannedSetId),
      executed: ex,
    });
    plan.ops.push({
      kind: 'add',
      label: `Agregar ${n.name}`,
      sets: buildSets(ctx, n, slot++, o.exposureId, o.sets[0]?.refKg ?? null),
    });
    plan.changes.push(`${n.name}: ${why}`);
    if (ex)
      plan.warnings.push(
        `${n.name}: ${ex} serie(s) con ejecución se retiran del plan vigente (su historia se conserva) y las nuevas quedan sin ejecutar.`,
      );
  };
  for (const n of news) {
    const o = olds.find((x) => x.name === n.name);
    if (!o) {
      plan.ops.push({ kind: 'add', label: `Agregar ${n.name}`, sets: buildSets(ctx, n, slot++) });
      plan.changes.push(`${n.name}: ejercicio nuevo (${n.sets.length} series)`);
      continue;
    }
    if (o.sets.length !== n.sets.length) {
      replace(o, n, `${o.sets.length} → ${n.sets.length} series`);
      continue;
    }
    if (
      (n.prioExplicit && (o.priority ?? 3) !== n.priority) ||
      o.sets.some((s, i) => s.isWarmup !== (n.sets[i] as SetSpec).warmup)
    ) {
      replace(
        o,
        n,
        n.prioExplicit && (o.priority ?? 3) !== n.priority
          ? `prioridad ${o.priority ?? '—'}° → ${n.priority}°`
          : 'cambió qué series son aproximación',
      );
      continue;
    }
    // mismo número de series: solo los valores que cambian, agrupados por contenido del cambio
    const groups = new Map<string, { ids: string[]; change: Record<string, unknown>; text: string[] }>();
    o.sets.forEach((s, i) => {
      const t = n.sets[i] as SetSpec;
      const change: Record<string, unknown> = {};
      const protocol: Record<string, unknown> = {};
      const text: string[] = [];
      if (s.planned.reps !== t.reps) {
        change.reps = t.reps;
        text.push(`reps ${s.planned.reps} → ${t.reps}`);
      }
      if (!same(s.planned.targetRpe, t.rpe)) {
        change.targetRpe = t.rpe;
        text.push(`RPE ${s.planned.targetRpe ?? '—'} → ${t.rpe ?? '—'}`);
      }
      if (!same(s.planned.kg, t.kg)) {
        change.plannedKg = t.kg;
        text.push(`${s.planned.kg ?? '—'} → ${t.kg ?? '—'} kg`);
      }
      if (!same(repsMaxOf(s), t.repsMax)) {
        protocol.repsMax = t.repsMax;
        text.push(`rango hasta ${t.repsMax ?? '—'}`);
      }
      if ((s.protocol?.segment ?? 'work') !== t.segment) {
        protocol.segment = t.segment;
        text.push(`tipo ${t.segment}`);
      }
      if (!same(s.protocol?.pauseSec, t.pause)) {
        protocol.pauseSec = t.pause;
        text.push(t.pause === null ? 'sin descanso indicado' : `descanso ${t.pause} s`);
      }
      if (!same(s.protocol?.athleteView, t.view || null)) {
        protocol.athleteView = t.view || null;
        text.push(t.view ? `el atleta ve: ${VIEW_SHORT[t.view] ?? t.view}` : 'el atleta ve: lo habitual');
      }
      if (!same(s.protocol?.athleteProgression, t.prog || null)) {
        protocol.athleteProgression = t.prog || null;
        text.push(
          t.prog
            ? `meta al atleta: ${t.prog === 'reps' ? 'reps' : 'reps y kg'}`
            : 'meta al atleta: solo el coach la ve',
        );
      }
      if (t.note && t.note !== noteOf(s)) {
        protocol.instructions = t.note;
        text.push('nota');
      }
      if (
        ('plannedKg' in change || 'targetRpe' in change) &&
        s.protocol?.loadMode !== loadMode(t.kg, t.rpe, s)
      )
        protocol.loadMode = loadMode(t.kg, t.rpe, s);
      if (Object.keys(protocol).length) change.protocol = protocol;
      if (!Object.keys(change).length) return;
      const key = JSON.stringify(change);
      const grp = groups.get(key) ?? { ids: [], change, text };
      grp.ids.push(s.plannedSetId);
      groups.set(key, grp);
    });
    if (!groups.size) {
      plan.unchanged++;
      continue;
    }
    for (const grp of groups.values()) {
      plan.ops.push({ kind: 'change', label: `Cambiar ${n.name}`, setIds: grp.ids, change: grp.change });
      plan.changes.push(
        `${n.name} (${grp.ids.length} ${grp.ids.length === 1 ? 'serie' : 'series'}): ${grp.text.join(' · ')}`,
      );
    }
  }
  for (const o of olds) {
    if (news.some((n) => n.name === o.name)) continue;
    const ex = executed(o);
    plan.ops.push({
      kind: 'remove',
      label: `Quitar ${o.name}`,
      setIds: o.sets.map((s) => s.plannedSetId),
      executed: ex,
    });
    plan.changes.push(`${o.name}: se quita (${o.sets.length} series)`);
    if (ex)
      plan.warnings.push(
        `${o.name}: ${ex} serie(s) con ejecución se retiran del plan (su historia se conserva).`,
      );
  }
  return plan;
}

/* ------------------------------------------------------------------ semana ------------------------------------------------------------------ */
const WD = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
/** Toda la semana (microciclo) como texto: «# Día 1 · lun» + una línea por ejercicio. */
export function weekToText(sessions: Pick<SessionRow, 'dayNo' | 'date' | 'sets'>[]): string {
  return [...sessions]
    .sort((a, b) => a.dayNo - b.dayNo || a.date.localeCompare(b.date))
    .map((s) => `# Día ${s.dayNo} · ${WD[(s.dayNo - 1) % 7]}\n${setsToText(s.sets)}`)
    .join('\n\n');
}
export interface WeekDay {
  dayNo: number;
  text: string;
  startLine: number;
}
export function splitWeekText(text: string): {
  days: WeekDay[];
  errors: { line: number; message: string }[];
} {
  const days: WeekDay[] = [];
  const errors: { line: number; message: string }[] = [];
  let cur: WeekDay | null = null;
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((raw, i) => {
      const m = /^\s*#+\s*(?:d[ií]a\s*)?(\d)\b.*$/i.exec(raw);
      if (m) {
        const dayNo = Number(m[1]);
        if (dayNo < 1 || dayNo > 7) errors.push({ line: i + 1, message: 'el día va de 1 a 7' });
        cur = { dayNo, text: '', startLine: i + 2 };
        days.push(cur);
        return;
      }
      if (!raw.trim()) return;
      if (!cur) {
        errors.push({ line: i + 1, message: 'antes de los ejercicios va un encabezado «# Día 1»' });
        return;
      }
      cur.text += (cur.text ? '\n' : '') + raw;
    });
  return { days, errors };
}
export { suggestLift };

/* ------------------------------------------------------------------ fechas y semanas ------------------------------------------------------------------ */
const mondayOf = (d: string) => {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};
/** Día de la semana ISO (1 = lunes … 7 = domingo). */
export const isoWeekday = (d: string) => ((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1;
/** Número de semana del bloque que le corresponde a una fecha (según la primera semana del bloque). null = anterior al inicio del bloque. */
export function weekOfDate(
  all: Pick<SessionRow, 'blockKey' | 'weekNo' | 'date'>[],
  block: string,
  date: string,
): number | null {
  const inBlock = all.filter((s) => s.blockKey === block);
  if (!inBlock.length) return null;
  const minWeek = Math.min(...inBlock.map((s) => s.weekNo));
  const ref = inBlock
    .filter((s) => s.weekNo === minWeek)
    .sort((a, b) => a.date.localeCompare(b.date))[0] as (typeof inBlock)[number];
  const diff = Math.round(
    (Date.parse(mondayOf(date) + 'T00:00:00Z') - Date.parse(mondayOf(ref.date) + 'T00:00:00Z')) /
      (7 * 86400000),
  );
  const w = ref.weekNo + diff;
  return w >= 1 ? w : null;
}
export const mondayOfDate = mondayOf;
