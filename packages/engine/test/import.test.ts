import { describe, expect, it } from 'vitest';
import { csvRecords, parseCsv } from '../src/import/csv.js';
import { parseHevyCsv, parseHevyDate, previewHevy } from '../src/import/hevy.js';
import { parseCanonicalPlan, parseProtocolText } from '../src/import/plan-canonical.js';
import { computeObservedMetrics } from '../src/metrics-observed.js';
import { plannedAvailability } from '../src/program.js';

/** Todo SINTÉTICO: ningún dato personal. */
const HEAD =
  'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe';
const line = (
  start: string,
  ex: string,
  idx: number,
  type: string,
  kg: string,
  reps: string,
  rpe = '',
  title = 'Entreno A',
) => `${title},"${start}",,,${ex},,,${idx},${type},${kg},${reps},,,${rpe}`;
const csv = (...rows: string[]) => [HEAD, ...rows].join('\n');

describe('CSV', () => {
  it('maneja comillas, comas y saltos de línea dentro de campos, CRLF y BOM', () => {
    const t = '﻿a,b\r\n"x, y","l1\nl2"\r\n"con ""comillas""",z\r\n';
    expect(parseCsv(t)).toEqual([
      ['a', 'b'],
      ['x, y', 'l1\nl2'],
      ['con "comillas"', 'z'],
    ]);
    expect(csvRecords('h1,h2\n1,2').records[0]).toEqual({ line: 2, data: { h1: '1', h2: '2' } });
  });
});

describe('Fechas de Hevy: interpretación explícita', () => {
  it('español, inglés, 12 h e ISO; la hora escrita no se convierte', () => {
    expect(parseHevyDate('3 abr 2026, 18:30', 'America/Argentina/Mendoza')).toEqual({
      date: '2026-04-03',
      time: '18:30',
      interpretation: 'hora_local_escrita',
    });
    expect(parseHevyDate('5 sept 2025, 07:05', 'x')?.date).toBe('2025-09-05');
    expect(parseHevyDate('Apr 3, 2026, 6:30 PM', 'x')).toMatchObject({ date: '2026-04-03', time: '18:30' });
    expect(parseHevyDate('2026-04-03 18:30:00', 'x')).toMatchObject({
      date: '2026-04-03',
      interpretation: 'hora_local_escrita',
    });
  });
  it('un instante con offset se convierte a la zona configurada (puede cambiar el día)', () => {
    expect(parseHevyDate('2026-04-04T01:30:00Z', 'America/Argentina/Mendoza')).toEqual({
      date: '2026-04-03',
      time: '22:30',
      interpretation: 'instante_convertido_a_zona',
    });
  });
  it('lo no interpretable devuelve null (no se adivina)', () => {
    expect(parseHevyDate('ayer', 'x')).toBeNull();
    expect(parseHevyDate('3 xyz 2026, 18:30', 'x')).toBeNull();
  });
});

