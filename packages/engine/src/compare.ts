import { SI_MODEL } from './si.js';
import { summarizeBlocks, type BlockSummary, type BlocksInput, type FamilyMeta } from './blocks.js';
import { blockMetrics, type BlockMetrics } from './metrics.js';
import { toViews, type Universe } from './views.js';
import type { Lift } from './types.js';

export type CoverageLevel = 'completa' | 'parcial' | 'sin_datos';

export interface CompareRow {
  key: string;
  label: string;
  unit: string;
  a: number | string | null;
  b: number | string | null;
  diff: number | null;
  pctDiff: number | null;
  coverage: CoverageLevel;
  note?: string;
}

export interface SideRef {
  lift: Lift | 'ALL';
  blockKey: string;
}

export interface Comparison {
  universe: Universe;
  scope: 'shared' | 'full';
  /** N semanas compartidas usadas en la vista 'shared' (visible, no oculto). */
  sharedWeeks: number;
  a: SideRef;
  b: SideRef;
  weeksA: number;
  weeksB: number;
  rows: CompareRow[];
  notes: string[];
}

export interface CompareInput extends BlocksInput {
  families?: Record<string, FamilyMeta>;
}

const num = (v: number | string | null) => (typeof v === 'number' ? v : null);

function row(
  key: string,
  label: string,
  unit: string,
  a: number | string | null,
  b: number | string | null,
  note?: string,
): CompareRow {
  const na = num(a);
  const nb = num(b);
  const diff = na !== null && nb !== null ? nb - na : null;
  const coverage: CoverageLevel =
    a === null && b === null ? 'sin_datos' : a === null || b === null ? 'parcial' : 'completa';
  return {
    key,
    label,
    unit,
    a,
    b,
    diff,
    pctDiff: diff !== null && na !== null && na > 0 ? (100 * diff) / na : null,
    coverage,
    ...(note ? { note } : {}),
  };
}

const dist = (m: BlockMetrics | null) =>
  m
    ? Object.entries(m.perWeek.nlByDay)
        .sort(([x], [y]) => Number(x) - Number(y))
        .map(([d, v]) => `D${d} ${Math.round(v * 10) / 10}`)
        .join(' · ')
    : null;

/**
 * Comparativa A/B de bloques (por lift o contexto global). PLANIFICADO y REALIZADO son universos separados; no se mezclan.
 * Vista 'shared': primeras N semanas compartidas (N visible). Vista 'full': bloque completo, sin esconder diferencias de duración.
 * Todo normalizado POR SEMANA; los totales brutos se muestran aparte para no inducir a error.
 */
