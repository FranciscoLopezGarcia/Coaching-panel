import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';

let app: FastifyInstance;
let ctx: AppContext;
let id: string;
const call = async (method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) =>
  app.inject({ method, url, payload: body as object });
const set = (n: string, weekNo: number, date: string) => ({
  id: n,
  sessionKey: `s-${n}`,
  slotKey: `b:${n}`,
  exposureId: 'sq',
  exerciseName: 'Squat comp',
  lift: 'SQ',
  plannedDate: date,
  setNo: 1,
  reps: 5,
  targetRpe: 8,
  plannedKg: 100,
  refKg: 140,
  isWarmup: false,
  blockKey: 'b1',
  weekNo,
  dayNo: 1,
  priority: 1,
  protocol: null,
});
const week = (n: number) => `/api/athletes/${id}/blocks/b1/weeks/${n}`;

beforeAll(async () => {
  ctx = await buildContext(
    { ...loadConfig({}), dbPath: ':memory:' },
    await openDb(':memory:'),
    () => '2026-11-10',
  );
  app = await buildApp(ctx);
  id = (await call('POST', '/api/athletes', { name: 'Ana' })).json().id;
  await call('POST', `/api/athletes/${id}/plan`, {
    sets: [set('a', 1, '2026-10-26'), set('b', 2, '2026-11-02'), set('c', 3, '2026-11-09')],
    status: 'aplicado',
  });
  await ctx.records.upsertActual(
    id,
    [
      {
        plannedSetId: 'a',
        status: 'done',
        kg: 100,
        reps: 5,
        rpe: 8,
        performedOn: '2026-10-26',
        pain: null,
      },
    ],
    '2026-10-26T12:00:00.000Z',
  );
  await ctx.history.upsertFeedback(id, { sessionKey: 's-a', endFatigue: 6 });
});

describe('semáforo de planificación', () => {
  it('informa qué hay esta semana, la siguiente y el bloque que termina', async () => {
    const d = (await call('GET', '/api/dashboard')).json();
    expect(d.planning).toEqual([
      {
        athleteId: id,
        athleteName: 'Ana',
        hasCurrent: true,
        hasNext: false,
        plannedUntil: '2026-11-09',
        endingBlocks: [{ blockKey: 'b1', name: 'b1', endDate: '2026-11-09' }],
        currentBlock: 'b1',
        lastCheckIn: null,
        checkInPending: true,
      },
    ]);
    // El contador de arriba y el semáforo salen del mismo criterio.
    expect(d.cards).toMatchObject({ blocksEnding: 1, pendingCheckins: 1 });
  });
});

describe('eliminar una semana', () => {
  const left = async () => (await ctx.records.listPlanned(id)).map((s) => s.id).sort();
  it('sin registros se borra directo y las demás no se tocan', async () => {
    expect((await call('GET', `${week(2)}/removal-preview`)).json()).toMatchObject({
      sets: 1,
      executedSets: 0,
      notes: 0,
    });
    expect((await call('DELETE', week(2))).statusCode).toBe(200);
    expect(await left()).toEqual(['a', 'c']);
    expect((await ctx.records.listActivePlanned(id)).map((s) => s.weekNo)).toEqual([1, 3]);
  });
  it('con registros del atleta exige confirmación y después borra todo lo de esa semana', async () => {
    expect((await call('DELETE', week(1))).statusCode).toBe(409);
    expect(await left()).toEqual(['a', 'c']);
    expect((await call('DELETE', `${week(1)}?withExecution=1`)).statusCode).toBe(200);
    expect(await left()).toEqual(['c']);
    expect(await ctx.records.listActual(id)).toHaveLength(0);
    expect(await ctx.history.listFinishes(id)).toHaveLength(0);
  });
  it('semana inexistente o mal escrita', async () => {
    expect((await call('DELETE', week(9))).statusCode).toBe(404);
    expect((await call('DELETE', `/api/athletes/${id}/blocks/b1/weeks/x`)).statusCode).toBe(400);
  });
});
