import { summarizeBlocks, type BlockSummary } from './blocks.js';
import { estimateCurve, estimatePrg, METHOD_CURVE, METHOD_PRG } from './e1rm-methods.js';
import { computeObservedMetrics } from './metrics-observed.js';
import { weekMetrics, type WeekMetrics } from './metrics.js';
import type { MetricResult } from './metric-result.js';
import {
  DIRECT_WEIGHT,
  INDIRECT_WEIGHT,
  MUSCLE_CONVENTION_VERSION,
  musclesForSet,
  MUSCLE_LABELS,
  type MuscleConfig,
  type MuscleGroup,
} from './muscles.js';
import { isWorkSet, type ObservedSet } from './observed.js';
import type { EngineParams } from './params.js';
import type { ActualSet, Lift, PlannedSet, Readiness } from './types.js';
import { toViews } from './views.js';
import type { StrengthReference } from './references.js';

/**
 * Consultas de lectura para el frontend. Todas separan PLANIFICADO y REALIZADO, indican semanas parciales y duración del período, y no rellenan
 * descansos desconocidos con cero: un día sin registro no es un descanso confirmado. No suman SI entre modelos ni agrupan variantes como marcas equivalentes.
 */
const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diffDays = (a: string, b: string): number =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const mondayOf = (iso: string): string => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));

export interface WeekRef {
  /** Lunes de la semana calendario. */
  from: string;
  /** Domingo (o el corte si la semana está en curso). */
  to: string;
  days: number;
  /** Semana recortada por el corte (en curso) o por el borde del rango pedido. */
  partial: boolean;
  /** Días de la semana (dentro del rango) que ya transcurrieron hasta el corte. */
  elapsedDays: number;
  /** La semana empieza después del corte: solo puede existir programación, no ejecución. */
  future: boolean;
}

export function weekRefs(from: string, to: string, cutoff: string): WeekRef[] {
  const end = to > cutoff ? cutoff : to;
  const out: WeekRef[] = [];
  for (let m = mondayOf(from); m <= end; m = addDays(m, 7)) {
    const a = m < from ? from : m;
    const sun = addDays(m, 6);
    const b = sun > end ? end : sun;
    out.push({
      from: a,
      to: b,
      days: diffDays(b, a) + 1,
      partial: a !== m || b !== sun,
      elapsedDays: diffDays(b, a) + 1,
      future: false,
    });
  }
  return out;
}

/**
 * Semanas calendario del rango SIN recortar por el corte (la programación futura es legítima). Lo realizado solo existe hasta el corte:
 * `elapsedDays` y `future` lo indican, y una semana en curso es parcial.
 */
export function calendarWeeks(from: string, to: string, cutoff: string): WeekRef[] {
  const out: WeekRef[] = [];
  for (let m = mondayOf(from); m <= to; m = addDays(m, 7)) {
    const a = m < from ? from : m;
    const sun = addDays(m, 6);
    const b = sun > to ? to : sun;
    const days = diffDays(b, a) + 1;
    const elapsed = cutoff < a ? 0 : Math.min(days, diffDays(cutoff, a) + 1);
    out.push({
      from: a,
      to: b,
      days,
      partial: a !== m || b !== sun || elapsed < days,
      elapsedDays: elapsed,
      future: cutoff < a,
    });
  }
  return out;
}

const inRange = (d: string, w: { from: string; to: string }) => d >= w.from && d <= w.to;

/* ---------------- Resumen semanal por movimiento ---------------- */

export interface PlannedCell {
  sets: number;
  nl: number;
  tonnage: number | null;
  frequency: number;
  siTotal: number | null;
  /** Intensidad relativa media planificada (% de la referencia); null si falta referencia. */
  intensity: number | null;
  intensityByReps: number | null;
  /** Series sin RPE objetivo: el SI planificado no se completa con supuestos. */
  siMissing: number;
}

export interface WeeklyMovementRow {
  week: WeekRef;
  movement: { exerciseName: string; exerciseId: string; lift: Lift | null; variantKey: string };
  planned: PlannedCell | null;
  actual: Record<string, MetricResult>;
}

export interface WeeklyInput {
  planned: PlannedSet[];
  observed: ObservedSet[];
  from: string;
  to: string;
  cutoff: string;
  references?: StrengthReference[];
}