export function compareBlocks(
  inp: CompareInput,
  a: SideRef,
  b: SideRef,
  universe: Universe,
  scope: 'shared' | 'full',
): Comparison {
  const views = toViews(inp.planned, inp.actual, universe, inp.cutoff);
  const fullA = blockMetrics(views, a.lift, a.blockKey);
  const fullB = blockMetrics(views, b.lift, b.blockKey);
  const weeksA = fullA?.weeks.length ?? 0;
  const weeksB = fullB?.weeks.length ?? 0;
  const shared = Math.min(weeksA, weeksB);
  const take = (m: BlockMetrics | null, ref: SideRef) =>
    scope === 'full' || !m ? m : blockMetrics(views, ref.lift, ref.blockKey, m.weeks.slice(0, shared));
  const A = take(fullA, a);
  const B = take(fullB, b);
  const notes: string[] = [];
  if (weeksA !== weeksB)
    notes.push(
      `Los bloques duran ${weeksA} y ${weeksB} semanas: las dosis se comparan POR SEMANA y los totales brutos no son comparables entre sí.`,
    );
  if (scope === 'shared') notes.push(`Vista de las primeras ${shared} semanas compartidas.`);
  notes.push(
    universe === 'planned'
      ? 'Universo PLANIFICADO: lo prescrito, no lo ejecutado.'
      : 'Universo REALIZADO: solo series hechas hasta el corte.',
  );
  const pa = A?.perWeek;
  const pb = B?.perWeek;
  const rows: CompareRow[] = [
    row(
      'weeks',
      'Duración',
      'semanas',
      fullA ? weeksA : null,
      fullB ? weeksB : null,
      scope === 'shared' ? 'duración real de cada bloque' : undefined,
    ),
    row('sets', 'Series por semana', 'series', pa?.sets ?? null, pb?.sets ?? null),
    row(
      'nl',
      'NL por semana',
      'reps',
      pa?.nl ?? null,
      pb?.nl ?? null,
      'NL = Σ repeticiones, no cantidad de series',
    ),
    row('freq', 'Frecuencia', 'sesiones/sem', pa?.frequency ?? null, pb?.frequency ?? null),
    row('dist', 'Distribución de NL por día', 'reps', dist(A), dist(B)),
    row('kg', 'Carga media', 'kg', pa?.meanKg ?? null, pb?.meanKg ?? null),
    row(
      'pct',
      'Intensidad relativa media',
      '% ref',
      pa?.meanPct != null ? 100 * pa.meanPct : null,
      pb?.meanPct != null ? 100 * pb.meanPct : null,
      'según referencia fechada',
    ),
    row(
      'rpe',
      universe === 'planned' ? 'RPE objetivo medio' : 'RPE real medio',
      'RPE',
      pa?.meanRpe ?? null,
      pb?.meanRpe ?? null,
    ),
    row(
      'si_total',
      'SI total',
      'SI',
      pa?.si?.total ?? null,
      pb?.si?.total ?? null,
      `modelo ${SI_MODEL} [aproximado]; ${universe === 'planned' ? 'solo si todas las series tienen RPE objetivo' : 'solo si todas las series tienen RPE real'}`,
    ),
    row('si_central', 'SI central', 'SI', pa?.si?.central ?? null, pb?.si?.central ?? null, SI_MODEL),
    row(
      'si_peripheral',
      'SI periférico',
      'SI',
      pa?.si?.peripheral ?? null,
      pb?.si?.peripheral ?? null,
      SI_MODEL,
    ),
    row(
      'sets_total',
      'Series totales (bruto)',
      'series',
      A?.totals.sets ?? null,
      B?.totals.sets ?? null,
      'total bruto del tramo',
    ),
    row(
      'nl_total',
      'NL total (bruto)',
      'reps',
      A?.totals.nl ?? null,
      B?.totals.nl ?? null,
      'total bruto del tramo',
    ),
    row('tonnage', 'Tonelaje total (bruto)', 'kg', A?.totals.tonnage ?? null, B?.totals.tonnage ?? null),
  ];
  if (universe === 'actual') {
    const sums = summarizeBlocks(inp);
    const find = (r: SideRef): BlockSummary | undefined =>
      r.lift === 'ALL' ? undefined : sums.find((s) => s.lift === r.lift && s.blockKey === r.blockKey);
    const sa = find(a);
    const sb = find(b);
    const glob = a.lift === 'ALL' || b.lift === 'ALL';
    const nd = glob ? 'no se suman máximos no simultáneos como total real' : undefined;
    rows.push(
      row(
        'e_start',
        'e1RM al inicio (mediana de las primeras N)',
        'kg',
        glob ? null : (sa?.eStart ?? null),
        glob ? null : (sb?.eStart ?? null),
        nd,
      ),
      row(
        'e_end',
        'e1RM al final (mediana de las últimas N)',
        'kg',
        glob ? null : (sa?.eEnd ?? null),
        glob ? null : (sb?.eEnd ?? null),
        nd,
      ),
      row(
        'e_delta',
        'Cambio de e1RM en el bloque',
        'kg',
        sa?.eChange?.kg ?? null,
        sb?.eChange?.kg ?? null,
        glob ? nd : undefined,
      ),
      row(
        'compliance',
        'Adherencia (series hechas/previstas)',
        '%',
        sa?.compliance != null ? 100 * sa.compliance : null,
        sb?.compliance != null ? 100 * sb.compliance : null,
      ),
      row(
        'rpe_dev',
        'RPE real − objetivo (mediana)',
        'RPE',
        sa?.rpeDevMedian ?? null,
        sb?.rpeDevMedian ?? null,
      ),
      row(
        'readiness',
        'Recuperación media (check-in)',
        '/10',
        sa?.readinessMean ?? null,
        sb?.readinessMean ?? null,
        'propia, no TRAC',
      ),
      row(
        'ttp',
        'TTP observado',
        'semana',
        sa?.ttp.state === 'delimitado' ? sa.ttp.bestWeek : sa ? sa.ttp.state.replace('_', ' ') : null,
        sb?.ttp.state === 'delimitado' ? sb.ttp.bestWeek : sb ? sb.ttp.state.replace('_', ' ') : null,
        'mejor observado al cierre ≠ TTP delimitado',
      ),
    );
  } else {
    rows.push(
      row(
        'objective',
        'Objetivo',
        '',
        inp.families?.[fullA ? firstFamily(inp, a) : '']?.objective ?? null,
        inp.families?.[fullB ? firstFamily(inp, b) : '']?.objective ?? null,
        'lo declara el coach',
      ),
    );
  }
  return { universe, scope, sharedWeeks: shared, a, b, weeksA, weeksB, rows, notes };
}

function firstFamily(inp: CompareInput, r: SideRef): string {
  return (
    inp.planned.find((s) => (r.lift === 'ALL' || s.lift === r.lift) && s.blockKey === r.blockKey)
      ?.familyKey ?? ''
  );
}
