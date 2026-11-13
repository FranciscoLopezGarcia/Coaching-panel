import { blockMetrics, type BlockMetrics } from '../metrics.js';
import { SI_MODEL } from '../si.js';
import type { ActualSet, Lift, PlannedSet } from '../types.js';
import { toViews, type SetView } from '../views.js';
import {
  ANALYSIS_VERSION,
  type BlockComparison,
  type BlockQuality,
  type ExerciseCard,
  type ExerciseChange,
  type MetricRow,
  type MetricSource,
} from './contracts.js';
import { delta } from './delta.js';
import { selectRecentBlocks } from './select.js';
import { variantPerformance } from './variant-performance.js';

export interface BlockComparisonInput {
  planned: PlannedSet[];
  actual: ActualSet[];
  currentBlockKey: string;
  asOf: string;
  source: MetricSource;
  /** 'ALL' = todos los lifts. */
  lift?: Lift | 'ALL';
}

interface Spec {
  id: string;
  unit: string;
  pp?: boolean;
  family?: string;
  get: (m: BlockMetrics) => number | null;
}

const SPECS: Spec[] = [
  { id: 'nl_per_week', unit: 'reps/sem', get: (m) => m.perWeek.nl },
  { id: 'sets_per_week', unit: 'series/sem', get: (m) => m.perWeek.sets },
  {
    id: 'tonnage_per_week',
    unit: 'kg·rep/sem',
    get: (m) => (m.totals.tonnage === null ? null : m.totals.tonnage / m.weeks.length),
  },
  { id: 'frequency_per_week', unit: 'sesiones/sem', get: (m) => m.perWeek.frequency },
  {
    id: 'intensity_pct_sets',
    unit: '%1RM',
    pp: true,
    get: (m) => (m.perWeek.meanPct === null ? null : 100 * m.perWeek.meanPct),
  },
  {
    id: 'intensity_pct_reps',
    unit: '%1RM',
    pp: true,
    get: (m) => (m.perWeek.meanPctByReps === null ? null : 100 * m.perWeek.meanPctByReps),
  },
  { id: 'rpe_mean', unit: 'RPE', get: (m) => m.perWeek.meanRpe },
  { id: 'si_total_per_week', unit: 'SI/sem', family: SI_MODEL, get: (m) => m.perWeek.si?.total ?? null },
];

/**
 * Comparación de la ventana móvil (actual + 3 anteriores), solo bloques VECINOS. `planned` y `actual` nunca se mezclan.
 * El e1RM por variante sale siempre de lo ejecutado, también en modo `planned`.
 */
export function compareAdjacentBlocks(inp: BlockComparisonInput): BlockComparison | null {
  const window = selectRecentBlocks(inp.planned, inp.currentBlockKey, inp.asOf);
  if (!window) return null;
  const lift = inp.lift ?? 'ALL';
  const views = toViews(inp.planned, inp.actual, inp.source, inp.asOf);
  const per = window.blocks.map((b) => blockMetrics(views, lift, b.blockKey));
  const rows: MetricRow[] = SPECS.map((sp) => {
    const values = per.map((m) => (m ? sp.get(m) : null));
    return {
      metricId: sp.id,
      unit: sp.unit,
      values,
      deltas: values.slice(1).map((v, i) => delta(v, values[i] as number | null, sp.unit, { pp: sp.pp })),
      modelFamily: sp.family ?? null,
    };
  });
  const quality = window.blocks.map((b) => blockQuality(inp.planned, inp.actual, b.blockKey, inp.asOf, lift));
  if (inp.source === 'actual')
    rows.push({
      metricId: 'adherence_sets',
      unit: '%',
      modelFamily: null,
      values: quality.map((q) => (q.adherence === null ? null : 100 * q.adherence)),
      deltas: quality
        .slice(1)
        .map((q, i) =>
          delta(
            q.adherence === null ? null : 100 * q.adherence,
            (quality[i] as BlockQuality).adherence === null
              ? null
              : 100 * ((quality[i] as BlockQuality).adherence as number),
            '%',
            { pp: true },
          ),
        ),
    });
  const variants = window.blocks.flatMap((b) =>
    variantPerformance(
      inp.planned,
      inp.actual,
      b.blockKey,
      inp.asOf,
      b.closed,
      lift === 'ALL' ? undefined : lift,
    ),
  );
  return {
    version: ANALYSIS_VERSION,
    source: inp.source,
    window,
    lift,
    rows,
    changes: exerciseChanges(
      inp.planned,
      window.blocks.map((b) => b.blockKey),
      lift,
    ),
    quality,
    cards: window.blocks.flatMap((b) => exerciseCards(inp.planned, views, b.blockKey, b.weeks, lift)),
    variants,
  };
}

export function blockQuality(
  planned: PlannedSet[],
  actual: ActualSet[],
  blockKey: string,
  asOf: string,
  lift: Lift | 'ALL',
): BlockQuality {
  const amap = new Map(actual.map((a) => [a.plannedSetId, a]));
  let n = 0;
  let done = 0;
  let skipped = 0;
  for (const s of planned) {
    if (s.isWarmup || s.lift === null || s.blockKey !== blockKey || s.plannedDate > asOf) continue;
    if (lift !== 'ALL' && s.lift !== lift) continue;
    n++;
    const a = amap.get(s.id);
    if (a?.status === 'done' && a.performedOn && a.performedOn <= asOf) done++;
    else if (a?.status === 'skipped') skipped++;
  }
  const known = done + skipped;
  return {
    blockKey,
    planned: n,
    done,
    skipped,
    unknown: n - known,
    coverage: n ? known / n : null,
    adherence: known ? done / known : null,
  };
}

