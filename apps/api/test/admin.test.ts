import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';

/** Editar y eliminar atletas y bloques. BD en memoria, hoy = 2026-11-10. */
let app: FastifyInstance;
let ctx: AppContext;
const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) =>
  app.inject({ method, url, payload: body as object });
const j = async (r: ReturnType<typeof call>) => (await r).json();

const set = (
  id: string,
  block: string,
  session: string,
  date: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  sessionKey: session,
  slotKey: `${block}:${session}`,
  exposureId: `${session}:Squat`,
  exerciseName: 'Squat comp',
  lift: 'SQ',
  plannedDate: date,
  setNo: 1,
  reps: 5,
  targetRpe: 8,
  plannedKg: 100,
  refKg: 140,
  isWarmup: false,
  blockKey: block,
  weekNo: 1,
  dayNo: 1,
  priority: 1,
  protocol: null,
  ...extra,
});
let a: string;
let b: string;

beforeAll(async () => {
  ctx = await buildContext(
    { ...loadConfig({}), dbPath: ':memory:' },
    await openDb(':memory:'),
    () => '2026-11-10',
  );
  app = await buildApp(ctx);
  a = (await j(call('POST', '/api/athletes', { name: 'Ana Admin' }))).id;
  b = (await j(call('POST', '/api/athletes', { name: 'Beto Intacto' }))).id;
  for (const id of [a, b])
    await call('POST', `/api/athletes/${id}/plan`, {
      sets: [
        set('s1', 'bloque-1', 'k1', '2026-10-01'),
        set('s2', 'bloque-1', 'k2', '2026-10-03'),
        set('s3', 'bloque-2', 'k3', '2026-11-12'),
      ],
      status: 'aplicado',
    });
  await call('PUT', `/api/athletes/${a}/mesos`, {
    blockKey: 'bloque-1',
    name: 'Uno',
    startDate: '2026-10-01',
    endDate: '2026-10-07',
  });
  await call('PUT', `/api/athletes/${a}/mesos`, {
    blockKey: 'bloque-2',
    name: 'Dos',
    startDate: '2026-11-09',
    endDate: '2026-11-15',
  });
  await call('PUT', `/api/athletes/${a}/account`, { email: 'ana@admin.com', password: 'secreto1' });
  // lo hecho en el bloque 1
  await call('POST', `/api/athletes/${a}/sets`, {
    sets: [
      { plannedSetId: 's1', status: 'done', kg: 100, reps: 5, rpe: 8, performedOn: '2026-10-01', pain: null },
    ],
  });
});
afterAll(async () => {
  await app.close();
});
const count = async (id: string, table: string) =>
  Number(
    (await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE athlete_id = ?`, id))?.n ?? 0,
  );

describe('editar atleta', () => {
  it('cambia nombre y ejercicios de competencia sin tocar lo demás', async () => {
    const r = await j(
      call('PATCH', `/api/athletes/${a}`, {
        name: 'Ana Editada',
        competitionExercises: { SQ: 'Sentadilla comp' },
      }),
    );
    expect(r).toMatchObject({ name: 'Ana Editada' });
    expect(r.competitionExercises).toMatchObject({
      SQ: 'Sentadilla comp',
      BP: 'Bench comp',
      DL: 'Deadlift comp',
    });
    await call('PATCH', `/api/athletes/${a}`, { name: 'Ana Admin' });
  });
  it('rechaza vacío, nombre en blanco y campos desconocidos', async () => {
    expect((await call('PATCH', `/api/athletes/${a}`, {})).statusCode).toBe(422);
    expect((await call('PATCH', `/api/athletes/${a}`, { name: '   ' })).statusCode).toBe(400);
    expect((await call('PATCH', `/api/athletes/${a}`, { params: {} })).statusCode).toBe(400);
    expect((await call('PATCH', '/api/athletes/nope', { name: 'X' })).statusCode).toBe(404);
  });
});

describe('eliminar bloque', () => {
  it('la vista previa cuenta sesiones, series y lo ya registrado', async () => {
    expect(await j(call('GET', `/api/athletes/${a}/blocks/bloque-1/removal-preview`))).toMatchObject({
      name: 'Uno',
      sessions: 2,
      sets: 2,
      executedSets: 1,
    });
    expect((await call('GET', `/api/athletes/${a}/blocks/no-existe/removal-preview`)).statusCode).toBe(404);
  });
  it('con ejecución registrada NO se elimina sin confirmar', async () => {
    const r = await call('DELETE', `/api/athletes/${a}/blocks/bloque-1`);
    expect(r.statusCode).toBe(409);
    expect(await count(a, 'planned_sets')).toBe(3);
  });
  it('un bloque sin ejecución se elimina completo (series, ficha y microciclos) y deja una versión del plan', async () => {
    const versionsBefore = (await j(call('GET', `/api/athletes/${a}/plan-versions`))).length;
    const r = await j(call('DELETE', `/api/athletes/${a}/blocks/bloque-2`));
    expect(r).toMatchObject({ blockKey: 'bloque-2', sets: 1, executedSets: 0 });
    const sessions = await j(call('GET', `/api/athletes/${a}/sessions`));
    expect(sessions.map((s: { blockKey: string }) => s.blockKey)).not.toContain('bloque-2');
    expect(
      (await j(call('GET', `/api/athletes/${a}/mesos`))).map((m: { blockKey: string }) => m.blockKey),
    ).toEqual(['bloque-1']);
    expect((await j(call('GET', `/api/athletes/${a}/plan-versions`))).length).toBe(versionsBefore + 1);
    // el otro atleta no se tocó
    expect(await count(b, 'planned_sets')).toBe(3);
  });
  it('con confirmación se borra también lo registrado', async () => {
    const r = await j(call('DELETE', `/api/athletes/${a}/blocks/bloque-1?withExecution=1`));
    expect(r.executedSets).toBe(1);
    expect(await count(a, 'planned_sets')).toBe(0);
    expect(await count(a, 'actual_sets')).toBe(0);
    expect(await count(b, 'planned_sets')).toBe(3);
  });
});

describe('eliminar atleta', () => {
  it('exige el nombre exacto y no borra nada si no coincide', async () => {
    expect((await call('DELETE', `/api/athletes/${a}?confirm=ana`)).statusCode).toBe(422);
    expect((await call('DELETE', `/api/athletes/${a}`)).statusCode).toBe(400);
    expect((await call('GET', `/api/athletes/${a}`)).statusCode).toBe(200);
  });
  it('con el nombre exacto borra al atleta y todo lo suyo, y no toca a nadie más', async () => {
    await call('POST', `/api/athletes/${a}/checkins`, {
      date: '2026-11-01',
      sleep: 7,
      energy: 7,
      motivation: 7,
      stress: 3,
      pain: 0,
    });
    const r = await j(call('DELETE', `/api/athletes/${a}?confirm=${encodeURIComponent('Ana Admin')}`));
    expect(r.removed).toBe('Ana Admin');
    expect((await call('GET', `/api/athletes/${a}`)).statusCode).toBe(404);
    for (const t of [
      'planned_sets',
      'actual_sets',
      'checkins',
      'plan_versions',
      'athlete_accounts',
      'athlete_rev',
      'mesos',
      'record_revisions',
    ])
      expect(await count(a, t), t).toBe(0);
    // su acceso al portal ya no existe
    expect(
      (await call('POST', '/api/auth/login', { email: 'ana@admin.com', password: 'secreto1' })).statusCode,
    ).toBe(401);
    // el otro atleta sigue completo
    expect((await call('GET', `/api/athletes/${b}`)).statusCode).toBe(200);
    expect(await count(b, 'planned_sets')).toBe(3);
    expect((await j(call('GET', '/api/athletes'))).map((x: { name: string }) => x.name)).toEqual([
      'Beto Intacto',
    ]);
  });
});