/** Un renglón por semana y movimiento (ejercicio + variante). Las variantes NO se agrupan como equivalentes. */
export function weeklyByMovement(inp: WeeklyInput): WeeklyMovementRow[] {
  const weeks = calendarWeeks(inp.from, inp.to, inp.cutoff);
  const plannedViews = toViews(inp.planned, [], 'planned', '9999-12-31');
  const movements = new Map<
    string,
    { exerciseName: string; exerciseId: string; lift: Lift | null; variantKey: string }
  >();
  for (const o of inp.observed)
    if (isWorkSet(o))
      movements.set(`${o.exerciseName}|${o.variantKey}`, {
        exerciseName: o.exerciseName,
        exerciseId: o.exerciseId,
        lift: o.lift,
        variantKey: o.variantKey,
      });
  for (const s of inp.planned)
    if (!s.isWarmup)
      movements.set(`${s.exerciseName}|${s.variantKey}`, {
        exerciseName: s.exerciseName,
        exerciseId: s.exerciseName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        lift: s.lift,
        variantKey: s.variantKey,
      });
  const rows: WeeklyMovementRow[] = [];
  for (const w of weeks) {
    for (const mv of movements.values()) {
      const pset = inp.planned.filter(
        (s) =>
          !s.isWarmup &&
          s.exerciseName === mv.exerciseName &&
          s.variantKey === mv.variantKey &&
          inRange(s.plannedDate, w),
      );
      const obs = inp.observed.filter(
        (o) => o.exerciseName === mv.exerciseName && o.variantKey === mv.variantKey && inRange(o.date, w),
      );
      if (!pset.length && !obs.length) continue;
      let planned: PlannedCell | null = null;
      if (pset.length) {
        const ids = new Set(pset.map((s) => s.id));
        const v = plannedViews.filter((x) => ids.has(x.id));
        const wm = weekMetrics(
          v.map((x) => ({ ...x, weekNo: 1 })),
          1,
        );
        planned = {
          sets: wm.sets,
          nl: wm.nl,
          tonnage: wm.tonnage,
          frequency: new Set(pset.map((s) => s.plannedDate)).size,
          siTotal: wm.si?.total ?? null,
          intensity: wm.meanPct !== null ? 100 * wm.meanPct : null,
          intensityByReps: wm.meanPctByReps !== null ? 100 * wm.meanPctByReps : null,
          siMissing: wm.siMissing,
        };
      }
      const actual = obs.length
        ? computeObservedMetrics({
            obs,
            cutoff: inp.cutoff,
            from: w.from,
            to: w.to,
            scope: { exercise: mv.exerciseName },
            references: inp.references,
          })
        : {};
      const filtered = Object.fromEntries(
        Object.entries(actual).filter(([k]) =>
          [
            'nl',
            'sets',
            'tonnage',
            'frequency',
            'e1rm_table_rpe',
            'e1rm_prg_formulas',
            'si_rts_total',
            'si_rts_central',
            'si_rts_peripheral',
            'intensity_rel',
            'intensity_rel_reps',
          ].includes(k),
        ),
      );
      rows.push({ week: w, movement: mv, planned, actual: filtered });
    }
  }
  return rows;
}

/* ---------------- Resumen semanal por grupo muscular ---------------- */

export interface MuscleWeekRow {
  week: WeekRef;
  muscle: string;
  /** Nombre legible del grupo (fino o agrupado). */
  label: string;
  directSets: number;
  indirectSets: number;
  /** Series equivalentes = directas × 1,0 + indirectas × 0,5. NO es NL ni tonelaje. */
  equivalentSets: number;
  exercises: string[];
}

export interface MuscleSummary {
  convention: { version: string; directWeight: number; indirectWeight: number; note: string };
  rows: MuscleWeekRow[];
  /** Ejercicios fuera de la convención: no aportan (no se adivina) y se informan. */
  unmappedExercises: string[];
  warnings: string[];
}

