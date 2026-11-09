import chart from '../data/rts-chart.json' with { type: 'json' };
import original from '../data/rpe-table.json' with { type: 'json' };
import prgOriginal from '../data/prg-rpe-table.json' with { type: 'json' };
import measured from '../data/rts-si-measured.json' with { type: 'json' };

/**
 * TABLAS RPE ↔ %1RM con el dominio MÁS AMPLIO respaldado por la fuente.
 *  - Curva única de RTS (99 valores, h = 1…50 en pasos de 0,5). Con h = reps + (10 − RPE): RPE 1–10 (pasos de 0,5) × reps 1–50, siempre que h ≤ 50.
 *    La equivalencia curva ↔ tabla se midió en la app real (154 combinaciones, RPE 1–10, reps 1–50, sin diferencias): [recuperado].
 *  - Origen por celda: 'medido-rts' (la app devolvió ese resultado para esa combinación) o 'derivado-curva' (misma curva en una combinación no medida).
 *    Fuera de dominio (h > 50) = null.
 *  - La tabla ANTERIOR del proyecto (`rpe-proyecto-v1`, 1–15 × 4–10) coincidía con la curva solo hasta h = 10 y diverge por encima (error de copia heredado de PRG):
 *    se conserva como `legacyProyecto` para comparar, pero ya no se usa para calcular. Decisión del proyecto: la curva de RTS es la fuente correcta.
 *  - RPE < 6 o reps > 12 son zonas poco usadas: RTS recomienda % en vez de RPE bajo; se informan, no se ocultan.
 */
export const RPE_CURVE_VERSION = 'rts-curva-default-v1';
export const CURVE = (chart as { values: number[] }).values;
export const RPE_FULL = { repsMin: 1, repsMax: 50, rpeMin: 1, rpeMax: 10, rpeStep: 0.5, maxH: 50 } as const;
export const RPE_VALUES: number[] = Array.from({ length: 19 }, (_, i) => 1 + i * 0.5);
export const REPS_VALUES: number[] = Array.from({ length: 50 }, (_, i) => i + 1);

export type CellOrigin = 'medido-rts' | 'derivado-curva';
export interface PctCell {
  reps: number;
  rpe: number;
  /** Repeticiones al fallo equivalentes = reps + (10 − RPE). */
  h: number;
  pct: number | null;
  origin: CellOrigin | null;
  /** Valor de la tabla anterior del proyecto en esa celda (si existía) y su diferencia (curva − anterior). */
  legacyProyecto?: number;
  legacyDiff?: number;
}

/** Fracción del 1RM por la curva única: h = reps + 10 − RPE (reps entero ≥ 1, RPE en pasos de 0,5 entre 1 y 10, h ≤ 50). */
export function pctFromCurve(reps: number, rpe: number): number | null {
  if (!Number.isInteger(reps) || reps < RPE_FULL.repsMin || reps > RPE_FULL.repsMax) return null;
  if (!(rpe >= RPE_FULL.rpeMin && rpe <= RPE_FULL.rpeMax) || Math.round(rpe * 2) !== rpe * 2) return null;
  const h = reps + 10 - rpe;
  if (h > RPE_FULL.maxH) return null;
  const v = CURVE[Math.round((h - 1) * 2)];
  return typeof v === 'number' ? v : null;
}

