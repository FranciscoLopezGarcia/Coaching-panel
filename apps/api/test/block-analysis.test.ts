import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { LAB_DEFAULT_START, createLab } from '../src/seed/lab.js';

let app: FastifyInstance;
let ids: string[];
const get = async (url: string) => await app.inject({ method: 'GET', url });

beforeAll(async () => {
  const k = { value: LAB_DEFAULT_START };
  const ctx = await buildContext(
    { ...loadConfig({}), dbPath: ':memory:' },
    await openDb(':memory:'),
    () => '2026-11-08',
  );
  app = await buildApp(ctx);
  ids = (await createLab(ctx, k, LAB_DEFAULT_START)).map((c) => c.id);
});

describe('GET /athletes/:id/block-analysis', () => {
  it('devuelve ventana, filas con deltas vecinos y es determinista', async () => {
    for (const id of ids) {
      const r = await get(`/api/athletes/${id}/block-analysis?source=planned`);
      if (r.statusCode === 404) continue; // atleta sin bloques
      expect(r.statusCode).toBe(200);
      const j = r.json();
      expect(j.window.blocks.length).toBeLessThanOrEqual(4);
      expect(j.window.blocks.length).toBeGreaterThan(0);
      for (const row of j.rows) {
        expect(row.values).toHaveLength(j.window.blocks.length);
        expect(row.deltas).toHaveLength(j.window.blocks.length - 1);
      }
      expect((await get(`/api/athletes/${id}/block-analysis?source=planned`)).json()).toEqual(j);
    }
  });
  it('valida parámetros y atleta inexistente', async () => {
    expect((await get(`/api/athletes/${ids[0]}/block-analysis?source=otra`)).statusCode).toBe(400);
    expect((await get(`/api/athletes/nope/block-analysis`)).statusCode).toBe(404);
    expect((await get(`/api/athletes/${ids[0]}/block-analysis?block=__no__`)).statusCode).toBe(404);
  });
  it('un corte anterior no ve ejecución posterior', async () => {
    const id = ids[0] as string;
    const early = (await get(`/api/athletes/${id}/block-analysis?asOf=${LAB_DEFAULT_START}`)).json();
    const late = (await get(`/api/athletes/${id}/block-analysis`)).json();
    const done = (j: { quality: { done: number }[] }) => j.quality.reduce((a, q) => a + q.done, 0);
    expect(done(early)).toBeLessThanOrEqual(done(late));
  });
});
