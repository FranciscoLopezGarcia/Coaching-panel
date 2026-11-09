import { describe, expect, it } from 'vitest';
import {
  efortCurveTable,
  efortXlTable,
  exertionLoadEfort,
  formulaTable,
  legacyTableDivergence,
  loadTable,
  pctFromCurve,
  prgRpeTable,
  prgSiTable,
  repsAtPct,
  rmTable,
  rpeTableFull,
  rtsSiCell,
  rtsSiTable,
  stressOfSet,
  stressOfSetFormula,
  estimateCurve,
  musclesFor,
} from '../src/index.js';
import measured from '../src/data/rts-si-measured.json' with { type: 'json' };

describe('Tabla RPE ↔ %1RM (curva única de RTS, dominio amplio)', () => {
  const t = rpeTableFull();
  it('cubre reps 1–50 × RPE 1–10 (pasos de 0,5) y solo deja vacías las celdas con reps + 10 − RPE > 50', () => {
    expect(t.reps).toHaveLength(50);
    expect(t.rpes).toHaveLength(19);
    for (const row of t.rows) for (const c of row) expect(c.pct === null).toBe(c.h > 50);
    expect(t.stats.cells).toBe(950);
    expect(t.stats.available).toBe(860);
  });
  it('es monótona: más reps ⇒ menor %, más RPE ⇒ mayor %', () => {
    for (let j = 0; j < t.rpes.length; j++) {
      let prev = 2;
      for (let i = 0; i < 50; i++) {
        const v = t.rows[i]![j]!.pct;
        if (v === null) continue;
        expect(v).toBeLessThanOrEqual(prev + 1e-12);
        prev = v;
      }
    }
    for (const row of t.rows) {
      let prev = 0;
      for (const c of row)
        if (c.pct !== null) {
          expect(c.pct).toBeGreaterThanOrEqual(prev - 1e-12);
          prev = c.pct;
        }
    }
  });
  it('las 170 celdas MEDIDAS en la app de RTS coinciden con la curva (h = reps + 10 − RPE)', () => {
    const cells = (measured as { cells: { reps: number; rpe: number; pct: number | null }[] }).cells;
    expect(cells.length).toBe(170);
    let n = 0;
    for (const c of cells) {
      if (c.pct === null) continue;
      const p = pctFromCurve(c.reps, c.rpe);
      if (p === null) continue;
      n++;
      expect(Math.abs(p - c.pct)).toBeLessThan(0.0035); // la app redondea el e1RM a 2 decimales en la grilla medida
    }
    expect(n).toBeGreaterThan(140);
  });
  it('la tabla anterior del proyecto solo coincidía hasta h = 10: 107 de 195 celdas divergían', () => {
    const d = legacyTableDivergence();
    expect(d).toMatchObject({ cells: 195, divergent: 107, firstDivergentH: 10.5 });
    expect(d.maxAbsDiff).toBeGreaterThan(0.1);
    // ejemplo documentado: 12 reps @10 → RTS 70,7 %
    expect(pctFromCurve(12, 10)).toBeCloseTo(0.707, 3);
  });
  it('rangos: dominio recomendado por defecto, amplio a pedido, y fuera de la curva no calcula', () => {
    expect(estimateCurve(100, 20, 10).status).toBe('unavailable');
    const w = estimateCurve(100, 20, 10, 'amplio');
    expect(w.status).toBe('available');
    expect(w.warnings.join(' ')).toMatch(/dominio recomendado/);
    expect(estimateCurve(100, 3, 2.5, 'amplio').status).toBe('available');
    expect(estimateCurve(100, 50, 5, 'amplio').status).toBe('unavailable'); // h = 55 > 50
    expect(estimateCurve(100, 5, 8.25, 'amplio').status).toBe('unavailable'); // RPE fuera de la grilla
    expect(estimateCurve(100, 5, null).reason).toMatch(/sin RPE real/);
  });
  it('nRM, inversa y tabla de cargas', () => {
    const rm = rmTable();
    expect(rm.rows).toHaveLength(50);
    expect(rm.rows[0]).toMatchObject({ reps: 1, pct: 1 });
    expect(repsAtPct(0.811)).toBeCloseTo(7, 5);
    expect(repsAtPct(1.2)).toBeNull();
    const l = loadTable(200, 2.5);
    expect(l.kg[4]![l.rpes.indexOf(8)]).toBe(160); // 200 × 0,811 = 162,2 → paso 2,5 hacia abajo
    expect(l.kg[49]![0]).toBeNull();
  });
});

