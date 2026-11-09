import { estimateCurve, estimatePrg } from './e1rm-methods.js';
import type { CurveDomain } from './e1rm.js';
import type { ObservedSet } from './observed.js';
import { stressOfSet } from './si.js';

/**
 * FATIGA ENTRE SERIES (dentro de un ejercicio y una sesión). Descriptiva: NO clasifica con umbrales (no hay uno validado) ni diagnostica.
 * Compara cada serie con las demás y con lo previsto:
 *  - RPE real de cada serie frente a la anterior, a la primera y al RPE objetivo (p. ej. 3×3@7: 6-7-7 ó 7-8-8,5 ⇒ la deriva se ve serie a serie).
 *  - Repeticiones de cada serie frente a la anterior, a la primera, a la mejor y al RANGO previsto (p. ej. 3×8-10 con carga fija: 10-10-8).
 *  - Carga, e1RM por serie (curva y fórmulas, separados) y SI por serie.
 * Requiere el ORDEN de las series (`setNo`); si no se conoce, no se infiere del orden de lectura.
 * `pattern` solo mira el signo de los pasos entre series consecutivas (sin umbrales): ascendente | estable | descendente | mixto.
 * Versión `fatiga-v2`.
 */
export const FATIGUE_VERSION = 'fatiga-v2';

/** Lo previsto para una serie (de la prescripción vinculada). */
export interface SetTarget {
  reps: number | null;
  /** Tope del rango (si la prescripción es un rango de repeticiones). */
  repsMax: number | null;
  rpe: number | null;
  kg: number | null;
}
export type Pattern = 'ascendente' | 'estable' | 'descendente' | 'mixto';
export type RangePosition = 'sobre_rango' | 'en_rango' | 'bajo_rango';

export interface SetPoint {
  setNo: number;
  kg: number | null;
  reps: number | null;
  rpe: number | null;
  e1rmCurve: number | null;
  e1rmPrg: number | null;
  siRtsTotal: number | null;
  setType: string;
  target: SetTarget | null;
  /** RPE real − RPE objetivo (positivo = más duro de lo previsto). */
  rpeVsTarget: number | null;
  rpeVsPrevious: number | null;
  rpeVsFirst: number | null;
  /** Repeticiones frente al rango previsto: posición y distancia (reps − tope si sobre el rango; reps − mínimo si bajo; 0 si dentro). */
  repsVsTarget: { position: RangePosition; delta: number } | null;
  repsVsPrevious: number | null;
  repsVsFirst: number | null;
  /** Repeticiones perdidas respecto de la serie con más repeticiones de la sesión (≥ 0). */
  repsLostVsBest: number | null;
  kgVsPrevious: number | null;
  e1rmCurveVsFirstPct: number | null;
}
export interface FirstLast {
  first: number;
  last: number;
  delta: number;
  /** Cambio relativo de first a last en % (positivo = subió). */
  pct: number | null;
}
export interface BetweenSets {
  version: string;
  status: 'available' | 'partial' | 'unavailable';
  reasons: string[];
  /** Series de trabajo consideradas, en orden, cada una comparada con las otras y con lo previsto. */
  sets: SetPoint[];
  rpe:
    | (FirstLast & {
        n: number;
        slopePerSet: number | null;
        values: number[];
        pattern: Pattern;
        /** Mayor aumento de RPE entre dos series consecutivas. */
        maxStepUp: number;
        /** Cuántas series quedaron por encima / en / por debajo del RPE objetivo (solo series con objetivo). */
        vsTarget: { above: number; at: number; below: number; n: number } | null;
      })
    | null;
  reps:
    | (FirstLast & {
        values: number[];
        pattern: Pattern;
        /** true = todas las series con la misma carga: la caída de repeticiones sí es fatiga pura. */
        constantLoad: boolean;
        /** Repeticiones perdidas de la mejor serie a la última (≥ 0). */
        lostBestToLast: number;
        /** Caída % de la primera a la última (positivo = cayó); solo con carga constante. */
        dropPct: number | null;
        /** Rango previsto (si lo hay) y cuántas series quedaron sobre / dentro / bajo el rango. */
        target: { reps: number; repsMax: number } | null;
        vsTarget: { above: number; within: number; below: number; n: number } | null;
      })
    | null;
  load: (FirstLast & { values: number[] }) | null;
  e1rmCurve: (FirstLast & { max: number; dropFromMaxPct: number | null }) | null;
  e1rmPrg: (FirstLast & { max: number; dropFromMaxPct: number | null }) | null;
  siRtsTotal: { first: number; last: number; sum: number } | null;
  notes: string[];
}

const pct = (a: number, b: number): number | null => (a !== 0 ? ((b - a) / Math.abs(a)) * 100 : null);
const fl = (first: number, last: number): FirstLast => ({
  first,
  last,
  delta: last - first,
  pct: pct(first, last),
});

