import { daysBetween } from './dates.js';
import { evaluateChange, type Change } from './change.js';
import type { ChangeEvent } from './diff.js';
import { buildExposures, emptyQuality } from './exposures.js';
import { median } from './format.js';
import { blockMetrics, type BlockMetrics } from './metrics.js';
import type { EngineParams } from './params.js';
import type { ActualSet, Exposure, Lift, PlannedSet, Readiness } from './types.js';
import { toViews } from './views.js';

/**
 * Cuatro nociones DISTINTAS (no se confunden):
 *  - tiempo hasta una mejora relevante (E supera el inicio por el cambio mínimo);
 *  - tiempo hasta el mejor rendimiento observado (no implica un pico);
 *  - ventana favorable observada (exposiciones dentro del cambio mínimo del mejor valor; solo si el mejor quedó delimitado);
 *  - estimación basada en bloques anteriores comparables (a nivel de familia; descriptiva, sin fecha exacta).
 * Un bloque que termina mientras el atleta sigue mejorando es una observación CENSURADA (incompleta), nunca un pico confirmado.
 */
export type TtpState = 'delimitado' | 'censurado' | 'en_curso' | 'insuficiente' | 'no_concluyente';

export interface Ttp {
  state: TtpState;
  /** Semana del bloque (1-based) de la mejor exposición. */
  bestWeek: number | null;
  bestDate: string | null;
  bestE: number | null;
  /** Ventana favorable observada, en semanas del bloque. Solo con el mejor valor delimitado. */
  windowWeeks: [number, number] | null;
  timeToRelevantImprovementWeeks: number | null;
  timeToBestWeeks: number | null;
  /** Observación incompleta: el bloque terminó (o sigue) sin delimitar el mejor momento. */
  censored: boolean;
  /** El estímulo cambió dentro del bloque: el TTP no debe atribuirse a una duración única. */
  segmented: boolean;
  segmentBoundaries: string[];
  note: string;
  warnings: string[];
}

export interface BlockSummary {
  lift: Lift;
  blockKey: string;
  familyKey: string;
  startDate: string;
  endDate: string;
  weeks: number;
  closed: boolean;
  planned: BlockMetrics | null;
  actual: BlockMetrics | null;
  /** Estructura prevista: ejercicios con rol/prioridad (identidad), para describir el microciclo. */
  exposures: {
    exposureId: string;
    exerciseName: string;
    role: string | null;
    priority: number | null;
    sessionsPerWeek: number;
  }[];
  /** Cantidad de exposiciones comparables del benchmark (con RPE real). */
  comparableExposures: number;
  /** Series hechas / series previstas (de las sesiones del bloque ya transcurridas). */
  compliance: number | null;
  rpeDevMedian: number | null;
  eStart: number | null;
  eEnd: number | null;
  eChange: Change | null;
  readinessMean: number | null;
  stimulusChanges: { id: string; effectiveOn: string; classification: string }[];
  ttp: Ttp;
  /** Respuesta favorable: E sube al menos el cambio mínimo, con cumplimiento y esfuerzo dentro de lo previsto. null si falta algún insumo. */
  favorable: boolean | null;
}

export interface BlocksInput {
  planned: PlannedSet[];
  actual: ActualSet[];
  readiness: Readiness[];
  competitionExercises: Partial<Record<Lift, string>>;
  cutoff: string;
  params: EngineParams;
  /** Cambios de programación detectados (para marcar cambios de estímulo dentro de un bloque). */
  events?: ChangeEvent[];
}

const GAP_DAYS = 14;