describe('Tablas de fórmulas de PRG', () => {
  const f = formulaTable();
  it('reps 1–36 con origen por fila; el promedio coincide con el e1RM verificado de PRG (100×5 → 115)', () => {
    expect(f.rows).toHaveLength(36);
    expect(f.rows[0]!.origin).toBe('trivial');
    expect(f.rows[4]!.origin).toBe('app-prg');
    expect(f.rows[10]!.origin).toBe('extrapolacion-matematica');
    expect(Math.round(100 * f.rows[4]!.factorAverage!)).toBe(115);
    expect(Math.round(100 * f.rows[2]!.factorAverage!)).toBe(Math.round(100 * f.rows[2]!.factorAverage!)); // sanity
    expect(Math.round(140 * f.rows[2]!.factorAverage!)).toBe(153);
  });
  it('la tabla RPE de PRG difiere de RTS en 38 celdas (h ≥ 10,5) y se extrapola por debajo de RPE 6', () => {
    const p = prgRpeTable();
    expect(p.divergentCells).toBe(38);
    expect(p.rows[0]![p.rpes.indexOf(6)]!.origin).toBe('prg-original');
    expect(p.rows[0]![p.rpes.indexOf(5)]!.origin).toBe('prg-extrapolado');
    expect(p.rows[0]![p.rpes.indexOf(5)]!.pct).toBeLessThan(p.rows[0]![p.rpes.indexOf(6)]!.pct!);
  });
});

describe('Tablas de Stress Index (modelos separados)', () => {
  it('RTS: 170 celdas medidas con error de la aproximación acotado; el resto aproximado', () => {
    const t = rtsSiTable();
    expect(t.validation.measuredCells).toBe(170);
    // la fórmula (sin usar las mediciones) reproduce las 170 combinaciones de la app de RTS
    expect(t.validation.maxAbsError.central).toBeLessThanOrEqual(0.02);
    expect(t.validation.maxAbsError.peripheral).toBeLessThanOrEqual(0.01);
    expect(t.validation.maxAbsError.total).toBeLessThan(0.011);
    expect(t.revision).toBe('rts-si-r2');
    const c = rtsSiCell(1, 10);
    expect(c).toMatchObject({ central: 2.48, peripheral: 0.54, total: 1.51, origin: 'medido-rts' });
    expect(rtsSiCell(7, 6.5).origin).toBe('medido-rts');
    const free = t.rows.flat().filter((x) => x.origin === 'aproximado').length;
    expect(free).toBeGreaterThan(500);
    expect(rtsSiCell(45, 3).total).toBeNull(); // h > 50
  });
  it('RTS: la tabla coincide con stressOfSet donde no hay medición', () => {
    const c = rtsSiCell(13, 7.5);
    expect(c.origin).toBe('aproximado');
    const s = stressOfSet(13, 7.5);
    expect(c.total).toBeCloseTo(s.total, 2);
    // en una combinación medida, stressOfSet devuelve el valor de RTS tal cual
    expect(stressOfSet(5, 4)).toMatchObject({ central: 0.21, peripheral: 0.45, total: 0.33 });
    // RPE bajo: el periférico ya no se subestima (antes 0,22 vs 0,52 medido a 10 reps @1)
    expect(stressOfSetFormula(10, 1).peripheral).toBeGreaterThan(0.5);
  });
  it('eFort: XL por kg y curva continua; PRG: SI por % de la referencia', () => {
    const e = efortXlTable();
    expect(e.xlPerKg[4]![e.rpes.indexOf(8)]).toBeCloseTo(exertionLoadEfort(1, 5, 8), 3);
    expect(efortCurveTable().rows[0]).toMatchObject({ h: 1, pct: 100 });
    const p = prgSiTable({ pctFrom: 100, pctTo: 100, pctStep: 5, repsMax: 5 });
    // t = 1: SI = RPE/10 + reps/5 ⇒ 5 reps @10 = 1 + 1 = 2
    expect(p.si[0]![4]![p.rpes.indexOf(10)]).toBeCloseTo(2, 4);
    expect(prgSiTable().pcts[0]).toBe(30);
  });
});

describe('Convención muscular v2 (rangos amplios)', () => {
  const dir = (n: string) =>
    musclesFor(
      n
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      n,
    )
      ?.filter((m) => m.kind === 'directo')
      .map((m) => m.group);
  it('cubre patrones comunes (incluye Hevy y nombres en español) y no adivina lo que no conoce', () => {
    expect(dir('Lat Pulldown (Cable)')).toEqual(['dorsales']);
    expect(dir('Romanian Deadlift (Barbell)')).toEqual(expect.arrayContaining(['isquiotibiales', 'gluteos']));
    expect(dir('Standing Calf Raise')).toEqual(['pantorrillas']);
    expect(dir('Hammer Curl (Dumbbell)')).toEqual(['biceps', 'antebrazos']);
    expect(dir('Rear Delt Reverse Fly (Dumbbell)')).toEqual(['hombros', 'espalda_alta']);
    expect(dir('Cable Fly')).toEqual(['pectoral']);
    expect(dir('Hanging Leg Raise')).toEqual(['core']);
    expect(dir('Russian Twist')).toEqual(['oblicuos']);
    expect(dir('Hip Thrust (Barbell)')).toEqual(['gluteos']);
    expect(dir('Press Banca Larsen')).toEqual(['pectoral']);
    expect(dir('Extensión Cuadricep Unilateral')).toEqual(['cuadriceps']);
    expect(dir('Rowing Machine')).toBeUndefined();
    expect(dir('Ejercicio Inventado XYZ')).toBeUndefined();
  });
});
