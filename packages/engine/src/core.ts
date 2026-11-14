import { computeObservedMetrics } from './metrics-observed.js';
import type { CurveDomain } from './e1rm.js';
import { estimateCurve, estimatePrg } from './e1rm-methods.js';
import { fatigueBetweenSets, FATIGUE_VERSION, type BetweenSets, type SetTarget } from './fatigue.js';
import type { MetricResult } from './metric-result.js';
import {
  DIRECT_WEIGHT,
  INDIRECT_WEIGHT,
  MUSCLE_CONVENTION_VERSION,
  PATTERN_CONVENTION_VERSION,
  musclesForSet,
  patternFor,
  type MovementPattern,
  MUSCLE_LABELS,
  type MuscleConfig,
  type MuscleGroup,
} from './muscles.js';
import { isWorkSet, type ObservedSet } from './observed.js';
import { stressOfSet } from './si.js';
import type { StrengthReference } from './references.js';
import { weekRefs } from './queries.js';
import type { PlannedSet, Readiness, SessionFeedback } from './types.js';

/**
 * VARIABLES NÚCLEO por sesión, ejercicio y semana: NL, SI (tres modelos separados), tonelaje, volumen por grupo muscular,
 * fatiga entre series y fatiga entre sesiones. Versión `nucleo-v1`. Todo es descriptivo: no hay umbrales inventados ni conclusiones.
 * Cada valor trae su estado (`available|partial|unavailable`) y lo que falta; lo que no se puede calcular NO se rellena.
 */
export const CORE_VERSION = 'nucleo-v1';

export interface CoreValue {
  value: number | null;
  unit: string;
  status: 'available' | 'partial' | 'unavailable';
  missing: string[];
  warnings: string[];
}
const cv = (m: MetricResult | undefined): CoreValue =>
  m
    ? { value: m.value, unit: m.unit, status: m.status, missing: m.missing, warnings: m.warnings }
    : { value: null, unit: '', status: 'unavailable', missing: ['métrica no calculada'], warnings: [] };

export interface CoreBundle {
  nl: CoreValue;
  sets: CoreValue;
  tonnage: CoreValue;
  /** Tres modelos con escalas propias: NO se suman ni se comparan entre sí. */
  si: {
    rts: { total: CoreValue; central: CoreValue; peripheral: CoreValue; model: string };
    prg: CoreValue & { model: string };
    efort: CoreValue & { model: string };
  };
  e1rm: { curve: CoreValue; prg: CoreValue };
  /** Intensidad relativa media (% de la referencia fechada): simple (cada serie pesa igual) y ponderada por repeticiones. */
  intensity: { simple: CoreValue; byReps: CoreValue };
}

export interface MuscleVolumeRow {
  muscle: string;
  label: string;
  directSets: number;
  indirectSets: number;
  /** Series equivalentes = directas × 1,0 + indirectas × 0,5 (convención `musculos-v2`). */
  equivalentSets: number;
  /** Σ reps × peso del aporte (misma convención). NO es el NL del movimiento. */
  equivalentReps: number;
  /** Σ kg × reps × peso del aporte, solo series con carga total interpretable. */
  equivalentTonnage: number | null;
  exercises: string[];
}
export interface MuscleVolume {
  convention: { version: string; directWeight: number; indirectWeight: number };
  rows: MuscleVolumeRow[];
  unmappedExercises: string[];
  warnings: string[];
}

const TONNAGE_OK = (s: ObservedSet) =>
  s.kg !== null &&
  s.kg > 0 &&
  s.reps !== null &&
  s.reps > 0 &&
  (s.loadKind === 'total' || s.loadKind === 'machine' || s.loadKind === 'added_bodyweight');