/** Series equivalentes por músculo y semana, con aportes directos/indirectos discriminados. NO existe un "total de todos los músculos": los grupos se superponen. */
export function weeklyByMuscle(
  obs: ObservedSet[],
  from: string,
  to: string,
  cutoff: string,
  cfg?: MuscleConfig,
): MuscleSummary {
  const rows: MuscleWeekRow[] = [];
  const unmapped = new Set<string>();
  for (const w of weekRefs(from, to, cutoff)) {
    const acc = new Map<MuscleGroup, { d: number; i: number; ex: Set<string> }>();
    for (const o of obs) {
      if (!isWorkSet(o) || !inRange(o.date, w)) continue;
      const c = musclesForSet(o, cfg);
      if (!c) {
        unmapped.add(o.exerciseName);
        continue;
      }
      for (const m of c) {
        const a = acc.get(m.group) ?? { d: 0, i: 0, ex: new Set<string>() };
        if (m.kind === 'directo') a.d += 1;
        else a.i += 1;
        a.ex.add(o.exerciseName);
        acc.set(m.group, a);
      }
    }
    for (const [muscle, a] of acc)
      rows.push({
        week: w,
        muscle,
        label: MUSCLE_LABELS[muscle] ?? muscle,
        directSets: a.d,
        indirectSets: a.i,
        equivalentSets: a.d * DIRECT_WEIGHT + a.i * INDIRECT_WEIGHT,
        exercises: [...a.ex].sort(),
      });
  }
  return {
    convention: {
      version: MUSCLE_CONVENTION_VERSION,
      directWeight: DIRECT_WEIGHT,
      indirectWeight: INDIRECT_WEIGHT,
      note: 'Convención del proyecto (no recuperada del mapeo interno de Hevy). Series equivalentes ≠ NL ≠ tonelaje.',
    },
    rows,
    unmappedExercises: [...unmapped].sort(),
    warnings: [
      'No se informa un total entre músculos: los grupos se superponen y una serie aporta a varios.',
      ...(unmapped.size
        ? [`${unmapped.size} ejercicio(s) fuera de la convención no aportan a ningún músculo.`]
        : []),
    ],
  };
}

/* ---------------- Comparación de períodos y semana actual vs anterior ---------------- */

export interface PeriodRef {
  from: string;
  to: string;
}

export interface PeriodCompareRow {
  metricId: string;
  unit: string;
  a: number | null;
  b: number | null;
  /** Normalizado por semana (solo métricas aditivas): permite comparar duraciones distintas. */
  aPerWeek: number | null;
  bPerWeek: number | null;
  diff: number | null;
  diffPerWeek: number | null;
  statusA: string;
  statusB: string;
  note: string;
}

export interface PeriodComparison {
  a: { period: PeriodRef; days: number; weeks: number; partial: boolean };
  b: { period: PeriodRef; days: number; weeks: number; partial: boolean };
  scope: { lift?: Lift | 'ALL'; exercise?: string };
  rows: PeriodCompareRow[];
  notes: string[];
}

const ADDITIVE = new Set([
  'nl',
  'sets',
  'tonnage',
  'inol_prg',
  'si_rts_total',
  'si_rts_central',
  'si_rts_peripheral',
  'si_prg',
  'si_efort_xl',
]);
const COMPARE_IDS = [
  'nl',
  'sets',
  'tonnage',
  'frequency',
  'intensity_rel',
  'e1rm_table_rpe',
  'e1rm_prg_formulas',
  'si_rts_total',
  'si_rts_central',
  'si_rts_peripheral',
  'si_prg',
  'si_efort_xl',
  'inol_prg',
];

/**
 * Compara dos períodos elegidos (de duración posiblemente distinta) sobre OBSERVACIONES. Muestra totales y dosis semanal normalizada.
 * Cada SI/XL conserva su modelo (no se suman ni se comparan entre modelos) y los dos métodos de e1RM van en filas distintas.
 */
