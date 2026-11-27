import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';

/** Cierre de bloque. Hoy = 2026-11-10: b-fin ya terminó, b-curso sigue en marcha. */
let app: FastifyInstance;
let id: string;
let token: string;
const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, t?: string) =>
  app.inject({ method, url, payload: body as object, headers: t ? { authorization: `Bearer ${t}` } : {} });
const set = (n: string, blockKey: string, date: string) => ({
  id: n,
  sessionKey: `s-${n}`,
  slotKey: `${blockKey}:${n}`,
  exposureId: n,
  exerciseName: 'Squat comp',
  lift: 'SQ',
  plannedDate: date,
  setNo: 1,
  reps: 5,
  targetRpe: 8,
  plannedKg: 100,
  refKg: 140,
  isWarmup: false,
  blockKey,
  weekNo: 1,
  dayNo: 1,
  priority: 1,
  protocol: null,
});
const answers = {
  general: { fatigue: 7, load: 'justa' },
  lifts: { SQ: { feel: 'mejor', discomfort: 0 }, BP: { fatigue: 9 } },
  notes: { next: 'más banca' },
};
const url = (block: string) => `/api/me/blocks/${block}/feedback`;

beforeAll(async () => {
  const ctx = await buildContext(
    { ...loadConfig({}), dbPath: ':memory:' },
    await openDb(':memory:'),
    () => '2026-11-10',
  );
  app = await buildApp(ctx);
  id = (await call('POST', '/api/athletes', { name: 'Ana' })).json().id;
  await call('POST', `/api/athletes/${id}/plan`, {
    sets: [
      set('a', 'b-fin', '2026-11-02'),
      set('b', 'b-curso', '2026-11-09'),
      set('c', 'b-curso', '2026-11-20'),
    ],
    status: 'aplicado',
  });
  await call('PUT', `/api/athletes/${id}/account`, { email: 'ana@mail.com', password: 'secreta1' });
  token = (await call('POST', '/api/auth/login', { email: 'ana@mail.com', password: 'secreta1' })).json()
    .token;
});

describe('cierre de bloque', () => {
  it('solo se ofrece cuando el bloque terminó', async () => {
    expect((await call('GET', '/api/me/home', undefined, token)).json().pendingClosing).toMatchObject({
      blockKey: 'b-fin',
    });
    expect((await call('GET', url('b-curso'), undefined, token)).statusCode).toBe(404);
    expect((await call('PUT', url('b-curso'), answers, token)).statusCode).toBe(404);
    const plan = (await call('GET', '/api/me/plan', undefined, token)).json();
    expect(plan.blocks.map((b: { key: string; closing: string | null }) => [b.key, b.closing])).toEqual([
      ['b-fin', 'pendiente'],
      ['b-curso', null],
    ]);
  });
  it('rechaza envíos vacíos o fuera de escala y exige sesión de atleta', async () => {
    const blank = { general: {}, lifts: {}, notes: {} };
    expect((await call('PUT', url('b-fin'), blank, token)).statusCode).toBe(400);
    expect((await call('PUT', url('b-fin'), { ...blank, general: { fatigue: 11 } }, token)).statusCode).toBe(
      400,
    );
    expect((await call('PUT', url('b-fin'), answers)).statusCode).toBe(401);
  });
  it('guarda, se puede corregir y el coach lo ve; lo no contestado queda en null', async () => {
    expect((await call('PUT', url('b-fin'), answers, token)).statusCode).toBe(200);
    await call('PUT', url('b-fin'), { ...answers, general: { fatigue: 5 } }, token);
    const items = (await call('GET', `/api/athletes/${id}/block-feedback`)).json().items;
    expect(items).toHaveLength(1);
    expect(items[0].answers.general).toMatchObject({ fatigue: 5, stress: null, load: null });
    expect(items[0].answers.lifts.SQ).toMatchObject({ feel: 'mejor', discomfort: 0, technique: null });
    // el bloque no tiene banca: no se guarda
    expect(items[0].answers.lifts.BP).toBeUndefined();
    expect((await call('GET', '/api/me/home', undefined, token)).json().pendingClosing).toBeNull();
    const exported = (await call('GET', `/api/athletes/${id}/block-export?block=b-fin`)).json();
    expect(exported.bloques[0].cierreDeBloque.respuestas.notes.next).toBe('más banca');
  });
  it('borrar el bloque pide confirmación y se lleva el cierre', async () => {
    expect((await call('DELETE', `/api/athletes/${id}/blocks/b-fin`)).statusCode).toBe(409);
    expect((await call('DELETE', `/api/athletes/${id}/blocks/b-fin?withExecution=1`)).statusCode).toBe(200);
    expect((await call('GET', `/api/athletes/${id}/block-feedback`)).json().items).toHaveLength(0);
  });
});