export function computeTtp(
  comp: Exposure[],
  weekOf: (e: Exposure) => number,
  closed: boolean,
  minCfg: EngineParams['perLift'][Lift],
  boundaries: string[] = [],
): Ttp {
  const seg = boundaries.length > 0;
  const base: Ttp = {
    state: 'insuficiente',
    bestWeek: null,
    bestDate: null,
    bestE: null,
    windowWeeks: null,
    timeToRelevantImprovementWeeks: null,
    timeToBestWeeks: null,
    censored: false,
    segmented: seg,
    segmentBoundaries: boundaries,
    note: '',
    warnings: [],
  };
  const segWarn = seg
    ? [
        `El estímulo cambió dentro del bloque (${boundaries.join(', ')}): el TTP corresponde al bloque completo y no debe atribuirse a una única duración; conviene segmentar el análisis en esas fechas.`,
      ]
    : [];
  if (comp.length < 4)
    return {
      ...base,
      warnings: segWarn,
      note: `Solo ${comp.length} exposiciones comparables: no alcanza para ubicar el mejor momento.`,
    };
  let best = comp[0] as Exposure;
  for (const e of comp) if ((e.e as number) >= (best.e as number)) best = e;
  const idx = comp.indexOf(best);
  const bestWeek = weekOf(best);
  const hasMin = (minCfg.minChangePct ?? 0) > 0 || (minCfg.minChangeKg ?? 0) > 0;
  const e0 = (comp[0] as Exposure).e as number;
  const improved = hasMin
    ? comp.find((e) => {
        const ch = evaluateChange(e0, (e.e as number) - e0, minCfg);
        return ch.exceeds === true && ch.kg > 0;
      })
    : undefined;
  const out: Ttp = {
    ...base,
    bestWeek,
    bestDate: best.date,
    bestE: best.e,
    timeToBestWeeks: bestWeek,
    timeToRelevantImprovementWeeks: improved ? weekOf(improved) : null,
    warnings: segWarn,
  };
  const gap = comp.some((e, i) => i > 0 && daysBetween(e.date, (comp[i - 1] as Exposure).date) > GAP_DAYS);
  const after = comp.length - 1 - idx;
  if (!closed)
    return {
      ...out,
      state: 'en_curso',
      censored: true,
      note: 'El bloque sigue en curso: el mejor valor actual es una observación incompleta, no un pico delimitado.',
    };
  if (after < 2)
    return {
      ...out,
      state: 'censurado',
      censored: true,
      note: 'El bloque terminó mientras el atleta seguía mejorando (o en su mejor valor): observación censurada, no se confirma un pico.',
    };
  if (gap)
    return {
      ...out,
      state: 'no_concluyente',
      note: `Hay pausas de más de ${GAP_DAYS} días: una pausa por enfermedad o agenda no establece un pico.`,
    };
  const near = comp.filter((e) => {
    const ch = evaluateChange(best.e as number, (e.e as number) - (best.e as number), minCfg);
    return hasMin ? !ch.exceeds : e === best;
  });
  const ws = near.map(weekOf);
  return {
    ...out,
    state: 'delimitado',
    windowWeeks: [Math.min(...ws), Math.max(...ws)],
    note: hasMin
      ? 'Ventana = exposiciones dentro del cambio mínimo del mejor valor.'
      : 'Sin cambio mínimo definido: la ventana se reduce a la semana del mejor valor.',
  };
}

/**
 * Resumen por bloque y lift: dosis prevista vs realizada (normalizada por semana), cumplimiento, respuesta de E (benchmark = ejercicio de competencia),
 * recuperación media y TTP observado. Todo hasta el corte; sin datos posteriores.
 */