export function comparePeriods(inp: {
  observed: ObservedSet[];
  a: PeriodRef;
  b: PeriodRef;
  cutoff: string;
  scope: { lift?: Lift | 'ALL'; exercise?: string };
  references?: StrengthReference[];
}): PeriodComparison {
  const calc = (p: PeriodRef) =>
    computeObservedMetrics({
      obs: inp.observed,
      cutoff: inp.cutoff,
      ...p,
      scope: inp.scope,
      references: inp.references,
    });
  const ma = calc(inp.a);
  const mb = calc(inp.b);
  const pa = (ma.nl as MetricResult).period as NonNullable<MetricResult['period']>;
  const pb = (mb.nl as MetricResult).period as NonNullable<MetricResult['period']>;
  const notes: string[] = [];
  if (Math.abs(pa.days - pb.days) > 0)
    notes.push(
      `Los períodos duran ${pa.days} y ${pb.days} días: la comparación válida es la dosis POR SEMANA; los totales no son comparables entre sí.`,
    );
  if (pa.partial || pb.partial)
    notes.push('Al menos un período es parcial (semana incompleta o recortada por el corte).');
  notes.push('Universo REALIZADO. Los dos métodos de e1RM y los modelos de SI van separados y no se unen.');
  const rows: PeriodCompareRow[] = COMPARE_IDS.map((id) => {
    const x = ma[id] as MetricResult;
    const y = mb[id] as MetricResult;
    const add = ADDITIVE.has(id);
    const per = (m: MetricResult) =>
      add && m.value !== null && m.period && m.period.weeks > 0 ? m.value / m.period.weeks : null;
    const a = x.value;
    const b = y.value;
    return {
      metricId: id,
      unit: x.unit,
      a,
      b,
      aPerWeek: per(x),
      bPerWeek: per(y),
      diff: a !== null && b !== null ? b - a : null,
      diffPerWeek: per(x) !== null && per(y) !== null ? (per(y) as number) - (per(x) as number) : null,
      statusA: x.status,
      statusB: y.status,
      note: [...new Set([...x.missing, ...y.missing].map((m) => `falta ${m}`))].join('; '),
    };
  });
  return {
    a: { period: inp.a, days: pa.days, weeks: pa.weeks, partial: pa.partial },
    b: { period: inp.b, days: pb.days, weeks: pb.weeks, partial: pb.partial },
    scope: inp.scope,
    rows,
    notes,
  };
}

/** Semana actual (hasta el corte) vs la anterior. La actual casi siempre es parcial: se compara también la dosis normalizada por día. */
export function compareWeeks(inp: {
  observed: ObservedSet[];
  cutoff: string;
  scope: { lift?: Lift | 'ALL'; exercise?: string };
  references?: StrengthReference[];
}): PeriodComparison & {
  normalizedPerDay: { metricId: string; current: number | null; previous: number | null }[];
} {
  const monday = mondayOf(inp.cutoff);
  const prevFrom = addDays(monday, -7);
  const r = comparePeriods({
    ...inp,
    a: { from: prevFrom, to: addDays(monday, -1) },
    b: { from: monday, to: inp.cutoff },
  });
  const normalizedPerDay = r.rows
    .filter((x) => ADDITIVE.has(x.metricId))
    .map((x) => ({
      metricId: x.metricId,
      previous: x.a !== null ? x.a / r.a.days : null,
      current: x.b !== null ? x.b / Math.max(1, r.b.days) : null,
    }));
  return { ...r, normalizedPerDay };
}

/* ---------------- Series temporales ---------------- */

export interface SeriesPoint {
  date: string;
  value: number;
  setId: string;
}

export interface PerformanceSeries {
  methodId: string;
  methodVersion: string;
  exercise: string;
  variantKey: string;
  points: SeriesPoint[];
}

/**
 * Series de e1RM por método y por ejercicio+variante (mejor serie de cada día). NUNCA se mezclan métodos ni variantes en una misma serie.
 * `methodTransitions` marca desde/hasta cuándo hay RPE registrado: es un cambio de método disponible, no una tendencia continua.
 */