describe('Importador de Hevy', () => {
  const text = csv(
    line('3 abr 2026, 18:30', 'Squat (Barbell)', 0, 'warmup', '60', '5'),
    line('3 abr 2026, 18:30', 'Squat (Barbell)', 1, 'normal', '140', '5', '8'),
    line('3 abr 2026, 18:30', 'Squat (Barbell)', 2, 'normal', '140', '5'),
    line('3 abr 2026, 18:30', 'Squat (Barbell)', 3, 'failure', '140', '4', '10'),
    line('3 abr 2026, 18:30', 'Squat (Barbell)', 4, 'dropset', '100', '8'),
    line('3 abr 2026, 18:30', 'Row (Dumbbell)', 1, 'normal', '30', '10'),
    line('3 abr 2026, 18:30', 'Pull Up (Bodyweight)', 1, 'normal', '', '8'),
    line('3 abr 2026, 18:30', 'Sumo Deadlift', 1, 'normal', '180', '3', '"7,5"'),
  );
  const p = parseHevyCsv(text);
  it('mapea tipos de serie sin tratar el warmup como trabajo y sin completar RPE', () => {
    expect(p.fatal).toEqual([]);
    const sq = p.rows.filter((r) => r.exerciseName === 'Squat (Barbell)');
    expect(sq.map((r) => r.setType)).toEqual(['warmup', 'work', 'work', 'failure', 'dropset']);
    expect(sq[1]).toMatchObject({
      kg: 140,
      reps: 5,
      rpe: 8,
      lift: 'SQ',
      variantKey: 'barbell',
      loadKind: 'total',
      source: 'hevy',
    });
    expect(sq[2]!.rpe).toBeNull(); // RPE vacío = no registrado, nunca el de otra serie ni el objetivo
    expect(sq[3]).toMatchObject({ setType: 'failure', rpe: 10 });
  });
  it('distingue mancuerna por lado, peso corporal y variantes (sumo ≠ convencional)', () => {
    expect(p.rows.find((r) => r.exerciseName === 'Row (Dumbbell)')).toMatchObject({
      loadKind: 'per_side',
      lift: null,
    });
    const bw = p.rows.find((r) => r.exerciseName === 'Pull Up (Bodyweight)')!;
    expect(bw).toMatchObject({ loadKind: 'bodyweight', kg: null, reps: 8 }); // peso vacío no es 0
    expect(p.rows.find((r) => r.exerciseName === 'Sumo Deadlift')).toMatchObject({
      lift: 'DL',
      variantKey: 'sumo',
      rpe: 7.5,
    }); // coma decimal
  });
  it('las métricas descriptivas funcionan igual sin prescripción: dropset y calentamiento se excluyen de e1RM', () => {
    const obs = p.rows.map(
      ({ externalKey: _k, workoutTitle: _t, startRaw: _s, line: _l, warnings: _w, ...o }) => o,
    );
    const m = computeObservedMetrics({
      obs,
      cutoff: '2026-04-30',
      from: '2026-04-01',
      to: '2026-04-30',
      scope: { lift: 'SQ' },
    });
    expect(m.nl?.value).toBe(5 + 5 + 4 + 8); // sin calentamiento
    expect(m.e1rm_table_rpe?.status).toBe('partial'); // solo 2 series con RPE
    expect(m.e1rm_prg_formulas?.status).toBe('available');
  });
  it('rechaza con motivo lo que no es una serie de fuerza o está mal', () => {
    const bad = parseHevyCsv(
      csv(
        `Entreno,"3 abr 2026, 18:30",,,Running,,,1,normal,,,5.2,1800,`,
        line('3 abr 2026, 18:30', 'Squat (Barbell)', 1, 'superset', '100', '5'),
        line('fecha rota', 'Squat (Barbell)', 1, 'normal', '100', '5'),
        line('3 abr 2026, 18:30', 'Squat (Barbell)', 1, 'normal', '5000', '5'),
        line('3 abr 2026, 18:30', 'Squat (Barbell)', 1, 'normal', '100', '5.5'),
        line('3 abr 2026, 18:30', 'Squat (Barbell)', 2, 'normal', '100', '5', '15'),
        line('3 abr 2026, 18:30', '', 1, 'normal', '100', '5'),
      ),
    );
    const why = bad.rejected.map((r) => r.reason);
    expect(why.some((x) => /cardio/.test(x))).toBe(true);
    expect(why.some((x) => /tipo de serie desconocido/.test(x))).toBe(true);
    expect(why.some((x) => /fecha no interpretable/.test(x))).toBe(true);
    expect(why.some((x) => /carga implausible/.test(x))).toBe(true);
    expect(why.some((x) => /no enteras/.test(x))).toBe(true);
    expect(why.some((x) => /sin título/.test(x))).toBe(true);
    const rpe = bad.rows.find((r) => r.reps === 5 && r.line === 7);
    expect(rpe?.rpe).toBeNull();
    expect(rpe?.warnings.join()).toMatch(/RPE no válido/);
    expect(bad.rejected.every((r) => r.line >= 2 && Object.keys(r.raw).length > 0)).toBe(true);
  });
  it('detecta duplicados dentro del archivo', () => {
    const d = parseHevyCsv(
      csv(
        line('3 abr 2026, 18:30', 'Squat (Barbell)', 1, 'normal', '100', '5'),
        line('3 abr 2026, 18:30', 'Squat (Barbell)', 1, 'normal', '100', '5'),
      ),
    );
    expect(d.rows).toHaveLength(1);
    expect(d.duplicatesInFile).toBe(1);
    expect(d.rejected[0]!.reason).toMatch(/duplicada dentro del archivo/);
  });
  it('la sesión es el ENTRENAMIENTO (título + inicio), no el ejercicio: varios ejercicios del mismo entrenamiento comparten sesión', () => {
    const w = parseHevyCsv(
      csv(
        line('3 abr 2026, 18:30', 'Squat (Barbell)', 1, 'normal', '100', '5'),
        line('3 abr 2026, 18:30', 'Bench Press (Barbell)', 1, 'normal', '80', '5'),
        line('3 abr 2026, 19:30', 'Squat (Barbell)', 1, 'normal', '100', '5', '', 'Entreno B'),
      ),
    );
    expect(new Set(w.rows.map((r) => r.sessionKey)).size).toBe(2);
    expect(w.rows[0]!.sessionKey).toBe(w.rows[1]!.sessionKey);
  });
  it('un archivo que no es de Hevy falla con un mensaje claro', () => {
    expect(parseHevyCsv('a,b\n1,2').fatal[0]).toMatch(/Faltan columnas obligatorias/);
    expect(parseHevyCsv('').fatal).toHaveLength(1);
  });
  it('sin dato de zona: lo declara; el mapeo se puede corregir por título', () => {
    expect(p.dateInterpretation).toMatch(/hora local escrita/);
    const q = parseHevyCsv(csv(line('3 abr 2026, 18:30', 'Front Squat (Barbell)', 1, 'normal', '100', '5')), {
      exerciseMap: {
        'Front Squat (Barbell)': { lift: 'SQ', variantKey: 'front', exerciseId: 'front-squat' },
      },
    });
    expect(q.rows[0]).toMatchObject({ lift: 'SQ', variantKey: 'front', loadKind: 'total' });
  });
});

