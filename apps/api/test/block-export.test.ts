import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { LAB_DEFAULT_START, createLab } from '../src/seed/lab.js';

let app: FastifyInstance;
let ctx: AppContext;
let id: string;
let blocks: string[];
let sessionKey: string;
let exercise: string;
const get = async (url: string) => await app.inject({ method: 'GET', url });
const url = (extra: string, list = blocks) =>
  `/api/athletes/${id}/block-export?${list.map((b) => `block=${encodeURIComponent(b)}`).join('&')}${extra}`;

beforeAll(async () => {
  const k = { value: LAB_DEFAULT_START };
  ctx = await buildContext(
    { ...loadConfig({}), dbPath: ':memory:' },
    await openDb(':memory:'),
    () => '2026-11-08',
  );
  app = await buildApp(ctx);
  const ids = (await createLab(ctx, k, LAB_DEFAULT_START)).map((c) => c.id);
  for (const candidate of ids) {
    const done = new Set(
      (await ctx.records.listActual(candidate)).filter((a) => a.status === 'done').map((a) => a.plannedSetId),
    );
    const planned = await ctx.records.listActivePlanned(candidate);
    const first = planned.find((s) => done.has(s.id));
    if (!first) continue;
    id = candidate;
    blocks = [...new Set(planned.map((s) => s.blockKey))];
    sessionKey = first.sessionKey;
    exercise = first.exerciseName;
    break;
  }
  await ctx.accounts.setNote(id, sessionKey, exercise, '=me molestó, "un poco"', '2026-10-01T12:00:00.000Z');
  await ctx.history.upsertFeedback(id, { sessionKey, endFatigue: 7, note: 'sesión dura' });
});

describe('GET /athletes/:id/block-export', () => {
  it('JSON: previsto y real separados, notas y uno o varios bloques', async () => {
    const r = await get(url('&format=json'));
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toContain('.json"');
    const j = r.json();
    expect(j.bloques.map((b: { bloque: string }) => b.bloque).sort()).toEqual([...blocks].sort());
    const planned = (await ctx.records.listActivePlanned(id)).length;
    type S = {
      sesion: string;
      cierreAtleta: unknown;
      ejercicios: {
        nombre: string;
        notaAtleta: string | null;
        series: { real: { estado: string; kg: number | null } }[];
      }[];
    };
    const sessions: S[] = j.bloques.flatMap((b: { sesiones: S[] }) => b.sesiones);
    const sets = sessions.flatMap((s) => s.ejercicios.flatMap((e) => e.series));
    expect(sets.length).toBeGreaterThanOrEqual(planned);
    for (const s of sets) if (s.real.estado !== 'hecha') expect(s.real.kg).toBeNull();
    const noted = sessions.find((s) => s.sesion === sessionKey) as S;
    expect(noted.cierreAtleta).toEqual({ fatigaFinal: 7, nota: 'sesión dura' });
    expect(noted.ejercicios.find((e) => e.nombre === exercise)?.notaAtleta).toBe('=me molestó, "un poco"');
    expect(j.bloques[0].resumen.porMovimiento.total.previsto.metricas.length).toBeGreaterThan(0);
    const one = (await get(url('', [blocks[0] as string]))).json();
    expect(one.bloques).toHaveLength(1);
  });
  it('CSV: una fila por serie, columnas parejas y sin fórmulas en los textos', async () => {
    const r = await get(url('&format=csv'));
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.body.startsWith('﻿bloque,')).toBe(true);
    expect(r.body).toContain('"\'=me molestó, ""un poco"""');
    // separa respetando comillas
    const rows = r.body.split('\r\n').map((l) => l.replace(/"(?:[^"]|"")*"/g, 'x').split(','));
    for (const row of rows) expect(row).toHaveLength(rows[0]!.length);
    expect(rows.length).toBeGreaterThan((await ctx.records.listActivePlanned(id)).length);
  });
  it('sin nombre: no aparece en el contenido ni en el nombre del archivo', async () => {
    const name = (await ctx.athletes.get(id))!.name;
    const r = await get(url('&anon=1'));
    expect(r.json().atleta.nombre).toBeNull();
    expect(r.json().atleta).not.toHaveProperty('fechaNacimiento');
    expect(r.body).not.toContain(name);
    expect(r.headers['content-disposition']).toBe('attachment; filename="bloques-2026-11-08.json"');
  });
  it('un corte anterior no incluye ejecución posterior', async () => {
    const r = await get(url(`&asOf=${LAB_DEFAULT_START}`, [blocks[0] as string]));
    if (r.statusCode === 404) return;
    for (const m of r.body.matchAll(/"fecha":"(\d{4}-\d{2}-\d{2})"/g))
      expect(m[1]! <= LAB_DEFAULT_START).toBe(true);
  });
  it('semanas sueltas: solo lo elegido, solas o combinadas con bloques enteros', async () => {
    const planned = await ctx.records.listActivePlanned(id);
    const [a, b] = blocks as [string, string];
    const weeks = [...new Set(planned.filter((s) => s.blockKey === a).map((s) => s.weekNo))].sort();
    expect(weeks.length).toBeGreaterThan(2);
    const pick = [weeks[0] as number, weeks[2] as number];
    const query = pick.map((n) => `week=${n}:${encodeURIComponent(a)}`).join('&');
    const r = await get(`/api/athletes/${id}/block-export?${query}&block=${encodeURIComponent(b)}`);
    expect(r.statusCode).toBe(200);
    type B = {
      bloque: string;
      alcance: string;
      semanasIncluidas: number[];
      sesiones: { semana: number; ejercicios: { series: unknown[] }[] }[];
    };
    const [first, second] = r.json().bloques as [B, B];
    expect(first).toMatchObject({ bloque: a, alcance: 'semanas_elegidas', semanasIncluidas: pick });
    expect([...new Set(first.sesiones.map((s) => s.semana))].sort()).toEqual(pick);
    expect(first.sesiones.flatMap((s) => s.ejercicios.flatMap((e) => e.series))).toHaveLength(
      planned.filter((s) => s.blockKey === a && pick.includes(s.weekNo)).length,
    );
    expect(second).toMatchObject({ bloque: b, alcance: 'bloque_completo' });
    expect(r.body).not.toContain(
      `"semana":${weeks[1]},"dia":1,"fechaPrevista":"${planned.find((s) => s.blockKey === a && s.weekNo === weeks[1])!.plannedDate}"`,
    );
    // el CSV respeta la misma selección
    const csv = (await get(`/api/athletes/${id}/block-export?${query}&format=csv`)).body.split('\r\n');
    expect(csv).toHaveLength(1 + planned.filter((s) => s.blockKey === a && pick.includes(s.weekNo)).length);
    expect((await get(`/api/athletes/${id}/block-export?week=99:${a}`)).statusCode).toBe(404);
    expect((await get(`/api/athletes/${id}/block-export?week=${a}`)).statusCode).toBe(400);
  });
  it('valida parámetros, bloque y atleta', async () => {
    expect((await get(`/api/athletes/${id}/block-export`)).statusCode).toBe(400);
    expect((await get(url('&format=xlsx'))).statusCode).toBe(400);
    expect((await get(url('', ['__no__']))).statusCode).toBe(404);
    expect((await get(`/api/athletes/nope/block-export?block=a`)).statusCode).toBe(404);
  });
});