/** Una tarjeta por variante y bloque con su dosis normalizada por semana del bloque. */
export function exerciseCards(
  planned: PlannedSet[],
  views: SetView[],
  blockKey: string,
  weeks: number,
  lift: Lift | 'ALL',
): ExerciseCard[] {
  const meta = new Map<string, PlannedSet>();
  for (const s of planned)
    if (
      !s.isWarmup &&
      s.lift !== null &&
      s.blockKey === blockKey &&
      (lift === 'ALL' || s.lift === lift) &&
      !meta.has(s.variantKey)
    )
      meta.set(s.variantKey, s);
  const w = Math.max(1, weeks);
  const out: ExerciseCard[] = [];
  for (const [vk, m] of meta) {
    const v = views.filter((x) => x.blockKey === blockKey && x.variantKey === vk);
    if (!v.length) continue;
    const withPct = v.filter((x) => x.kg !== null && x.refKg);
    const p = m.protocol;
    out.push({
      blockKey,
      lift: m.lift as Lift,
      variantKey: vk,
      exerciseName: m.exerciseName,
      exposureId: m.exposureId,
      role: m.exposureRole,
      priority: m.priority,
      protocol: p
        ? [
            p.segment,
            p.loadMode,
            p.tempo ? `tempo ${p.tempo}` : null,
            p.pauseSec ? `pausa ${p.pauseSec}s` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : null,
      sets: v.length,
      nl: v.reduce((a, x) => a + x.reps, 0),
      setsPerWeek: v.length / w,
      nlPerWeek: v.reduce((a, x) => a + x.reps, 0) / w,
      intensityPct: withPct.length
        ? (100 * withPct.reduce((a, x) => a + (x.kg as number) / (x.refKg as number), 0)) / withPct.length
        : null,
      sessionsPerWeek: new Set(v.map((x) => x.sessionKey)).size / w,
      tonnage: v.every((x) => x.kg !== null) ? v.reduce((a, x) => a + (x.kg as number) * x.reps, 0) : null,
    });
  }
  return out.sort(
    (a, b) => (a.priority ?? 99) - (b.priority ?? 99) || (a.variantKey < b.variantKey ? -1 : 1),
  );
}

interface Presence {
  exposureId: string;
  role: string | null;
  priority: number | null;
  slot: string;
}

/** Eventos estructurales entre bloques vecinos (por `variantKey`); nunca interpreta texto libre ni intenciones. */
export function exerciseChanges(
  planned: PlannedSet[],
  blockKeys: string[],
  lift: Lift | 'ALL',
): ExerciseChange[] {
  const byBlock = blockKeys.map((bk) => {
    const m = new Map<string, Presence>();
    for (const s of planned) {
      if (s.isWarmup || s.lift === null || s.blockKey !== bk || (lift !== 'ALL' && s.lift !== lift)) continue;
      if (!m.has(s.variantKey))
        m.set(s.variantKey, {
          exposureId: s.exposureId,
          role: s.exposureRole,
          priority: s.priority,
          slot: s.slotKey,
        });
    }
    return m;
  });
  const out: ExerciseChange[] = [];
  for (let i = 1; i < blockKeys.length; i++) {
    const prev = byBlock[i - 1] as Map<string, Presence>;
    const cur = byBlock[i] as Map<string, Presence>;
    const fromBlock = blockKeys[i - 1] as string;
    const toBlock = blockKeys[i] as string;
    const everBefore = new Set(byBlock.slice(0, i - 1).flatMap((m) => [...m.keys()]));
    for (const [vk, c] of cur) {
      const p = prev.get(vk);
      if (!p) {
        out.push({
          variantKey: vk,
          exposureId: c.exposureId,
          fromBlock,
          toBlock,
          event: everBefore.has(vk) ? 'resumed_variant' : 'new_variant',
          detail: null,
        });
        continue;
      }
      const base = { variantKey: vk, exposureId: c.exposureId, fromBlock, toBlock };
      if (p.role !== c.role)
        out.push({
          ...base,
          event: 'role_change',
          detail: `${p.role ?? 'sin_rol'} → ${c.role ?? 'sin_rol'}`,
        });
      if (p.priority !== c.priority)
        out.push({
          ...base,
          event: 'priority_change',
          detail: `${p.priority ?? 'sin_prioridad'} → ${c.priority ?? 'sin_prioridad'}`,
        });
      if (p.slot !== c.slot) out.push({ ...base, event: 'slot_change', detail: `${p.slot} → ${c.slot}` });
    }
    for (const [vk, p] of prev)
      if (!cur.has(vk))
        out.push({
          variantKey: vk,
          exposureId: p.exposureId,
          fromBlock,
          toBlock,
          event: 'removed_variant',
          detail: null,
        });
  }
  return out;
}