function slope(ys: number[]): number | null {
  const n = ys.length;
  if (n < 3) return null;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  ys.forEach((y, i) => {
    sxx += (i - mx) ** 2;
    sxy += (i - mx) * (y - my);
  });
  return sxx > 0 ? sxy / sxx : null;
}

/** Solo el signo de los pasos entre series consecutivas: sin umbrales. */
export function patternOf(values: number[]): Pattern {
  const d = values.slice(1).map((v, i) => v - (values[i] as number));
  if (d.every((x) => x === 0)) return 'estable';
  if (d.every((x) => x >= 0)) return 'ascendente';
  if (d.every((x) => x <= 0)) return 'descendente';
  return 'mixto';
}

const NON_TOTAL = (s: ObservedSet) =>
  s.loadKind === 'per_side' ||
  s.loadKind === 'unknown' ||
  s.loadKind === 'bodyweight' ||
  s.loadKind === 'assisted';

export function fatigueBetweenSets(
  sets: ObservedSet[],
  domain: CurveDomain = 'recomendado',
  targets?: Map<string, SetTarget>,
): BetweenSets {
  const base: BetweenSets = {
    version: FATIGUE_VERSION,
    status: 'unavailable',
    reasons: [],
    sets: [],
    rpe: null,
    reps: null,
    load: null,
    e1rmCurve: null,
    e1rmPrg: null,
    siRtsTotal: null,
    notes: [],
  };
  const work = sets.filter((s) => s.setType === 'work' || s.setType === 'failure');
  if (work.length < 2)
    return {
      ...base,
      reasons: ['Se necesitan al menos 2 series de trabajo del mismo ejercicio en la sesión.'],
    };
  if (work.some((s) => s.setNo === null || s.setNo === undefined))
    return { ...base, reasons: ['No se conoce el orden de las series: no se infiere del orden de lectura.'] };
  const ordered = [...work].sort((a, b) => (a.setNo as number) - (b.setNo as number));
  const tg = (s: ObservedSet): SetTarget | null =>
    s.plannedSetId ? (targets?.get(s.plannedSetId) ?? null) : null;

  const e1c = ordered.map((s) => estimateCurve(s.kg, s.reps, s.rpe, domain).value);
  const firstRpe = ordered.find((s) => s.rpe !== null)?.rpe ?? null;
  const firstReps = ordered[0]?.reps ?? null;
  const bestReps = Math.max(...ordered.map((s) => s.reps ?? -Infinity));
  const firstE1c = e1c.find((v) => v !== null) ?? null;
  const pts: SetPoint[] = ordered.map((s, i) => {
    const prev = i > 0 ? (ordered[i - 1] as ObservedSet) : null;
    const t = tg(s);
    const rangeMax = t ? (t.repsMax ?? t.reps) : null;
    let repsVsTarget: SetPoint['repsVsTarget'] = null;
    if (t && t.reps !== null && rangeMax !== null && s.reps !== null)
      repsVsTarget =
        s.reps > rangeMax
          ? { position: 'sobre_rango', delta: s.reps - rangeMax }
          : s.reps < t.reps
            ? { position: 'bajo_rango', delta: s.reps - t.reps }
            : { position: 'en_rango', delta: 0 };
    return {
      setNo: s.setNo as number,
      kg: s.kg,
      reps: s.reps,
      rpe: s.rpe,
      e1rmCurve: e1c[i] as number | null,
      e1rmPrg: NON_TOTAL(s) ? null : estimatePrg(s.kg, s.reps).value,
      siRtsTotal: s.reps !== null && s.reps > 0 && s.rpe !== null ? stressOfSet(s.reps, s.rpe).total : null,
      setType: s.setType,
      target: t,
      rpeVsTarget: s.rpe !== null && t?.rpe !== null && t?.rpe !== undefined ? s.rpe - t.rpe : null,
      rpeVsPrevious:
        i > 0 && s.rpe !== null && prev?.rpe !== null && prev?.rpe !== undefined ? s.rpe - prev.rpe : null,
      rpeVsFirst: i > 0 && s.rpe !== null && firstRpe !== null ? s.rpe - firstRpe : null,
      repsVsTarget,
      repsVsPrevious:
        i > 0 && s.reps !== null && prev?.reps !== null && prev?.reps !== undefined
          ? s.reps - prev.reps
          : null,
      repsVsFirst: i > 0 && s.reps !== null && firstReps !== null ? s.reps - firstReps : null,
      repsLostVsBest: s.reps !== null && Number.isFinite(bestReps) ? bestReps - s.reps : null,
      kgVsPrevious:
        i > 0 && s.kg !== null && prev?.kg !== null && prev?.kg !== undefined ? s.kg - prev.kg : null,
      e1rmCurveVsFirstPct:
        i > 0 && e1c[i] !== null && firstE1c !== null ? pct(firstE1c, e1c[i] as number) : null,
    };
  });
  const out: BetweenSets = { ...base, sets: pts };
  const reasons: string[] = [];
  if (ordered.some(NON_TOTAL))
    out.notes.push(
      'Hay series con carga no interpretable como total (por lado / peso corporal / desconocida): no entran en el e1RM por fórmulas.',
    );

  // --- RPE
  const withRpe = pts.filter((p) => p.rpe !== null);
  if (withRpe.length >= 2) {
    const ys = withRpe.map((p) => p.rpe as number);
    const steps = ys.slice(1).map((v, i) => v - (ys[i] as number));
    const tgt = pts.filter((p) => p.rpeVsTarget !== null);
    out.rpe = {
      ...fl(ys[0] as number, ys.at(-1) as number),
      n: ys.length,
      slopePerSet: slope(ys),
      values: ys,
      pattern: patternOf(ys),
      maxStepUp: Math.max(0, ...steps),
      vsTarget: tgt.length
        ? {
            above: tgt.filter((p) => (p.rpeVsTarget as number) > 0).length,
            at: tgt.filter((p) => p.rpeVsTarget === 0).length,
            below: tgt.filter((p) => (p.rpeVsTarget as number) < 0).length,
            n: tgt.length,
          }
        : null,
    };
  } else reasons.push('RPE real en menos de 2 series: no hay deriva de RPE.');
  if (withRpe.length < pts.length)
    out.notes.push(
      `${pts.length - withRpe.length} serie(s) sin RPE real quedan fuera de la deriva de RPE y del e1RM por curva.`,
    );

  // --- carga
  const kgs = pts.map((p) => p.kg);
  const kgOk = kgs.every((v) => v !== null);
  if (kgOk) out.load = { ...fl(kgs[0] as number, kgs.at(-1) as number), values: kgs as number[] };
  const constantLoad = kgOk && new Set(kgs).size === 1;

  // --- repeticiones (siempre por serie; "fatiga pura" solo con carga constante)
  const repsAll = pts.map((p) => p.reps);
  if (repsAll.every((v) => v !== null)) {
    const rs = repsAll as number[];
    const tr = pts.find((p) => p.target?.reps != null)?.target ?? null;
    const vt = pts.filter((p) => p.repsVsTarget !== null);
    const drop = pct(rs[0] as number, rs.at(-1) as number);
    out.reps = {
      ...fl(rs[0] as number, rs.at(-1) as number),
      values: rs,
      pattern: patternOf(rs),
      constantLoad,
      lostBestToLast: Math.max(...rs) - (rs.at(-1) as number),
      dropPct: constantLoad && drop !== null ? -drop : null,
      target: tr && tr.reps !== null ? { reps: tr.reps, repsMax: tr.repsMax ?? tr.reps } : null,
      vsTarget: vt.length
        ? {
            above: vt.filter((p) => p.repsVsTarget!.position === 'sobre_rango').length,
            within: vt.filter((p) => p.repsVsTarget!.position === 'en_rango').length,
            below: vt.filter((p) => p.repsVsTarget!.position === 'bajo_rango').length,
            n: vt.length,
          }
        : null,
    };
    if (!constantLoad)
      out.notes.push(
        'La carga cambia entre series: la variación de repeticiones no se interpreta como fatiga pura.',
      );
  }

  // --- e1RM por serie
  for (const [key, field] of [
    ['e1rmCurve', 'e1rmCurve'],
    ['e1rmPrg', 'e1rmPrg'],
  ] as const) {
    const vs = pts.map((p) => p[field]).filter((v): v is number => v !== null);
    if (vs.length >= 2 && vs.length === pts.length) {
      const max = Math.max(...vs);
      out[key] = {
        ...fl(vs[0] as number, vs.at(-1) as number),
        max,
        dropFromMaxPct: max > 0 ? ((max - (vs.at(-1) as number)) / max) * 100 : null,
      };
    }
  }
  if (!out.e1rmCurve) reasons.push('e1RM por curva: requiere RPE real en todas las series.');
  const si = pts.map((p) => p.siRtsTotal).filter((v): v is number => v !== null);
  if (si.length)
    out.siRtsTotal = {
      first: si[0] as number,
      last: si.at(-1) as number,
      sum: si.reduce((a, b) => a + b, 0),
    };
  out.notes.push(
    'Descriptivo: sin umbral validado no se clasifica la fatiga. La velocidad de barra no está disponible.',
  );
  out.reasons = reasons;
  out.status =
    out.rpe || out.reps || out.e1rmCurve || out.e1rmPrg
      ? reasons.length || withRpe.length < pts.length
        ? 'partial'
        : 'available'
      : 'unavailable';
  return out;
}