describe('Vista previa (dry-run) e idempotencia', () => {
  const text = csv(
    line('3 abr 2026, 18:30', 'Squat (Barbell)', 1, 'normal', '140', '5'),
    line('3 abr 2026, 18:30', 'Squat (Barbell)', 2, 'normal', '140', '5'),
    line('4 abr 2026, 18:30', 'Face Pull (Cable)', 1, 'normal', '20', '15', '', 'Entreno B'),
    `Entreno,"3 abr 2026, 18:30",,,Running,,,1,normal,,,5.2,1800,`,
  );
  const p = parseHevyCsv(text);
  it('informa nuevos, rechazados, sesiones, rango de fechas, ejercicios sin mapeo y que no hay RPE', () => {
    const v = previewHevy(p);
    expect(v).toMatchObject({
      newRows: 3,
      rejected: 1,
      duplicatesExisting: 0,
      sessions: 2,
      dateRange: { from: '2026-04-03', to: '2026-04-04' },
      withRpe: 0,
    });
    expect(v.unmappedExercises).toEqual([{ title: 'Face Pull (Cable)', sets: 1 }]);
    expect(v.warnings.join(' ')).toMatch(/no trae RPE real/);
    expect(v.warnings.join(' ')).toMatch(/sin mapeo explícito/);
    expect(v.sample).toHaveLength(3);
    expect(v.dateInterpretation).toMatch(/Mendoza/);
  });
  it('reimportar lo ya existente no suma nada y el token cambia con el contenido', () => {
    const first = previewHevy(p);
    const existing = new Set(p.rows.map((r) => r.externalKey));
    const again = previewHevy(p, existing);
    expect(again).toMatchObject({ newRows: 0, duplicatesExisting: 3 });
    expect(first.token).toBe(previewHevy(parseHevyCsv(text)).token); // determinista
    expect(first.token).not.toBe(again.token); // lo que se confirma es lo que se vio
    const more = parseHevyCsv(
      text + '\n' + line('5 abr 2026, 18:30', 'Squat (Barbell)', 1, 'normal', '142.5', '5'),
    );
    expect(previewHevy(more).token).not.toBe(first.token);
  });
  it('los ids de las filas son estables entre corridas', () => {
    expect(parseHevyCsv(text).rows.map((r) => r.id)).toEqual(p.rows.map((r) => r.id));
  });
});

describe('Gramática de protocolos', () => {
  it('interpreta los formatos del Macro v4 y rechaza lo ambiguo', () => {
    expect(parseProtocolText('3x6@7').blocks).toEqual([{ n: 3, reps: 6, repsMax: 6, rpe: 7, kg: null }]);
    expect(parseProtocolText('4x5x107,5@7 + 2x3x120').blocks).toEqual([
      { n: 4, reps: 5, repsMax: 5, rpe: 7, kg: 107.5 },
      { n: 2, reps: 3, repsMax: 3, rpe: null, kg: 120 },
    ]);
    expect(parseProtocolText('3x6-8@7').blocks[0]).toMatchObject({ reps: 6, repsMax: 8 });
    expect(parseProtocolText('5').blocks).toEqual([{ n: 1, reps: 5, repsMax: 5, rpe: null, kg: null }]);
    for (const bad of ['', 'subir si va fácil', '3x6@7,25', '3x8-6', '31x5', '3x6 +', '3x6@11'])
      expect(parseProtocolText(bad).error, bad).toBeTruthy();
  });
});