export function performanceSeries(
  obs: ObservedSet[],
  cutoff: string,
): {
  series: PerformanceSeries[];
  methodTransitions: {
    exercise: string;
    firstWithRpe: string | null;
    lastWithRpe: string | null;
    note: string;
  }[];
} {
  const groups = new Map<string, ObservedSet[]>();
  for (const o of obs)
    if (isWorkSet(o) && o.setType !== 'dropset' && o.date <= cutoff)
      groups.set(`${o.exerciseName}|${o.variantKey}`, [
        ...(groups.get(`${o.exerciseName}|${o.variantKey}`) ?? []),
        o,
      ]);
  const series: PerformanceSeries[] = [];
  const trans: { exercise: string; firstWithRpe: string | null; lastWithRpe: string | null; note: string }[] =
    [];
  for (const [key, sets] of groups) {
    const [exercise, variantKey] = key.split('|') as [string, string];
    for (const [m, fn] of [
      [METHOD_CURVE, (s: ObservedSet) => estimateCurve(s.kg, s.reps, s.rpe)],
      [METHOD_PRG, (s: ObservedSet) => estimatePrg(s.kg, s.reps)],
    ] as const) {
      const byDay = new Map<string, SeriesPoint>();
      for (const s of sets) {
        if (
          s.loadKind === 'per_side' ||
          s.loadKind === 'bodyweight' ||
          s.loadKind === 'unknown' ||
          s.loadKind === 'assisted'
        )
          continue;
        const e = fn(s);
        if (e.value === null) continue;
        const cur = byDay.get(s.date);
        if (!cur || e.value > cur.value) byDay.set(s.date, { date: s.date, value: e.value, setId: s.id });
      }
      if (byDay.size)
        series.push({
          methodId: m.id,
          methodVersion: m.version,
          exercise,
          variantKey,
          points: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
        });
    }
    const withRpe = sets
      .filter((s) => s.rpe !== null)
      .map((s) => s.date)
      .sort();
    trans.push({
      exercise,
      firstWithRpe: withRpe[0] ?? null,
      lastWithRpe: withRpe.at(-1) ?? null,
      note: withRpe.length
        ? 'El método por curva solo existe en las fechas con RPE real; el de fórmulas cubre todo el período. No se unen en una tendencia.'
        : 'Sin RPE real: solo el método por fórmulas.',
    });
  }
  return { series, methodTransitions: trans };
}

export interface Candle {
  weekFrom: string;
  weekTo: string;
  /** Primera observación comparable de la semana. */
  open: number;
  high: number;
  low: number;
  /** Última observación comparable de la semana. */
  close: number;
  n: number;
}

/**
 * Velas semanales (OHLC) de e1RM de UN método y UN ejercicio+variante. open = primera observación del período, close = la última, high/low = extremos.
 * Se necesita al menos 2 observaciones comparables en la semana: con menos NO se fabrica una vela (devuelve null con el motivo).
 */
export function e1rmCandles(
  series: PerformanceSeries,
  cutoff: string,
): { candles: Candle[]; skipped: { weekFrom: string; reason: string }[]; definition: string } {
  const byWeek = new Map<string, SeriesPoint[]>();
  for (const p of series.points) {
    if (p.date > cutoff) continue;
    const w = mondayOf(p.date);
    byWeek.set(w, [...(byWeek.get(w) ?? []), p]);
  }
  const candles: Candle[] = [];
  const skipped: { weekFrom: string; reason: string }[] = [];
  for (const [w, ps] of [...byWeek.entries()].sort()) {
    if (ps.length < 2) {
      skipped.push({ weekFrom: w, reason: 'menos de 2 observaciones comparables: no se fabrica una vela' });
      continue;
    }
    const v = ps.map((x) => x.value);
    candles.push({
      weekFrom: w,
      weekTo: addDays(w, 6),
      open: (ps[0] as SeriesPoint).value,
      high: Math.max(...v),
      low: Math.min(...v),
      close: (ps.at(-1) as SeriesPoint).value,
      n: ps.length,
    });
  }
  return {
    candles,
    skipped,
    definition: `OHLC semanal de e1RM (${series.methodId} ${series.methodVersion}) de ${series.exercise}/${series.variantKey}: open = primera observación de la semana, close = última, high/low = extremos; solo observaciones del mismo método y variante.`,
  };
}

export interface Annotation {
  date: string;
  kind: 'cambio' | 'intervencion' | 'competencia';
  label: string;
  ref: { kind: string; id: string };
}