export function summarizeBlocks(inp: BlocksInput): BlockSummary[] {
  const out: BlockSummary[] = [];
  const plannedViews = toViews(inp.planned, inp.actual, 'planned', inp.cutoff);
  const actualViews = toViews(inp.planned, inp.actual, 'actual', inp.cutoff);
  const amap = new Map(inp.actual.map((a) => [a.plannedSetId, a]));
  for (const lift of Object.keys(inp.competitionExercises) as Lift[]) {
    const cfg = inp.params.perLift[lift];
    const lp = inp.planned.filter((s) => s.lift === lift && !s.isWarmup);
    for (const blockKey of [...new Set(lp.map((s) => s.blockKey))]) {
      const bs = lp.filter((s) => s.blockKey === blockKey);
      const dates = bs.map((s) => s.plannedDate).sort();
      const startDate = dates[0] as string;
      const endDate = dates[dates.length - 1] as string;
      const bench = bs.filter((s) => s.exerciseName === inp.competitionExercises[lift]);
      const exps = buildExposures(bench, amap, inp.cutoff, emptyQuality());
      const comp = exps.filter((e) => e.e !== null);
      const weekOfExp = (e: Exposure) => (e.plannedSets[0] as PlannedSet).weekNo;
      const N = inp.params.nExposures;
      const eStart = comp.length >= 2 * N ? median(comp.slice(0, N).map((e) => e.e as number)) : null;
      const eEnd = comp.length >= 2 * N ? median(comp.slice(-N).map((e) => e.e as number)) : null;
      const eChange = eStart !== null && eEnd !== null ? evaluateChange(eStart, eEnd - eStart, cfg) : null;
      const past = bs.filter((s) => s.plannedDate <= inp.cutoff);
      const doneN = past.filter((s) => amap.get(s.id)?.status === 'done').length;
      const devs = comp.map((e) => e.rpeDev).filter((d): d is number => d !== null);
      const rd = inp.readiness.filter(
        (r) => r.date >= startDate && r.date <= (endDate < inp.cutoff ? endDate : inp.cutoff),
      );
      const closed = endDate < inp.cutoff;
      const compliance = past.length ? doneN / past.length : null;
      const rpeDevMedian = devs.length ? median(devs) : null;
      const favorable =
        eChange === null || !eChange.defined || compliance === null || rpeDevMedian === null
          ? null
          : eChange.exceeds === true &&
            eChange.kg > 0 &&
            compliance >= inp.params.minCompliance &&
            rpeDevMedian <= inp.params.rpeTolerance;
      const stimulusChanges = (inp.events ?? [])
        .filter(
          (e) =>
            e.status === 'aplicado' && e.effectiveOn && e.effectiveOn > startDate && e.effectiveOn <= endDate,
        )
        .flatMap((e) =>
          e.changes
            .filter(
              (ch) =>
                ch.lift === lift &&
                ch.blockKey === blockKey &&
                !['bloque_nuevo', 'bloque_retirado', 'sin_cambios'].includes(ch.classification),
            )
            .map((ch) => ({
              id: e.id,
              effectiveOn: e.effectiveOn as string,
              classification: ch.classification,
            })),
        );
      const weeksN = new Set(bs.map((s) => s.weekNo)).size;
      const byExposure = new Map<string, PlannedSet[]>();
      for (const s of bs) byExposure.set(s.exposureId, [...(byExposure.get(s.exposureId) ?? []), s]);
      out.push({
        lift,
        blockKey,
        familyKey: (bs[0] as PlannedSet).familyKey,
        startDate,
        endDate,
        weeks: weeksN,
        closed,
        planned: blockMetrics(plannedViews, lift, blockKey),
        actual: blockMetrics(actualViews, lift, blockKey),
        exposures: [...byExposure.entries()].map(([exposureId, sets]) => ({
          exposureId,
          exerciseName: (sets[0] as PlannedSet).exerciseName,
          role: (sets[0] as PlannedSet).exposureRole,
          priority: (sets[0] as PlannedSet).priority,
          sessionsPerWeek:
            new Set(sets.map((s) => s.sessionKey)).size /
            Math.max(1, new Set(sets.map((s) => s.weekNo)).size),
        })),
        comparableExposures: comp.length,
        compliance,
        rpeDevMedian,
        eStart,
        eEnd,
        eChange,
        readinessMean: rd.length ? rd.reduce((s, r) => s + r.value, 0) / rd.length : null,
        stimulusChanges,
        ttp: computeTtp(
          comp,
          weekOfExp,
          closed,
          cfg,
          stimulusChanges.map((x) => x.effectiveOn),
        ),
        favorable,
      });
    }
  }
  return out.sort((a, b) => (a.startDate < b.startDate ? -1 : 1) || a.lift.localeCompare(b.lift));
}

export interface FamilyMeta {
  objective?: string;
  goldenConfirmed?: boolean;
}

/** Descripción de un candidato a microciclo golden. NO es "el microciclo óptimo" ni una causa demostrada del progreso. */
export interface GoldenCandidate {
  blockKey: string;
  structure: { weeks: number; sessionsPerWeek: number; setsPerWeek: number | null };
  exercises: BlockSummary['exposures'];
  dose: { nlPerWeek: number | null; frequency: number | null; nlByDay: Record<number, number> };
  objective: string | null;
  context: string | null;
  response: {
    eChangeKg: number | null;
    eChangePct: number | null;
    compliance: number | null;
    rpeDevMedian: number | null;
  };
  /** Cuántos ciclos de la familia mostraron respuesta favorable. */
  repetitions: number;
  status: 'exploratorio' | 'patron_repetido';
  limitations: string[];
}

