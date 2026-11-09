import measured from '../data/rts-si-measured.json' with { type: 'json' };
import { RPE_VALUES, REPS_VALUES, RPE_FULL, pctFromCurve } from './rpe.js';
import {
  SI_REVISION,
  stressOfSetFormula,
  exertionLoadEfort,
  stressIndexPrg,
  SI_MODEL,
  SI_MODEL_EFORT,
  SI_MODEL_PRG,
} from '../si.js';

/**
 * TABLAS DE STRESS INDEX. Los modelos NO se mezclan ni comparan (escalas propias).
 *  - RTS (`rts-aprox-v1`, revisión `rts-si-r2`): central/periférico/total por (reps, RPE); no depende del peso. 170 celdas MEDIDAS en la app real (reps 1–50, RPE 1–10, w = 100);
 *    el resto se calcula con la fórmula ajustada [error ≤ 0,02 en las medidas]. Cada celda dice su origen y, si fue medida, el error de la fórmula.
 *  - eFort (`efort-xl-v1`): Exertion Load por kg (XL = kg × factor(reps, RPE)), RIR = 10 − RPE [recuperado]. Cualquier reps/RPE.
 *  - PRG (`prg-si-v1`): depende de t = kg / referencia: SI = t³·(RPE/10) + (reps/5)·t² [recuperado]. Se tabula por % de la referencia.
 */
export const SI_TABLE_VERSION = 'si-tablas-v1';
interface Meas {
  reps: number;
  rpe: number;
  central: number;
  peripheral: number;
  total: number;
}
const MEAS = new Map((measured as { cells: Meas[] }).cells.map((c) => [`${c.reps}|${c.rpe}`, c]));
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface RtsSiCell {
  reps: number;
  rpe: number;
  central: number | null;
  peripheral: number | null;
  total: number | null;
  origin: 'medido-rts' | 'aproximado' | null;
  /** Solo en celdas medidas: lo que daría la aproximación y su diferencia (aprox − medido). */
  approx?: { central: number; peripheral: number; total: number };
  error?: { central: number; peripheral: number; total: number };
}

export function rtsSiCell(reps: number, rpe: number): RtsSiCell {
  if (pctFromCurve(reps, rpe) === null)
    return { reps, rpe, central: null, peripheral: null, total: null, origin: null };
  const a = stressOfSetFormula(reps, rpe);
  const approx = { central: r2(a.central), peripheral: r2(a.peripheral), total: r2(a.total) };
  const m = MEAS.get(`${reps}|${rpe}`);
  if (!m) return { reps, rpe, ...approx, origin: 'aproximado' };
  return {
    reps,
    rpe,
    central: m.central,
    peripheral: m.peripheral,
    total: m.total,
    origin: 'medido-rts',
    approx,
    error: {
      central: r2(approx.central - m.central),
      peripheral: r2(approx.peripheral - m.peripheral),
      total: r2(approx.total - m.total),
    },
  };
}

export function rtsSiTable(): {
  model: string;
  revision: string;
  version: string;
  rpes: number[];
  reps: number[];
  rows: RtsSiCell[][];
  validation: {
    measuredCells: number;
    maxAbsError: { central: number; peripheral: number; total: number };
    meanAbsError: { central: number; peripheral: number; total: number };
  };
} {
  const rows = REPS_VALUES.map((n) => RPE_VALUES.map((p) => rtsSiCell(n, p)));
  const errs = rows.flat().filter((c) => c.error);
  const agg = (k: 'central' | 'peripheral' | 'total', f: (xs: number[]) => number) =>
    r2(f(errs.map((c) => Math.abs((c.error as Record<string, number>)[k] as number))));
  return {
    model: SI_MODEL,
    revision: SI_REVISION,
    version: SI_TABLE_VERSION,
    rpes: RPE_VALUES,
    reps: REPS_VALUES,
    rows,
    validation: {
      measuredCells: errs.length,
      maxAbsError: {
        central: agg('central', (x) => Math.max(...x)),
        peripheral: agg('peripheral', (x) => Math.max(...x)),
        total: agg('total', (x) => Math.max(...x)),
      },
      meanAbsError: {
        central: agg('central', (x) => x.reduce((a, b) => a + b, 0) / x.length),
        peripheral: agg('peripheral', (x) => x.reduce((a, b) => a + b, 0) / x.length),
        total: agg('total', (x) => x.reduce((a, b) => a + b, 0) / x.length),
      },
    },
  };
}

/** eFort: Exertion Load por kg levantado, reps 1–50 × RPE 1–10 (pasos de 0,5). XL de una serie = kg × celda. */
export function efortXlTable(): {
  model: string;
  version: string;
  rpes: number[];
  reps: number[];
  xlPerKg: number[][];
} {
  return {
    model: SI_MODEL_EFORT,
    version: SI_TABLE_VERSION,
    rpes: RPE_VALUES,
    reps: REPS_VALUES,
    xlPerKg: REPS_VALUES.map((n) =>
      RPE_VALUES.map((p) => Math.round(exertionLoadEfort(1, n, p) * 10000) / 10000),
    ),
  };
}

/** PRG: SI por serie según % de la referencia (t), reps y RPE. Por defecto 30–110 % en pasos de 5, reps 1–30, RPE 1–10 en pasos de 0,5. */
export function prgSiTable(
  o: { pctFrom?: number; pctTo?: number; pctStep?: number; repsMax?: number } = {},
): {
  model: string;
  version: string;
  pcts: number[];
  reps: number[];
  rpes: number[];
  /** si[pct][reps][rpe] */
  si: number[][][];
} {
  const from = o.pctFrom ?? 30;
  const to = o.pctTo ?? 110;
  const step = o.pctStep ?? 5;
  const pcts: number[] = [];
  for (let p = from; p <= to + 1e-9; p += step) pcts.push(Math.round(p * 100) / 100);
  const reps = Array.from({ length: Math.min(o.repsMax ?? 30, RPE_FULL.repsMax) }, (_, i) => i + 1);
  return {
    model: SI_MODEL_PRG,
    version: SI_TABLE_VERSION,
    pcts,
    reps,
    rpes: RPE_VALUES,
    si: pcts.map((p) =>
      reps.map((n) =>
        RPE_VALUES.map((r) => Math.round((stressIndexPrg(p / 100, n, r, 1) as number) * 10000) / 10000),
      ),
    ),
  };
}

/** Curva continua de eFort: %1RM implícito para h = reps + RIR (h = 1…50; paso 0,5). */
export function efortCurveTable(): { version: string; rows: { h: number; pct: number }[] } {
  const rows: { h: number; pct: number }[] = [];
  for (let h = 1; h <= 50; h += 0.5) {
    const v = Math.min(100, Math.max(0, (48.8 + 53.8 * Math.exp(-0.06 * h)) / 0.99466));
    rows.push({ h, pct: Math.round(v * 100) / 100 });
  }
  return { version: SI_TABLE_VERSION, rows };
}