export function annotations(inp: {
  changes: { id: string; effectiveOn: string | null; detectedOn: string; summary: string }[];
  interventions: { id: string; appliedOn: string | null; description: string | null }[];
  competitions: { id: string; date: string; name: string }[];
  from: string;
  to: string;
}): Annotation[] {
  const out: Annotation[] = [];
  for (const c of inp.changes) {
    const d = c.effectiveOn ?? c.detectedOn;
    if (d >= inp.from && d <= inp.to)
      out.push({ date: d, kind: 'cambio', label: c.summary, ref: { kind: 'change_event', id: c.id } });
  }
  for (const i of inp.interventions)
    if (i.appliedOn && i.appliedOn >= inp.from && i.appliedOn <= inp.to)
      out.push({
        date: i.appliedOn,
        kind: 'intervencion',
        label: i.description ?? 'Intervención aplicada',
        ref: { kind: 'intervention', id: i.id },
      });
  for (const c of inp.competitions)
    if (c.date >= inp.from && c.date <= inp.to)
      out.push({ date: c.date, kind: 'competencia', label: c.name, ref: { kind: 'competition', id: c.id } });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Serie de carga SOLO en días con registro. No se rellenan días sin registro con cero: ausencia no es descanso confirmado. */
export function dailyLoad(
  obs: ObservedSet[],
  from: string,
  to: string,
): { date: string; nl: number; sets: number }[] {
  const by = new Map<string, { nl: number; sets: number }>();
  for (const o of obs) {
    if (!isWorkSet(o) || o.date < from || o.date > to || o.reps === null) continue;
    const a = by.get(o.date) ?? { nl: 0, sets: 0 };
    a.nl += o.reps;
    a.sets += 1;
    by.set(o.date, a);
  }
  return [...by.entries()].sort().map(([date, v]) => ({ date, ...v }));
}

export function recoverySeries(rd: Readiness[], from: string, to: string): { date: string; value: number }[] {
  return rd
    .filter((r) => r.date >= from && r.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({ date: r.date, value: r.value }));
}

/* ---------------- Macro / meso / microciclo ---------------- */

export interface MacroMeta {
  id: string;
  name: string;
  startDate: string;
  /** null = abierto. La duración de macros y mesos es variable. */
  endDate: string | null;
  objective: string | null;
  status: 'activo' | 'cerrado' | 'planificado';
}
export interface MesoMeta {
  blockKey: string;
  macroId: string | null;
  name: string;
  startDate: string | null;
  endDate: string | null;
  objective: string | null;
}
export interface MicroMeta {
  blockKey: string;
  weekNo: number;
  startDate: string;
  endDate: string;
}

export interface MicrocycleSummary {
  weekNo: number;
  /** Fechas explícitas si el coach las definió; si no, derivadas de las series previstas. */
  from: string;
  to: string;
  explicitDates: boolean;
  days: number;
  /** Semana en curso o con series sin transcurrir. */
  partial: boolean;
  planned: WeekMetrics | null;
  actual: { nl: number; sets: number; tonnage: number | null; frequency: number } | null;
  compliance: number | null;
}

export interface MesoSummary {
  blockKey: string;
  name: string;
  objective: string | null;
  startDate: string;
  endDate: string;
  durationWeeks: number;
  closed: boolean;
  microcycles: MicrocycleSummary[];
  perLift: BlockSummary[];
  notes: string[];
}

export interface MacroSummary {
  id: string;
  name: string;
  status: MacroMeta['status'];
  startDate: string;
  endDate: string | null;
  objective: string | null;
  durationWeeks: number | null;
  mesos: {
    blockKey: string;
    name: string;
    startDate: string;
    endDate: string;
    durationWeeks: number;
    closed: boolean;
  }[];
  activeMeso: string | null;
}

export function mesoSummary(inp: {
  blockKey: string;
  meta?: MesoMeta | null;
  micro?: MicroMeta[];
  planned: PlannedSet[];
  actual: ActualSet[];
  observed: ObservedSet[];
  competitionExercises: Partial<Record<Lift, string>>;
  readiness: Readiness[];
  params: EngineParams;
  cutoff: string;
}): MesoSummary {
  const bs = inp.planned.filter((s) => s.blockKey === inp.blockKey && !s.isWarmup);
  const dates = bs.map((s) => s.plannedDate).sort();
  const startDate = inp.meta?.startDate ?? (dates[0] as string);
  const endDate = inp.meta?.endDate ?? (dates.at(-1) as string);
  const amap = new Map(inp.actual.map((a) => [a.plannedSetId, a]));
  const views = toViews(inp.planned, inp.actual, 'planned', '9999-12-31');
  const weeks = [...new Set(bs.map((s) => s.weekNo))].sort((a, b) => a - b);
  const micros: MicrocycleSummary[] = weeks.map((w) => {
    const ws = bs.filter((s) => s.weekNo === w);
    const explicit = inp.micro?.find((m) => m.blockKey === inp.blockKey && m.weekNo === w);
    const ds = ws.map((s) => s.plannedDate).sort();
    const from = explicit?.startDate ?? (ds[0] as string);
    const to = explicit?.endDate ?? addDays(from, 6);
    const done = ws.filter(
      (s) => amap.get(s.id)?.status === 'done' && (amap.get(s.id)?.performedOn ?? '9') <= inp.cutoff,
    );
    const past = ws.filter((s) => s.plannedDate <= inp.cutoff);
    const obsW = inp.observed.filter((o) => isWorkSet(o) && done.some((d) => d.id === o.id));
    return {
      weekNo: w,
      from,
      to,
      explicitDates: !!explicit,
      days: diffDays(to, from) + 1,
      partial: to > inp.cutoff || ws.some((s) => s.plannedDate > inp.cutoff),
      planned: weekMetrics(
        views.filter((v) => v.blockKey === inp.blockKey),
        w,
      ),
      actual: obsW.length
        ? {
            nl: obsW.reduce((a, o) => a + (o.reps ?? 0), 0),
            sets: obsW.length,
            tonnage: obsW.every((o) => o.kg !== null)
              ? obsW.reduce((a, o) => a + (o.kg as number) * (o.reps ?? 0), 0)
              : null,
            frequency: new Set(obsW.map((o) => o.date)).size,
          }
        : null,
      compliance: past.length ? done.length / past.length : null,
    };
  });
  const perLift = summarizeBlocks({
    planned: inp.planned,
    actual: inp.actual,
    readiness: inp.readiness,
    competitionExercises: inp.competitionExercises,
    cutoff: inp.cutoff,
    params: inp.params,
  }).filter((b) => b.blockKey === inp.blockKey);
  return {
    blockKey: inp.blockKey,
    name: inp.meta?.name ?? inp.blockKey,
    objective: inp.meta?.objective ?? null,
    startDate,
    endDate,
    durationWeeks: weeks.length,
    closed: endDate < inp.cutoff,
    microcycles: micros,
    perLift,
    notes: [
      ...(micros.some((m) => m.partial)
        ? ['Hay semanas parciales: comparar dosis normalizada, no totales.']
        : []),
      ...(micros.some((m) => !m.explicitDates)
        ? ['Algunas semanas no tienen fechas explícitas: se derivaron de las series previstas.']
        : []),
      ...(inp.meta ? [] : ['Sin metadatos de meso: nombre y objetivo no declarados.']),
    ],
  };
}

export function macroSummary(inp: {
  macro: MacroMeta;
  mesos: MesoMeta[];
  planned: PlannedSet[];
  cutoff: string;
}): MacroSummary {
  const list = inp.mesos
    .filter((m) => m.macroId === inp.macro.id)
    .map((m) => {
      const ds = inp.planned
        .filter((s) => s.blockKey === m.blockKey)
        .map((s) => s.plannedDate)
        .sort();
      const start = m.startDate ?? ds[0] ?? inp.macro.startDate;
      const end = m.endDate ?? ds.at(-1) ?? start;
      return {
        blockKey: m.blockKey,
        name: m.name,
        startDate: start,
        endDate: end,
        durationWeeks:
          m.startDate && m.endDate
            ? Math.max(1, Math.round((diffDays(end, start) + 1) / 7))
            : Math.max(
                1,
                new Set(
                  inp.planned.filter((s) => s.blockKey === m.blockKey && !s.isWarmup).map((s) => s.weekNo),
                ).size,
              ),
        closed: end < inp.cutoff,
      };
    });
  const active = list.find((m) => m.startDate <= inp.cutoff && m.endDate >= inp.cutoff);
  const last = list
    .map((m) => m.endDate)
    .sort()
    .at(-1);
  const end = inp.macro.endDate ?? last ?? null;
  return {
    id: inp.macro.id,
    name: inp.macro.name,
    status: inp.macro.status,
    startDate: inp.macro.startDate,
    endDate: inp.macro.endDate,
    objective: inp.macro.objective,
    durationWeeks: end ? Math.max(1, Math.round((diffDays(end, inp.macro.startDate) + 1) / 7)) : null,
    mesos: list.sort((a, b) => (a.startDate < b.startDate ? -1 : 1)),
    activeMeso: active?.blockKey ?? null,
  };
}