export interface FamilyComparability {
  /** Qué hace comparables a los bloques de una familia en este sistema. */
  basis: string[];
  consistent: boolean;
  members: {
    blockKey: string;
    nlPerWeek: number | null;
    frequency: number | null;
    exercises: string[];
    nlDeviationPct: number | null;
  }[];
  notes: string[];
}

export interface FamilySummary {
  lift: Lift;
  familyKey: string;
  cycles: number;
  delimited: number;
  windows: { blockKey: string; weeks: [number, number]; bestWeek: number }[];
  bestWeekMedian: number | null;
  bestWeekRange: [number, number] | null;
  /** 1 ciclo delimitado: observación preliminar; ≥ 2 delimitados Y comparables: patrón repetido. Sin porcentajes. */
  pattern: 'insuficiente' | 'observacion_preliminar' | 'patron_repetido';
  /** Bloques con observación incompleta (censurada o en curso). */
  censored: string[];
  excluded: string[];
  comparability: FamilyComparability;
  /** Estimación DESCRIPTIVA para un próximo ciclo comparable: rango de semanas observado. No es una fecha de pico. */
  estimateForNext: { range: [number, number] | null; n: number; basis: string; caveat: string } | null;
  golden: 'sin_evidencia' | 'exploratorio' | 'patron_repetido';
  goldenCandidate: GoldenCandidate | null;
  goldenBlocks: string[];
  objective: string | null;
  coachConfirmed: boolean;
  note: string;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Agrupa por la familia declarada por el coach (`familyKey`) y CONTROLA qué hace comparables a sus bloques: mismos ejercicios,
 * misma frecuencia y dosis semanal de NL dentro de `familyTolerancePct`. Si la familia es inconsistente se advierte y no se habla de patrón repetido.
 */
export function summarizeFamilies(
  blocks: BlockSummary[],
  meta: Record<string, FamilyMeta> = {},
  params?: EngineParams,
): FamilySummary[] {
  const tol = params?.familyTolerancePct ?? 25;
  const groups = new Map<string, BlockSummary[]>();
  for (const b of blocks)
    groups.set(`${b.lift}|${b.familyKey}`, [...(groups.get(`${b.lift}|${b.familyKey}`) ?? []), b]);
  const out: FamilySummary[] = [];
  for (const [key, bs] of groups) {
    const [lift, familyKey] = key.split('|') as [Lift, string];
    const m = meta[familyKey] ?? {};
    const technical = !!m.objective && !/fuerza|rendimiento|peak|pico|progres/i.test(m.objective);
    const nls = bs.map((b) => b.planned?.perWeek.nl ?? null);
    const medNl = median(
      nls.filter((x): x is number => x !== null).length ? nls.filter((x): x is number => x !== null) : [0],
    );
    const members = bs.map((b, i) => ({
      blockKey: b.blockKey,
      nlPerWeek: nls[i] ?? null,
      frequency: b.planned?.perWeek.frequency ?? null,
      exercises: b.planned?.exercises ?? [],
      nlDeviationPct: nls[i] !== null && medNl > 0 ? (100 * ((nls[i] as number) - medNl)) / medNl : null,
    }));
    const sameEx = members.every(
      (x) => x.exercises.join('|') === (members[0] as (typeof members)[number]).exercises.join('|'),
    );
    const sameFreq = members.every((x) => x.frequency === (members[0] as (typeof members)[number]).frequency);
    const inTol = members.every((x) => x.nlDeviationPct === null || Math.abs(x.nlDeviationPct) <= tol);
    const notes: string[] = [];
    if (!sameEx) notes.push('Los bloques no comparten el mismo conjunto de ejercicios.');
    if (!sameFreq) notes.push('Los bloques no comparten la misma frecuencia semanal.');
    if (!inTol) notes.push(`La dosis semanal de NL difiere más de ${tol} % entre bloques.`);
    const consistent = bs.length < 2 ? true : sameEx && sameFreq && inTol;
    const del = bs.filter(
      (b) => b.ttp.state === 'delimitado' && b.ttp.windowWeeks && b.ttp.bestWeek !== null,
    );
    const weeks = del.map((b) => b.ttp.bestWeek as number);
    const fav = bs.filter((b) => b.favorable === true);
    const pattern: FamilySummary['pattern'] =
      del.length >= 2 && consistent
        ? 'patron_repetido'
        : del.length >= 1
          ? 'observacion_preliminar'
          : 'insuficiente';
    let golden: FamilySummary['golden'] = 'sin_evidencia';
    let goldenCandidate: GoldenCandidate | null = null;
    if (!technical && fav.length) {
      golden = fav.length >= 2 && consistent ? 'patron_repetido' : 'exploratorio';
      const b = [...fav].sort((x, y) => (x.endDate < y.endDate ? 1 : -1))[0] as BlockSummary;
      goldenCandidate = {
        blockKey: b.blockKey,
        structure: {
          weeks: b.weeks,
          sessionsPerWeek: b.planned?.perWeek.frequency ?? 0,
          setsPerWeek: b.planned?.perWeek.sets ?? null,
        },
        exercises: b.exposures,
        dose: {
          nlPerWeek: b.planned?.perWeek.nl ?? null,
          frequency: b.planned?.perWeek.frequency ?? null,
          nlByDay: b.planned?.perWeek.nlByDay ?? {},
        },
        objective: m.objective ?? null,
        context: null,
        response: {
          eChangeKg: b.eChange?.kg ?? null,
          eChangePct: b.eChange?.pct ?? null,
          compliance: b.compliance,
          rpeDevMedian: b.rpeDevMedian,
        },
        repetitions: fav.length,
        status: golden === 'patron_repetido' ? 'patron_repetido' : 'exploratorio',
        limitations: [
          'No es el microciclo óptimo ni permanente: es una estructura con respuesta favorable observada.',
          'No demuestra que la estructura haya causado el progreso (otras variables no controladas).',
          golden === 'exploratorio'
            ? 'Un solo ciclo favorable (o familia inconsistente): candidato exploratorio, sin repetición del patrón.'
            : 'Repetición observada en ciclos comparables; sigue siendo descriptiva.',
          'El contexto (fase, competencia, enfermedad) no se registra automáticamente: lo confirma el coach.',
          ...(m.objective ? [] : ['Objetivo no declarado: se asume que el e1RM es la medida de interés.']),
        ],
      };
    }
    out.push({
      lift,
      familyKey,
      cycles: bs.length,
      delimited: del.length,
      windows: del.map((b) => ({
        blockKey: b.blockKey,
        weeks: b.ttp.windowWeeks as [number, number],
        bestWeek: b.ttp.bestWeek as number,
      })),
      bestWeekMedian: weeks.length ? median(weeks) : null,
      bestWeekRange: weeks.length ? [Math.min(...weeks), Math.max(...weeks)] : null,
      pattern,
      censored: bs
        .filter((b) => b.ttp.censored)
        .map((b) => `${b.blockKey}: ${b.ttp.state.replace('_', ' ')}`),
      excluded: bs
        .filter((b) => b.ttp.state !== 'delimitado')
        .map((b) => `${b.blockKey}: ${b.ttp.state.replace('_', ' ')}`),
      comparability: {
        basis: [
          `Familia declarada por el coach (${familyKey}).`,
          'Comparables si comparten el conjunto de ejercicios, la frecuencia semanal y una dosis semanal de NL dentro de la tolerancia.',
          `Tolerancia de dosis: ±${tol} % (propuesta, configurable).`,
        ],
        consistent,
        members,
        notes,
      },
      estimateForNext: del.length
        ? {
            range: [Math.min(...weeks), Math.max(...weeks)],
            n: del.length,
            basis: 'bloques anteriores comparables de la misma familia',
            caveat: consistent
              ? 'Descriptivo: rango observado en ciclos previos. No es una fecha ni una predicción de pico.'
              : 'La familia es inconsistente: el rango no es una base fiable.',
          }
        : null,
      golden,
      goldenCandidate,
      goldenBlocks: fav.map((b) => b.blockKey),
      objective: m.objective ?? null,
      coachConfirmed: !!m.goldenConfirmed,
      note: technical
        ? 'Objetivo técnico/de otra naturaleza: no se juzga por la subida de e1RM.'
        : 'Candidato = respuesta favorable con cumplimiento y esfuerzo aceptables; el coach confirma contexto y objetivo.',
    });
  }
  return out.sort((a, b) => a.lift.localeCompare(b.lift) || a.familyKey.localeCompare(b.familyKey));
}
void mean;
