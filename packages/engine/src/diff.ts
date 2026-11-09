import { f, signed } from './format.js';
import { blockMetrics, type BlockMetrics } from './metrics.js';
import type { PlanSnapshot } from './snapshot.js';
import { SI_MODEL } from './si.js';
import type { Lift, PlannedSet } from './types.js';
import { toViews } from './views.js';

const TOL = 1e-6; // tolerancia numérica de cálculo: NO demuestra equivalencia fisiológica
const TOL_SI = 0.01; // 1 % relativo para el SI

export const LIFT_LABEL: Record<Lift, string> = { SQ: 'Sentadilla', BP: 'Banca', DL: 'Peso muerto' };

export interface Delta {
  variable: string;
  unit: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  /** 100·(nuevo−anterior)/anterior solo si anterior > 0. De 0 a positivo: "nueva exposición/dosis", nunca infinito. */
  pct: number | null;
  note?: string;
}

export type ChangeClass =
  | 'sin_cambios'
  | 'volumen_aumentado'
  | 'volumen_disminuido'
  | 'redistribucion_frecuencia'
  | 'cambio_perfil_estimulo'
  | 'cambio_intensidad_esfuerzo'
  | 'cambio_referencia_modelo'
  | 'cambio_duracion'
  | 'cambio_ejercicio'
  | 'bloque_nuevo'
  | 'bloque_retirado'
  | 'mixto';

export interface LiftChange {
  lift: Lift;
  blockKey: string;
  classification: ChangeClass;
  tags: string[];
  deltas: Delta[];
  summary: string;
  /** Aclaraciones obligatorias: igual NL/SI no implica igual estímulo, etc. */
  caveats: string[];
  distribution?: { before: Record<number, number>; after: Record<number, number> };
}

export interface SetChange {
  added: number;
  removed: number;
  modified: number;
  /** Primeros cambios por serie (ids estables) para auditar. */
  samples: string[];
}

/** Evento COMPUESTO: la unidad es la modificación del programa (una versión), con deltas hijos. No hay una tarjeta por serie. */
export interface ChangeEvent {
  id: string;
  versionA: string;
  versionB: string;
  detectedOn: string;
  effectiveOn: string | null;
  effectiveEstimated: boolean;
  status: 'aplicado' | 'borrador';
  /** Se conoce el actor solo si hay auditoría; aquí es siempre "cambio detectado". */
  actor: null;
  changes: LiftChange[];
  setChanges: SetChange;
  /** Motivo OPCIONAL escrito por el coach. El sistema no inventa intenciones. */
  coachComment: string;
}

export function delta(
  variable: string,
  unit: string,
  before: number | null,
  after: number | null,
  note?: string,
): Delta {
  const d = before !== null && after !== null ? after - before : null;
  let pct: number | null = null;
  let n = note;
  if (d !== null && before !== null && before > 0) pct = (100 * d) / before;
  else if (d !== null && before === 0 && (after as number) > 0)
    n = [note, 'nueva exposición/dosis'].filter(Boolean).join(' · ');
  return { variable, unit, before, after, delta: d, pct, ...(n ? { note: n } : {}) };
}

const differs = (a: number | null, b: number | null, tol = TOL) =>
  a !== null && b !== null && Math.abs(a - b) > tol;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function describe(a: BlockMetrics, b: BlockMetrics): { deltas: Delta[]; tags: Set<string> } {
  const deltas: Delta[] = [];
  const tags = new Set<string>();
  const A = a.perWeek;
  const B = b.perWeek;
  deltas.push(delta('NL por semana', 'reps', A.nl, B.nl, 'NL = Σ repeticiones; no es la cantidad de series'));
  deltas.push(delta('Series por semana', 'series', A.sets, B.sets));
  deltas.push(delta('Frecuencia', 'sesiones/semana', A.frequency, B.frequency));
  deltas.push(delta('Duración del bloque', 'semanas', a.weeks.length, b.weeks.length));
  deltas.push(
    delta(
      'NL total del bloque',
      'reps',
      a.totals.nl,
      b.totals.nl,
      'total bruto; comparar con la dosis semanal',
    ),
  );
  if (A.meanKg !== null && B.meanKg !== null) deltas.push(delta('Carga media', 'kg', A.meanKg, B.meanKg));
  if (A.meanPct !== null && B.meanPct !== null)
    deltas.push(
      delta(
        'Intensidad relativa media',
        '% ref',
        100 * A.meanPct,
        100 * B.meanPct,
        'depende de la referencia fechada',
      ),
    );
  if (A.meanRpe !== null && B.meanRpe !== null)
    deltas.push(delta('RPE objetivo medio', 'RPE', A.meanRpe, B.meanRpe));
  if (A.si && B.si) {
    deltas.push(delta('SI total', `SI (${SI_MODEL})`, A.si.total, B.si.total));
    deltas.push(delta('SI central', `SI (${SI_MODEL})`, A.si.central, B.si.central));
    deltas.push(delta('SI periférico', `SI (${SI_MODEL})`, A.si.peripheral, B.si.peripheral));
  }
  if (differs(A.nl, B.nl)) tags.add('volumen');
  if (differs(A.frequency, B.frequency)) tags.add('frecuencia');
  if (differs(A.meanKg, B.meanKg)) tags.add('intensidad');
  if (differs(A.meanRpe, B.meanRpe)) tags.add('esfuerzo');
  if (a.weeks.length !== b.weeks.length) tags.add('duracion');
  if (a.exercises.join('|') !== b.exercises.join('|')) tags.add('ejercicio');
  const refA = mean(a.refKgs);
  const refB = mean(b.refKgs);
  if (differs(refA, refB) && !tags.has('intensidad')) tags.add('referencia');
  const siChanged =
    !!(A.si && B.si) &&
    (rel(A.si.total, B.si.total) > TOL_SI ||
      rel(A.si.central, B.si.central) > TOL_SI ||
      rel(A.si.peripheral, B.si.peripheral) > TOL_SI);
  const setsOnly = differs(A.sets, B.sets) && !tags.has('volumen');
  if (!tags.has('volumen') && !tags.has('esfuerzo') && !tags.has('intensidad') && (siChanged || setsOnly))
    tags.add('perfil');
  return { deltas, tags };
}