/** Volumen por grupo muscular (series directas/indirectas/equivalentes, repeticiones y tonelaje equivalentes). Sin total entre músculos. */
export function muscleVolume(sets: ObservedSet[], cfg?: MuscleConfig): MuscleVolume {
  const acc = new Map<
    MuscleGroup,
    { d: number; i: number; reps: number; ton: number; tonN: number; ex: Set<string> }
  >();
  const unmapped = new Set<string>();
  for (const s of sets) {
    if (!isWorkSet(s)) continue;
    const c = musclesForSet(s, cfg);
    if (!c) {
      unmapped.add(s.exerciseName);
      continue;
    }
    for (const m of c) {
      const a = acc.get(m.group) ?? { d: 0, i: 0, reps: 0, ton: 0, tonN: 0, ex: new Set<string>() };
      if (m.kind === 'directo') a.d += 1;
      else a.i += 1;
      if (s.reps !== null && s.reps > 0) a.reps += s.reps * m.weight;
      if (TONNAGE_OK(s)) {
        a.ton += (s.kg as number) * (s.reps as number) * m.weight;
        a.tonN += 1;
      }
      a.ex.add(s.exerciseName);
      acc.set(m.group, a);
    }
  }
  const rows: MuscleVolumeRow[] = [...acc.entries()]
    .map(([muscle, a]) => ({
      muscle,
      label: MUSCLE_LABELS[muscle] ?? muscle,
      directSets: a.d,
      indirectSets: a.i,
      equivalentSets: a.d * DIRECT_WEIGHT + a.i * INDIRECT_WEIGHT,
      equivalentReps: a.reps,
      equivalentTonnage: a.tonN ? a.ton : null,
      exercises: [...a.ex].sort(),
    }))
    .sort((x, y) => y.equivalentSets - x.equivalentSets || (x.muscle < y.muscle ? -1 : 1));
  return {
    convention: {
      version: MUSCLE_CONVENTION_VERSION,
      directWeight: DIRECT_WEIGHT,
      indirectWeight: INDIRECT_WEIGHT,
    },
    rows,
    unmappedExercises: [...unmapped].sort(),
    warnings: [
      'No se informa un total entre músculos: los grupos se superponen y una serie aporta a varios.',
      'Series equivalentes ≠ NL ≠ tonelaje del movimiento.',
      ...(unmapped.size
        ? [`${unmapped.size} ejercicio(s) fuera de la convención no aportan a ningún músculo.`]
        : []),
    ],
  };
}

export interface PatternVolumeRow {
  pattern: MovementPattern;
  sets: number;
  nl: number;
  tonnage: number | null;
  /** SI RTS (rts-aprox-v1) sumado sobre las series del patrón que tienen reps y RPE. null = ninguna serie con RPE. */
  si: { total: number; central: number; peripheral: number; sets: number } | null;
  exercises: string[];
}
export interface PatternVolume {
  convention: { version: string };
  /** Cada ejercicio pertenece a UN patrón: las filas SÍ se pueden sumar (suman las series, el NL y el tonelaje de los ejercicios mapeados). */
  rows: PatternVolumeRow[];
  unmappedExercises: string[];
  warnings: string[];
}