describe('Programación canónica (plan-canonical-v1)', () => {
  const H = 'block,week,date,exercise,protocol,exposure_id,lift,role,priority,variant,ref_kg,family,notes';
  const plan = (...rows: string[]) => [H, ...rows].join('\n');
  it('expande el protocolo a series con identidad, referencia y carga derivada solo si es calculable', () => {
    const r = parseCanonicalPlan(
      plan(
        'B1,1,2026-03-02,Squat comp,"3x5@8 + 1x3x160",squat-primaria,SQ,primaria,1,barra-alta,180,acumulacion,',
      ),
    );
    expect(r.ok).toBe(true);
    expect(r.sets).toHaveLength(4);
    expect(r.sets[0]).toMatchObject({
      id: 'B1-w1-d1-squat-primaria-1',
      exposureId: 'squat-primaria',
      exposureRole: 'primaria',
      priority: 1,
      variantKey: 'barra-alta',
      refKg: 180,
      targetRpe: 8,
      plannedKgSource: 'derived',
      familyKey: 'acumulacion',
    });
    expect(r.sets[0]!.plannedKg).toBeCloseTo(180 * 0.811, 6); // %tabla(5, RPE 8) × referencia
    expect(r.sets[3]).toMatchObject({ plannedKg: 160, plannedKgSource: 'fixed', targetRpe: null, reps: 3 });
    expect(r.summary).toMatchObject({ sessions: 1, sets: 4, weeks: 1 });
  });
  it('sin referencia, el RPE no genera carga prevista y se informa (disponibilidad parcial)', () => {
    const r = parseCanonicalPlan(plan('B1,1,2026-03-02,Squat comp,3x5@8,squat-primaria,SQ,,,,,,'));
    expect(r.sets.every((s) => s.plannedKg === null && s.targetRpe === 8)).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/sin carga prevista/);
    expect(plannedAvailability(r.sets)[0]!.metrics.find((m) => m.id === 'tonnage')!.status).toBe(
      'unavailable',
    );
    expect(plannedAvailability(r.sets)[0]!.metrics.find((m) => m.id === 'si_rts_total')!.status).toBe(
      'available',
    );
  });
  it('NO infiere fechas ni descansos, y rechaza con la línea y el motivo', () => {
    const r = parseCanonicalPlan(
      plan(
        'B1,1,,Squat comp,3x5@8,sq,SQ,,,,,,',
        'B1,1,2026-03-02,Squat comp,hacer 5 series,sq,SQ,,,,,,',
        'B1,x,2026-03-02,Squat comp,3x5@8,sq,SQ,,,,,,',
        'B1,1,2026-03-02,Squat comp,3x5@8,sq,XX,,,,,,',
        'B1,1,2026-03-02,Squat comp,3x5@8,sq,SQ,jefe,,,,,',
      ),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6]);
    expect(r.errors[0]!.message).toMatch(/NO se infiere/);
    expect(r.errors[1]!.message).toMatch(/no entiendo/);
  });
  it('avisa cuando la identidad se deriva del nombre y rechaza un ejercicio repetido en la misma sesión', () => {
    const r = parseCanonicalPlan(
      plan('B1,1,2026-03-02,Bench comp,3x5@8,,BP,,,,,,', 'B1,1,2026-03-02,Bench comp,3x5@8,,BP,,,,,,'),
    );
    expect(r.warnings.join(' ')).toMatch(/identidad se derivó del nombre/);
    expect(r.errors[0]!.message).toMatch(/aparece dos veces/);
  });
  it('un rango de reps no inventa un valor: guarda el mínimo y lo declara', () => {
    const r = parseCanonicalPlan(plan('B1,1,2026-03-02,Accesorio,3x8-12@7,acc,,,,,,,'));
    expect(r.sets[0]).toMatchObject({ reps: 8, lift: null });
    expect(r.sets[0]!.protocol?.instructions).toMatch(/rango/);
  });
  it('faltan columnas obligatorias', () => {
    expect(parseCanonicalPlan('block,week\nB1,1').errors[0]!.message).toMatch(/faltan columnas obligatorias/);
  });
});