function classify(tags: Set<string>, a: BlockMetrics, b: BlockMetrics): ChangeClass {
  const t = new Set(tags);
  if (t.size === 0) return 'sin_cambios';
  if (t.size === 2 && t.has('frecuencia') && t.has('perfil')) return 'redistribucion_frecuencia';
  if (t.size > 1) return 'mixto';
  const only = [...t][0];
  switch (only) {
    case 'volumen':
      return b.perWeek.nl > a.perWeek.nl ? 'volumen_aumentado' : 'volumen_disminuido';
    case 'frecuencia':
      return 'redistribucion_frecuencia';
    case 'perfil':
      return 'cambio_perfil_estimulo';
    case 'intensidad':
    case 'esfuerzo':
      return 'cambio_intensidad_esfuerzo';
    case 'referencia':
      return 'cambio_referencia_modelo';
    case 'duracion':
      return 'cambio_duracion';
    default:
      return 'cambio_ejercicio';
  }
}

function summaryOf(lift: Lift, block: string, cls: ChangeClass, d: Delta[], tags: Set<string>): string {
  const g = (v: string) => d.find((x) => x.variable === v);
  const fmt = (x: Delta | undefined, dec = 1) =>
    x && x.before !== null && x.after !== null
      ? `${f(x.before, dec)}→${f(x.after, dec)}${x.delta !== null && x.delta !== 0 ? ` (${signed(x.delta, dec)}${x.pct !== null ? `; ${signed(x.pct, 1)} %` : ''})` : ''}`
      : '';
  const head = `${LIFT_LABEL[lift]} · bloque ${block}`;
  const parts: string[] = [];
  if (
    tags.has('volumen') ||
    cls === 'sin_cambios' ||
    cls === 'redistribucion_frecuencia' ||
    tags.has('perfil')
  )
    parts.push(`NL semanales ${fmt(g('NL por semana'))}`);
  if (tags.has('volumen') || tags.has('perfil')) parts.push(`series ${fmt(g('Series por semana'))}`);
  if (tags.has('frecuencia')) parts.push(`frecuencia ${fmt(g('Frecuencia'))}`);
  if (tags.has('intensidad')) parts.push(`carga media ${fmt(g('Carga media'))} kg`);
  if (tags.has('esfuerzo')) parts.push(`RPE objetivo ${fmt(g('RPE objetivo medio'))}`);
  if (tags.has('duracion'))
    parts.push(
      `duración ${fmt(g('Duración del bloque'), 0)} semanas (dosis semanal ${tags.has('volumen') ? 'cambió' : 'sin cambios'})`,
    );
  if (tags.has('referencia'))
    parts.push(
      'cambió la referencia 1RM sin cambiar las series: varían %/INOL por la referencia, no por un aumento de kg',
    );
  if (tags.has('ejercicio')) parts.push('cambió el ejercicio/variante');
  return `${head}: ${parts.join(' · ')}.`;
}

function viewsOf(sets: PlannedSet[]) {
  return toViews(sets, [], 'planned', '9999-12-31');
}