/** Volumen por patrón de movimiento (series, NL, tonelaje). A diferencia de los músculos, los patrones no se superponen. */
export function patternVolume(sets: ObservedSet[]): PatternVolume {
  const acc = new Map<
    MovementPattern,
    {
      sets: number;
      nl: number;
      ton: number;
      tonN: number;
      si: { total: number; central: number; peripheral: number; sets: number };
      ex: Set<string>;
    }
  >();
  const unmapped = new Set<string>();
  for (const s of sets) {
    if (!isWorkSet(s)) continue;
    const p = patternFor(s.exerciseId, s.exerciseName);
    if (!p) {
      unmapped.add(s.exerciseName);
      continue;
    }
    const a = acc.get(p) ?? {
      sets: 0,
      nl: 0,
      ton: 0,
      tonN: 0,
      si: { total: 0, central: 0, peripheral: 0, sets: 0 },
      ex: new Set<string>(),
    };
    a.sets += 1;
    if (s.reps !== null && s.reps > 0) a.nl += s.reps;
    if (TONNAGE_OK(s)) {
      a.ton += (s.kg as number) * (s.reps as number);
      a.tonN += 1;
    }
    if (s.reps !== null && s.reps > 0 && s.rpe !== null && s.rpe >= 1 && s.rpe <= 10) {
      const st = stressOfSet(s.reps, s.rpe);
      a.si.total += st.total;
      a.si.central += st.central;
      a.si.peripheral += st.peripheral;
      a.si.sets += 1;
    }
    a.ex.add(s.exerciseName);
    acc.set(p, a);
  }
  return {
    convention: { version: PATTERN_CONVENTION_VERSION },
    rows: [...acc.entries()]
      .map(([pattern, a]) => ({
        pattern,
        sets: a.sets,
        nl: a.nl,
        tonnage: a.tonN ? a.ton : null,
        si: a.si.sets ? a.si : null,
        exercises: [...a.ex].sort(),
      }))
      .sort((x, y) => y.sets - x.sets || (x.pattern < y.pattern ? -1 : 1)),
    unmappedExercises: [...unmapped].sort(),
    warnings: [
      'Cada ejercicio pertenece a un solo patrón (convención del proyecto): las filas se pueden sumar.',
      ...(unmapped.size ? [`${unmapped.size} ejercicio(s) sin patrón no se cuentan.`] : []),
    ],
  };
}

export interface ExerciseBlock {
  exerciseName: string;
  exerciseId: string;
  variantKey: string;
  lift: string | null;
  /** Patrón de movimiento del ejercicio (null = fuera de la convención). */
  pattern: MovementPattern | null;
  /** Prioridad que el coach le dio al ejercicio en su planilla (1 = principal) y su rol; null = sin dato. NO siempre el movimiento de competición es el principal. */
  priority: number | null;
  exposureRole: string | null;
  metrics: CoreBundle;
  warmupSets: number;
  /** Mejor e1RM de la sesión por método (separados). */
  bestE1rm: { curve: number | null; prg: number | null };
  medianRpe: number | null;
  topKg: number | null;
  fatigueBetweenSets: BetweenSets;
  /** Cambios respecto de la sesión anterior del MISMO ejercicio y variante. */
  vsPrevious: {
    previousDate: string | null;
    daysSince: number | null;
    e1rmCurvePct: number | null;
    e1rmPrgPct: number | null;
    topKgDelta: number | null;
    medianRpeDelta: number | null;
    nlDelta: number | null;
    siRtsTotalRatio: number | null;
  } | null;
}

export interface SessionFatigue {
  version: string;
  /** Cuestionario de fatiga al terminar la sesión (1–10) y su cambio respecto de la última sesión que tuvo valor. */
  endFatigue: number | null;
  endFatigueDelta: number | null;
  /** Preparación (check-in) más reciente al día de la sesión y su antigüedad en días; null = sin check-in previo. */
  readiness: { value: number; date: string; ageDays: number } | null;
  daysSincePreviousSession: number | null;
  /** Carga acumulada previa: 7 días anteriores (sin contar la sesión) y promedio semanal de los 28 anteriores. */
  rolling: {
    acute7: { nl: number; tonnage: number; siRtsTotal: number | null; sessions: number };
    chronicWeeklyMean28: { nl: number; tonnage: number; siRtsTotal: number | null } | null;
    /** acute7 / chronicWeeklyMean28: razón DESCRIPTIVA (no es un umbral ni una predicción). null si no hay 28 días de historia previa. */
    ratio: { nl: number | null; tonnage: number | null; siRtsTotal: number | null } | null;
    coverage: string;
  };
}

export interface SessionRow {
  key: string;
  sessionKey: string;
  date: string;
  source: string;
  totals: CoreBundle;
  exercises: ExerciseBlock[];
  muscles: MuscleVolume;
  patterns: PatternVolume;
  fatigue: SessionFatigue;
}

