import { describe, expect, it } from 'vitest';
import { parseQuickSession, segmentsToText, suggestLift } from './quickSession';

const p = (t: string) => parseQuickSession(t);
describe('carga rápida por texto', () => {
  it('3x5@4-5-6 crea una serie por RPE sin repetir a mano el ejercicio', () => {
    const r = p('Squat comp 3x5@4-5-6');
    expect(r.errors).toEqual([]);
    expect(r.segments.map((s) => [s.count, s.reps, s.rpe])).toEqual([
      ['1', '5', '4'],
      ['1', '5', '5'],
      ['1', '5', '6'],
    ]);
    expect(r.segments.every((s) => s.exerciseName === 'Squat comp' && s.lift === 'SQ')).toBe(true);
    expect(r.lines[0]!.sets).toBe(3);
  });
  it('series iguales quedan en un solo segmento', () => {
    const r = p('Bench comp 4x5@8');
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toMatchObject({ count: '4', reps: '5', rpe: '8', mode: 'rpe', lift: 'BP' });
  });
  it('rango de reps, RIR → RPE y notas', () => {
    const r = p('Remo barra 3x10-12 RIR2 saltos fijos');
    expect(r.errors).toEqual([]);
    expect(r.segments[0]).toMatchObject({
      reps: '10',
      repsMax: '12',
      rpe: '8',
      note: 'saltos fijos',
      lift: '',
    });
  });
  it('cargas por serie y varios bloques', () => {
    const r = p('Deadlift comp 1x5x100 + 3x5x90@8');
    expect(r.errors).toEqual([]);
    expect(r.segments.map((s) => [s.count, s.kg, s.rpe, s.mode])).toEqual([
      ['1', '100', '', 'kg'],
      ['3', '90', '8', 'kg'],
    ]);
    const q = p('Sentadilla 3x5x100-105-110');
    expect(q.segments.map((s) => s.kg)).toEqual(['100', '105', '110']);
  });
  it('dos valores en más series arman una rampa y lo avisan', () => {
    const r = p('Squat 5x3@6-8');
    expect(r.segments.map((s) => s.rpe)).toEqual(['6', '6,5', '7', '7,5', '8']);
    expect(r.lines[0]!.warnings).toContain('RPE en rampa');
  });
  it('prioridad del coach, continuación y tablas', () => {
    const r = p('1° Squat safety 3x5@6\n  2x3@8\nCurl barra 3x10');
    expect(r.errors).toEqual([]);
    expect(r.segments.map((s) => [s.exerciseName, s.priority])).toEqual([
      ['Squat safety', '1'],
      ['Squat safety', '1'],
      ['Curl barra', '3'],
    ]);
    const t = p(
      '| Ejercicio | Sets x Reps | Notas |\n|---|---|---|\n| Bench press con cadena | 4x3-5 | Accommodating resistance |',
    );
    expect(t.segments[0]).toMatchObject({
      exerciseName: 'Bench press con cadena',
      count: '4',
      reps: '3',
      repsMax: '5',
      note: 'Accommodating resistance',
    });
  });
  it('errores claros con número de línea', () => {
    const r = p('Squat 3x5@11\nBench sin protocolo\nRow 3x5@4-5-6-7');
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3]);
    expect(r.errors[0]!.message).toMatch(/RPE/);
    expect(r.errors[2]!.message).toMatch(/4 valores para 3 series/);
  });
  it('ida y vuelta y sugerencia de movimiento', () => {
    const r = p('1° Squat comp 3x5x100@7');
    expect(segmentsToText(r.segments)).toBe('1° Squat comp 3x5x100@7');
    expect(suggestLift('DL 3"pausa rodilla')).toBe('DL');
    expect(suggestLift('Bench mancuerna')).toBe('');
  });

  it('«#» y «"…"» son comentarios del coach: no cambian la prescripción y quedan como nota', () => {
    const r = parseQuickSession(
      'Squat comp 3x5@7 # pausa de 1s abajo\nBench comp 4x6@8 "codos a 45°"\n# cuidar el hombro\nRemo 3x10-12 RIR2',
    );
    expect(r.errors).toEqual([]);
    const sq = r.segments.filter((x) => x.exerciseName === 'Squat comp');
    expect(sq[0]).toMatchObject({ count: '3', reps: '5', rpe: '7', note: 'pausa de 1s abajo' });
    const bp = r.segments.filter((x) => x.exerciseName === 'Bench comp');
    expect(bp[0]?.note).toBe('codos a 45° · cuidar el hombro');
    expect(r.segments.find((x) => x.exerciseName === 'Remo')?.note).toBe('');
  });
  it('un comentario sin ejercicio previo avisa', () => {
    expect(parseQuickSession('# hola').errors[0]?.message).toMatch(/después de un ejercicio/);
  });
});