/** Cambios por serie con IDs estables: altas, bajas y modificaciones. Reordenar filas no inventa cambios. */
export function diffSets(a: PlannedSet[], b: PlannedSet[]): SetChange & { firstChangedDate: string | null } {
  const am = new Map(a.map((s) => [s.id, s]));
  const bm = new Map(b.map((s) => [s.id, s]));
  let modified = 0;
  const samples: string[] = [];
  const dates: string[] = [];
  const fields: (keyof PlannedSet)[] = [
    'exerciseName',
    'plannedDate',
    'reps',
    'targetRpe',
    'plannedKg',
    'blockKey',
    'weekNo',
    'dayNo',
    'refKg',
    'familyKey',
    'isWarmup',
  ];
  for (const [id, s] of bm) {
    const o = am.get(id);
    if (!o) {
      dates.push(s.plannedDate);
      continue;
    }
    const ch = fields.filter((k) => o[k] !== s[k]);
    if (ch.length) {
      modified++;
      dates.push(s.plannedDate);
      if (samples.length < 8)
        samples.push(`${id}: ${ch.map((k) => `${k} ${String(o[k])}→${String(s[k])}`).join(', ')}`);
    }
  }
  const added = [...bm.keys()].filter((k) => !am.has(k)).length;
  const removed = [...am.keys()].filter((k) => !bm.has(k)).length;
  for (const [id, s] of am) if (!bm.has(id)) dates.push(s.plannedDate);
  return { added, removed, modified, samples, firstChangedDate: dates.sort()[0] ?? null };
}

/** Evento compuesto entre dos versiones. Descriptivo: no recomienda ni atribuye intención. */
export function diffSnapshots(a: PlanSnapshot, b: PlanSnapshot): ChangeEvent {
  const va = viewsOf(a.sets);
  const vb = viewsOf(b.sets);
  const sc = diffSets(a.sets, b.sets);
  const changes: LiftChange[] = [];
  const keys = new Map<string, { lift: Lift; block: string }>();
  for (const v of [...va, ...vb]) keys.set(`${v.lift}|${v.blockKey}`, { lift: v.lift, block: v.blockKey });
  for (const { lift, block } of [...keys.values()].sort(
    (x, y) => x.lift.localeCompare(y.lift) || x.block.localeCompare(y.block),
  )) {
    const ma = blockMetrics(va, lift, block);
    const mb = blockMetrics(vb, lift, block);
    if (!ma && mb) {
      changes.push({
        lift,
        blockKey: block,
        classification: 'bloque_nuevo',
        tags: [],
        deltas: [],
        summary: `${LIFT_LABEL[lift]} · bloque ${block}: bloque nuevo (${f(mb.perWeek.nl, 1)} NL/semana, ${mb.weeks.length} semanas).`,
        caveats: ['Sin versión previa del bloque: no hay comparación.'],
      });
      continue;
    }
    if (ma && !mb) {
      changes.push({
        lift,
        blockKey: block,
        classification: 'bloque_retirado',
        tags: [],
        deltas: [],
        summary: `${LIFT_LABEL[lift]} · bloque ${block}: ya no figura en la versión nueva.`,
        caveats: [],
      });
      continue;
    }
    if (!ma || !mb) continue;
    const { deltas, tags } = describe(ma, mb);
    const cls = classify(tags, ma, mb);
    if (cls === 'sin_cambios') continue;
    const caveats: string[] = [];
    if (!tags.has('volumen'))
      caveats.push(
        'Igual NL no implica estímulo idéntico: puede cambiar la distribución, la intensidad o el esfuerzo.',
      );
    const sA = ma.perWeek.si;
    const sB = mb.perWeek.si;
    if (!sA || !sB)
      caveats.push(
        `SI no comparable: faltan RPE objetivo en ${ma.siComplete ? 'la versión nueva' : 'la versión previa'} (el SI planificado no se completa con supuestos).`,
      );
    else if (
      rel(sA.total, sB.total) <= TOL_SI &&
      (rel(sA.central, sB.central) > TOL_SI || rel(sA.peripheral, sB.peripheral) > TOL_SI)
    )
      caveats.push(
        `SI total estable (dentro de ${TOL_SI * 100} %), pero cambia el perfil central/periférico (${SI_MODEL}).`,
      );
    else if (tags.has('perfil') || tags.has('frecuencia'))
      caveats.push(
        `Igual SI total no implica el mismo estímulo; se muestran central y periférico (${SI_MODEL}).`,
      );
    if (cls === 'redistribucion_frecuencia' && tags.has('perfil'))
      caveats.push('Redistribución con cambio de perfil de estímulo.');
    changes.push({
      lift,
      blockKey: block,
      classification: cls,
      tags: [...tags],
      deltas,
      summary: summaryOf(lift, block, cls, deltas, tags),
      caveats,
      distribution: { before: ma.perWeek.nlByDay, after: mb.perWeek.nlByDay },
    });
  }
  const eff = b.effectiveOn ?? sc.firstChangedDate;
  return {
    id: `${a.id}->${b.id}`,
    versionA: a.id,
    versionB: b.id,
    detectedOn: b.detectedOn,
    effectiveOn: eff,
    effectiveEstimated: b.effectiveOn === null && eff !== null,
    status: b.status,
    actor: null,
    changes,
    setChanges: { added: sc.added, removed: sc.removed, modified: sc.modified, samples: sc.samples },
    coachComment: '',
  };
}