const ORIG_COLS = [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
const LEGACY = original as (number | null)[][];
const MEAS = new Map(
  (measured as { cells: { reps: number; rpe: number }[] }).cells.map((c) => [`${c.reps}|${c.rpe}`, c]),
);

export function rpeCell(reps: number, rpe: number): PctCell {
  const pct = pctFromCurve(reps, rpe);
  const h = reps + 10 - rpe;
  const origin: CellOrigin | null =
    pct === null ? null : MEAS.has(`${reps}|${rpe}`) ? 'medido-rts' : 'derivado-curva';
  const j = ORIG_COLS.indexOf(rpe);
  const lg = reps >= 1 && reps <= 15 && j >= 0 ? LEGACY[reps - 1]?.[j] : undefined;
  const cell: PctCell = { reps, rpe, h, pct, origin };
  if (typeof lg === 'number' && pct !== null) {
    cell.legacyProyecto = lg;
    cell.legacyDiff = Math.round((pct - lg) * 1000) / 1000;
  }
  return cell;
}

/** Tabla completa reps 1–50 × RPE 1–10 (filas = reps, columnas = RPE). */
export function rpeTableFull(): {
  version: string;
  rpes: number[];
  reps: number[];
  rows: PctCell[][];
  stats: { cells: number; available: number; byOrigin: Record<string, number> };
} {
  const rows = REPS_VALUES.map((r) => RPE_VALUES.map((p) => rpeCell(r, p)));
  const byOrigin: Record<string, number> = {};
  let available = 0;
  for (const row of rows)
    for (const c of row)
      if (c.pct !== null) {
        available++;
        byOrigin[c.origin as string] = (byOrigin[c.origin as string] ?? 0) + 1;
      }
  return {
    version: RPE_CURVE_VERSION,
    rpes: RPE_VALUES,
    reps: REPS_VALUES,
    rows,
    stats: { cells: rows.length * RPE_VALUES.length, available, byOrigin },
  };
}

/** Comparación con la tabla anterior del proyecto: dónde coincide con la curva y desde qué h diverge. */
export function legacyTableDivergence(): {
  cells: number;
  divergent: number;
  maxAbsDiff: number;
  firstDivergentH: number | null;
} {
  let n = 0;
  let div = 0;
  let max = 0;
  let firstH: number | null = null;
  for (let r = 1; r <= 15; r++)
    for (const p of ORIG_COLS) {
      const c = rpeCell(r, p);
      if (c.legacyDiff === undefined) continue;
      n++;
      if (Math.abs(c.legacyDiff) > 0.0015) {
        div++;
        max = Math.max(max, Math.abs(c.legacyDiff));
        firstH = firstH === null ? c.h : Math.min(firstH, c.h);
      }
    }
  return { cells: n, divergent: div, maxAbsDiff: max, firstDivergentH: firstH };
}

/** Tabla nRM: %1RM para n repeticiones al fallo (RPE 10), n = 1…50. */
export function rmTable(): { version: string; rows: { reps: number; pct: number; origin: CellOrigin }[] } {
  return {
    version: RPE_CURVE_VERSION,
    rows: REPS_VALUES.map((n) => ({
      reps: n,
      pct: pctFromCurve(n, 10) as number,
      origin: rpeCell(n, 10).origin as CellOrigin,
    })),
  };
}

/** Repeticiones posibles (al fallo) para un %1RM dado: inversa de la curva (interpolación lineal). null fuera de la curva. */
export function repsAtPct(pct: number): number | null {
  if (!(pct > 0)) return null;
  if (pct > CURVE[0]!) return null;
  if (pct < CURVE[CURVE.length - 1]!) return null;
  for (let i = 0; i < CURVE.length - 1; i++) {
    const a = CURVE[i]!;
    const b = CURVE[i + 1]!;
    if (pct <= a && pct >= b) return 1 + (i + (a === b ? 0 : (a - pct) / (a - b))) * 0.5;
  }
  return null;
}

/** Tabla de CARGAS: kg para cada (reps, RPE) dado un e1RM, redondeado hacia abajo al paso de carga. */
export function loadTable(
  e1rm: number,
  stepKg: number,
): { e1rm: number; stepKg: number; rpes: number[]; reps: number[]; kg: (number | null)[][] } {
  const floor = (x: number) => (stepKg > 0 ? Math.floor(x / stepKg + 1e-9) * stepKg : x);
  return {
    e1rm,
    stepKg,
    rpes: RPE_VALUES,
    reps: REPS_VALUES,
    kg: REPS_VALUES.map((r) =>
      RPE_VALUES.map((p) => {
        const c = pctFromCurve(r, p);
        return c === null ? null : Math.round(floor(e1rm * c) * 1000) / 1000;
      }),
    ),
  };
}

/* ---------------- PRG ---------------- */
const PRG = (prgOriginal as { values: Record<string, Record<string, number>> }).values;
export const PRG_TABLE_VERSION = 'prg-tabla-rpe-v1';
export interface PrgCell {
  reps: number;
  rpe: number;
  pct: number | null;
  /** Misma celda por la curva de RTS (referencia). */
  rtsPct: number | null;
  /** Diferencia PRG − RTS en puntos de %; PRG difiere de la curva en h ≥ 10,5 (error de copia documentado). */
  diff: number | null;
  origin: 'prg-original' | 'prg-extrapolado' | null;
}
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Extrapolación de PRG por debajo de RPE 6 [recuperado de la app]: continúa la pendiente de las filas 6,0/6,5/7,0. */
function prgExtrapolated(rpe: number, reps: number): number | null {
  if (!(rpe >= 0.5 && rpe <= 10) || reps < 1) return null;
  const r = Math.round(rpe * 2) / 2;
  const n = Math.min(Math.max(Math.floor(reps + 0.5), 1), 12);
  const p = (k: number) => PRG[k.toFixed(1)]?.[String(n)];
  if (r >= 6) return p(r) ?? null;
  const p6 = p(6);
  const p65 = p(6.5);
  const p7 = p(7);
  if (p6 === undefined || p65 === undefined || p7 === undefined) return null;
  const o = p65 - p6;
  const paso = o > 0.2 ? o : p7 - p65;
  if (paso <= 0) return null;
  const c = ((o > 0.2 ? 6 : 6.5) - r) / 0.5;
  const v = round1((o > 0.2 ? p6 : p65) - c * paso);
  return v > 0 ? v : null;
}

/** Tabla de PRG: reps 1–12 × RPE 0,5–10. RPE 6–10 son celdas originales; por debajo, la extrapolación de la app. */
export function prgRpeTable(): {
  version: string;
  rpes: number[];
  reps: number[];
  rows: PrgCell[][];
  divergentCells: number;
} {
  const rpes = Array.from({ length: 20 }, (_, i) => 0.5 + i * 0.5);
  const reps = Array.from({ length: 12 }, (_, i) => i + 1);
  let div = 0;
  const rows = reps.map((n) =>
    rpes.map((r): PrgCell => {
      const pct = prgExtrapolated(r, n);
      const rts = pctFromCurve(n, r);
      const rtsPct = rts === null ? null : round1(rts * 100);
      const diff = pct !== null && rtsPct !== null ? round1(pct - rtsPct) : null;
      if (diff !== null && Math.abs(diff) > 0.15 && r >= 6) div++;
      return {
        reps: n,
        rpe: r,
        pct,
        rtsPct,
        diff,
        origin: pct === null ? null : r >= 6 ? 'prg-original' : 'prg-extrapolado',
      };
    }),
  );
  return { version: PRG_TABLE_VERSION, rpes, reps, rows, divergentCells: div };
}