export interface WeekRow {
  week: { from: string; to: string; days: number; partial: boolean };
  sessions: number;
  trainingDays: number;
  totals: CoreBundle;
  muscles: MuscleVolume;
  patterns: PatternVolume;
  fatigue: {
    endFatigue: { mean: number | null; max: number | null; n: number };
    meanDaysBetweenSessions: number | null;
    /** Dosis semanal frente a la semana anterior (razón). Se omite si alguna de las dos es parcial: no se compara dosis de duración distinta. */
    vsPreviousWeek: {
      nl: number | null;
      tonnage: number | null;
      siRtsTotal: number | null;
      comparable: boolean;
      reason: string | null;
    } | null;
    meanRpeDriftPerSession: number | null;
  };
}

export interface CoreInput {
  /** Vista (fino/medio/grueso) y mapa propio de músculos del atleta. */
  muscleConfig?: MuscleConfig;
  obs: ObservedSet[];
  cutoff: string;
  from: string;
  to: string;
  lift?: string;
  source?: string;
  references?: StrengthReference[];
  feedback?: SessionFeedback[];
  readiness?: Readiness[];
  domain?: CurveDomain;
  /** Prescripción: permite comparar cada serie con su RPE y rango de repeticiones previstos (vínculo `plannedSetId`). */
  planned?: PlannedSet[];
}

export interface CoreResult {
  version: string;
  fatigueVersion: string;
  cutoff: string;
  period: { from: string; to: string };
  scope: { lift: string | null; source: string | null };
  domain: CurveDomain;
  totals: CoreBundle;
  muscles: MuscleVolume;
  patterns: PatternVolume;
  sessions: SessionRow[];
  weeks: WeekRow[];
  definitions: Record<string, string>;
  warnings: string[];
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const dayDiff = (a: string, b: string): number =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const pctChange = (a: number | null, b: number | null): number | null =>
  a === null || b === null || a === 0 ? null : ((b - a) / Math.abs(a)) * 100;

function bundle(inp: CoreInput, obs: ObservedSet[], from: string, to: string, lift?: string): CoreBundle {
  const m = computeObservedMetrics({
    obs,
    cutoff: inp.cutoff,
    from,
    to,
    scope: { lift: (lift as 'SQ' | 'BP' | 'DL' | 'ALL' | undefined) ?? 'ALL' },
    references: inp.references,
    domain: inp.domain,
  });
  return {
    nl: cv(m.nl),
    sets: cv(m.sets),
    tonnage: cv(m.tonnage),
    si: {
      rts: {
        total: cv(m.si_rts_total),
        central: cv(m.si_rts_central),
        peripheral: cv(m.si_rts_peripheral),
        model: 'rts-aprox-v1',
      },
      prg: { ...cv(m.si_prg), model: 'prg-si-v1' },
      efort: { ...cv(m.si_efort_xl), model: 'efort-xl-v1' },
    },
    e1rm: { curve: cv(m.e1rm_table_rpe), prg: cv(m.e1rm_prg_formulas) },
    intensity: { simple: cv(m.intensity_rel), byReps: cv(m.intensity_rel_reps) },
  };
}

const bestE1rm = (sets: ObservedSet[], domain: CurveDomain) => {
  const el = sets.filter((s) => isWorkSet(s) && s.setType !== 'dropset');
  const ok = (s: ObservedSet) =>
    !(
      s.loadKind === 'per_side' ||
      s.loadKind === 'unknown' ||
      s.loadKind === 'bodyweight' ||
      s.loadKind === 'assisted'
    );
  const c = el
    .map((s) => estimateCurve(s.kg, s.reps, s.rpe, domain).value)
    .filter((v): v is number => v !== null);
  const p = el
    .filter(ok)
    .map((s) => estimatePrg(s.kg, s.reps).value)
    .filter((v): v is number => v !== null);
  return { curve: c.length ? Math.max(...c) : null, prg: p.length ? Math.max(...p) : null };
};

export function computeCore(inp: CoreInput): CoreResult {
  const domain: CurveDomain = inp.domain ?? 'recomendado';
  const targets = new Map<string, SetTarget>(
    (inp.planned ?? []).map((p) => [
      p.id,
      { reps: p.reps, repsMax: p.protocol?.repsMax ?? null, rpe: p.targetRpe, kg: p.plannedKg },
    ]),
  );
  const priorities = new Map<string, { priority: number | null; role: string | null }>();
  for (const p of inp.planned ?? []) {
    const k = `${p.sessionKey}|${p.exerciseName}`;
    const cur = priorities.get(k);
    if (
      !cur ||
      (p.priority !== null &&
        p.priority !== undefined &&
        (cur.priority === null || p.priority < cur.priority))
    )
      priorities.set(k, { priority: p.priority ?? null, role: p.exposureRole ?? null });
  }
  const to = inp.to > inp.cutoff ? inp.cutoff : inp.to;
  const scoped = (o: ObservedSet) =>
    o.date <= inp.cutoff &&
    (!inp.source || o.source === inp.source) &&
    (!inp.lift || inp.lift === 'ALL' || o.lift === inp.lift);
  const all = inp.obs.filter(scoped);
  const inPeriod = all.filter((o) => o.date >= inp.from && o.date <= to);
  const fb = new Map((inp.feedback ?? []).map((f) => [f.sessionKey, f.endFatigue]));
  const readiness = [...(inp.readiness ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));

  // ---- sesiones: (fuente, sessionKey, fecha)
  const groups = new Map<string, ObservedSet[]>();
  for (const o of inPeriod)
    groups.set(`${o.source}|${o.sessionKey}|${o.date}`, [
      ...(groups.get(`${o.source}|${o.sessionKey}|${o.date}`) ?? []),
      o,
    ]);
  const history = new Map<string, ObservedSet[]>(); // todas las sesiones ≤ corte, para comparar con "la anterior"
  for (const o of all)
    history.set(`${o.source}|${o.sessionKey}|${o.date}`, [
      ...(history.get(`${o.source}|${o.sessionKey}|${o.date}`) ?? []),
      o,
    ]);
  const allSessions = [...history.entries()]
    .map(([key, sets]) => ({
      key,
      sets,
      date: (sets[0] as ObservedSet).date,
      source: (sets[0] as ObservedSet).source,
      sessionKey: (sets[0] as ObservedSet).sessionKey,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
  const sessionInfo = new Map(allSessions.map((s) => [s.key, s]));

  // índice de totales por sesión (para carga acumulada y razón)
  const sessionTotals = new Map<string, { nl: number; tonnage: number; si: number | null }>();
  for (const s of allSessions) {
    const b = bundle(inp, s.sets, s.date, s.date, inp.lift);
    sessionTotals.set(s.key, {
      nl: b.nl.value ?? 0,
      tonnage: b.tonnage.value ?? 0,
      si: b.si.rts.total.value,
    });
  }
  const sum = (keys: string[]) => ({
    nl: keys.reduce((a, k) => a + (sessionTotals.get(k)?.nl ?? 0), 0),
    tonnage: keys.reduce((a, k) => a + (sessionTotals.get(k)?.tonnage ?? 0), 0),
    si: keys.some((k) => sessionTotals.get(k)?.si !== null && sessionTotals.get(k)?.si !== undefined)
      ? keys.reduce((a, k) => a + (sessionTotals.get(k)?.si ?? 0), 0)
      : null,
  });

  const sessions: SessionRow[] = [];
  let lastFatigue: number | null = null;
  const lastFatigueBefore = new Map<string, number | null>();
  for (const s of allSessions) {
    lastFatigueBefore.set(s.key, lastFatigue);
    const f = fb.get(s.sessionKey);
    if (f !== undefined && f !== null) lastFatigue = f;
  }
  const firstDate = allSessions[0]?.date ?? null;
  for (const [key, sets] of groups) {
    const s0 = sets[0] as ObservedSet;
    const idx = allSessions.findIndex((x) => x.key === key);
    const prevSession = idx > 0 ? (allSessions[idx - 1] as (typeof allSessions)[number]) : null;
    // por ejercicio+variante
    const byEx = new Map<string, ObservedSet[]>();
    for (const o of sets)
      byEx.set(`${o.exerciseName}|${o.variantKey}`, [
        ...(byEx.get(`${o.exerciseName}|${o.variantKey}`) ?? []),
        o,
      ]);
    const exercises: ExerciseBlock[] = [...byEx.entries()].map(([exKey, exSets]) => {
      const e0 = exSets[0] as ObservedSet;
      const metrics = bundle(inp, exSets, s0.date, s0.date, undefined);
      // un accesorio (sin movimiento principal asociado) no tiene 1RM: no se estima
      const isMain = e0.lift !== null;
      if (!isMain) {
        const none = (u: string): CoreValue => ({
          value: null,
          unit: u,
          status: 'unavailable',
          missing: ['accesorio: no se estima 1RM'],
          warnings: [],
        });
        metrics.e1rm = { curve: none('kg'), prg: none('kg') };
      }
      const pr = priorities.get(`${s0.sessionKey}|${e0.exerciseName}`);
      const rpes = exSets
        .filter(isWorkSet)
        .map((x) => x.rpe)
        .filter((v): v is number => v !== null);
      const kgs = exSets
        .filter(isWorkSet)
        .map((x) => x.kg)
        .filter((v): v is number => v !== null);
      const best = isMain ? bestE1rm(exSets, domain) : { curve: null, prg: null };
      const block: ExerciseBlock = {
        exerciseName: e0.exerciseName,
        exerciseId: e0.exerciseId,
        variantKey: e0.variantKey,
        lift: e0.lift,
        pattern: patternFor(e0.exerciseId, e0.exerciseName),
        priority: pr?.priority ?? null,
        exposureRole: pr?.role ?? null,
        metrics,
        warmupSets: exSets.filter((x) => !isWorkSet(x)).length,
        bestE1rm: best,
        medianRpe: median(rpes),
        topKg: kgs.length ? Math.max(...kgs) : null,
        fatigueBetweenSets: fatigueBetweenSets(exSets, domain, targets),
        vsPrevious: null,
      };
      // sesión anterior del mismo ejercicio y variante
      for (let j = idx - 1; j >= 0; j--) {
        const ps = allSessions[j] as (typeof allSessions)[number];
        const pSets = ps.sets.filter((x) => `${x.exerciseName}|${x.variantKey}` === exKey);
        if (!pSets.length) continue;
        const pb = bundle(inp, pSets, ps.date, ps.date, undefined);
        const pBest = bestE1rm(pSets, domain);
        const pRpe = median(
          pSets
            .filter(isWorkSet)
            .map((x) => x.rpe)
            .filter((v): v is number => v !== null),
        );
        const pKgs = pSets
          .filter(isWorkSet)
          .map((x) => x.kg)
          .filter((v): v is number => v !== null);
        const pTop = pKgs.length ? Math.max(...pKgs) : null;
        const curSi = metrics.si.rts.total.value;
        const prevSi = pb.si.rts.total.value;
        block.vsPrevious = {
          previousDate: ps.date,
          daysSince: dayDiff(s0.date, ps.date),
          e1rmCurvePct: pctChange(pBest.curve, best.curve),
          e1rmPrgPct: pctChange(pBest.prg, best.prg),
          topKgDelta: block.topKg !== null && pTop !== null ? block.topKg - pTop : null,
          medianRpeDelta: block.medianRpe !== null && pRpe !== null ? block.medianRpe - pRpe : null,
          nlDelta: metrics.nl.value !== null && pb.nl.value !== null ? metrics.nl.value - pb.nl.value : null,
          siRtsTotalRatio: curSi !== null && prevSi !== null && prevSi > 0 ? curSi / prevSi : null,
        };
        break;
      }
      return block;
    });
    // fatiga entre sesiones
    const ef = fb.get(s0.sessionKey) ?? null;
    const prevF = lastFatigueBefore.get(key) ?? null;
    const rd = [...readiness].reverse().find((r) => r.date <= s0.date) ?? null;
    const prior = (days: number) =>
      allSessions.filter((x) => x.date < s0.date && dayDiff(s0.date, x.date) <= days).map((x) => x.key);
    const k7 = prior(7);
    const k28 = prior(28);
    const a7 = sum(k7);
    const c28 = sum(k28);
    const enough28 = firstDate !== null && dayDiff(s0.date, firstDate) >= 28;
    const chronic = enough28
      ? { nl: c28.nl / 4, tonnage: c28.tonnage / 4, si: c28.si === null ? null : c28.si / 4 }
      : null;
    const ratio = (a: number | null, c: number | null) => (a === null || c === null || c <= 0 ? null : a / c);
    sessions.push({
      key,
      sessionKey: s0.sessionKey,
      date: s0.date,
      source: s0.source,
      totals: bundle(inp, sets, s0.date, s0.date, undefined),
      exercises,
      muscles: muscleVolume(sets, inp.muscleConfig),
      patterns: patternVolume(sets),
      fatigue: {
        version: FATIGUE_VERSION,
        endFatigue: ef,
        endFatigueDelta: ef !== null && prevF !== null ? ef - prevF : null,
        readiness: rd ? { value: rd.value, date: rd.date, ageDays: dayDiff(s0.date, rd.date) } : null,
        daysSincePreviousSession: prevSession ? dayDiff(s0.date, prevSession.date) : null,
        rolling: {
          acute7: { nl: a7.nl, tonnage: a7.tonnage, siRtsTotal: a7.si, sessions: k7.length },
          chronicWeeklyMean28: chronic
            ? { nl: chronic.nl, tonnage: chronic.tonnage, siRtsTotal: chronic.si }
            : null,
          ratio: chronic
            ? {
                nl: ratio(a7.nl, chronic.nl),
                tonnage: ratio(a7.tonnage, chronic.tonnage),
                siRtsTotal: ratio(a7.si, chronic.si),
              }
            : null,
          coverage: enough28
            ? 'historia previa ≥ 28 días'
            : 'historia previa < 28 días: no hay razón agudo/crónico',
        },
      },
    });
  }
  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));

  // ---- semanas
  const weeks: WeekRow[] = [];
  const refs = weekRefs(inp.from, to, inp.cutoff);
  let prevBundle: { b: CoreBundle; partial: boolean } | null = null;
  for (const w of refs) {
    const wSets = inPeriod.filter((o) => o.date >= w.from && o.date <= w.to);
    const totals = bundle(inp, wSets, w.from, w.to, undefined);
    const wSessions = sessions.filter((x) => x.date >= w.from && x.date <= w.to);
    const dates = [...new Set(wSets.filter(isWorkSet).map((o) => o.date))].sort();
    const gaps = wSessions
      .map((x) => x.fatigue.daysSincePreviousSession)
      .filter((v): v is number => v !== null);
    const efs = wSessions.map((x) => x.fatigue.endFatigue).filter((v): v is number => v !== null);
    const drifts = wSessions
      .flatMap((x) => x.exercises.map((e) => e.fatigueBetweenSets.rpe?.delta ?? null))
      .filter((v): v is number => v !== null);
    let vs: WeekRow['fatigue']['vsPreviousWeek'] = null;
    if (prevBundle) {
      const comparable = !w.partial && !prevBundle.partial;
      const r = (a: number | null, b: number | null) =>
        comparable && a !== null && b !== null && b > 0 ? a / b : null;
      vs = {
        nl: r(totals.nl.value, prevBundle.b.nl.value),
        tonnage: r(totals.tonnage.value, prevBundle.b.tonnage.value),
        siRtsTotal: r(totals.si.rts.total.value, prevBundle.b.si.rts.total.value),
        comparable,
        reason: comparable
          ? null
          : 'Una de las dos semanas es parcial: no se compara dosis de duración distinta.',
      };
    }
    weeks.push({
      week: { from: w.from, to: w.to, days: w.days, partial: w.partial },
      sessions: wSessions.length,
      trainingDays: dates.length,
      totals,
      muscles: muscleVolume(wSets, inp.muscleConfig),
      patterns: patternVolume(wSets),
      fatigue: {
        endFatigue: {
          mean: efs.length ? efs.reduce((a, b) => a + b, 0) / efs.length : null,
          max: efs.length ? Math.max(...efs) : null,
          n: efs.length,
        },
        meanDaysBetweenSessions: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
        vsPreviousWeek: vs,
        meanRpeDriftPerSession: drifts.length ? drifts.reduce((a, b) => a + b, 0) / drifts.length : null,
      },
    });
    prevBundle = { b: totals, partial: w.partial };
  }

  const warnings: string[] = [];
  if (!inPeriod.length) warnings.push('No hay series en el período pedido hasta el corte.');
  if (inPeriod.some((o) => o.rpe === null && isWorkSet(o)))
    warnings.push(
      'Hay series sin RPE real: SI y e1RM por curva son parciales; NL y tonelaje no dependen del RPE.',
    );
  if (!(inp.readiness ?? []).length)
    warnings.push('Sin check-ins: no hay preparación asociada a las sesiones.');
  void sessionInfo;
  return {
    version: CORE_VERSION,
    fatigueVersion: FATIGUE_VERSION,
    cutoff: inp.cutoff,
    period: { from: inp.from, to },
    scope: { lift: inp.lift ?? null, source: inp.source ?? null },
    domain,
    totals: bundle(inp, inPeriod, inp.from, to, inp.lift),
    muscles: muscleVolume(inPeriod, inp.muscleConfig),
    patterns: patternVolume(inPeriod),
    sessions,
    weeks,
    definitions: {
      nl: 'NL = Σ repeticiones de las series de trabajo (calentamientos excluidos). No es la cantidad de series.',
      tonnage:
        'Tonelaje = Σ kg × reps de series con carga total interpretable (mancuernas por lado, peso corporal y carga desconocida se excluyen y se informan).',
      si: 'SI en tres modelos con escala propia (RTS aproximado, PRG, eFort XL): nunca se suman ni se comparan entre sí. Requieren RPE real; PRG además una referencia de fuerza fechada.',
      movementPatterns:
        'Patrón de movimiento (sentadilla, bisagra de cadera, empujes, tracciones, aislamientos, core, transporte/olímpico): cada ejercicio en un solo patrón, por lo que series, NL y tonelaje por patrón sí suman.',
      muscles: `Series directas ×${DIRECT_WEIGHT}, indirectas ×${INDIRECT_WEIGHT} (convención ${MUSCLE_CONVENTION_VERSION}, del proyecto). Sin total entre músculos.`,
      fatigueBetweenSets:
        'Deriva de RPE, caída de repeticiones a carga constante, caída del e1RM desde el máximo y SI por serie, dentro de un ejercicio y una sesión. Requiere orden de series. Descriptivo.',
      fatigueBetweenSessions:
        'Fatiga reportada al terminar la sesión, preparación previa, días desde la sesión anterior, cambios frente a la sesión anterior del mismo ejercicio y razón agudo (7 d) / crónico (promedio semanal de 28 d) de NL, tonelaje y SI. Descriptivo: sin umbrales.',
    },
    warnings,
  };
}
