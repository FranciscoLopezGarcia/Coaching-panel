import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { LAB_DEFAULT_START, createLab } from '../src/seed/lab.js';

let app: FastifyInstance;
let id: string;
const call = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  await app.inject({ method, url, payload: payload as never });

beforeAll(async () => {
  const k = { value: LAB_DEFAULT_START };
  const ctx = await buildContext(
    { ...loadConfig({}), dbPath: ':memory:' },
    await openDb(':memory:'),
    () => '2026-11-08',
  );
  app = await buildApp(ctx);
  id = (await createLab(ctx, k, LAB_DEFAULT_START))[0]!.id;
});

describe('Mejoras del coach', () => {
  it('el analizador de bloques trae zonas de intensidad y respeta los cortes del atleta', async () => {
    const a = (await call('GET', `/api/athletes/${id}/block-analysis?source=actual`)).json();
    expect(a.zones.cuts).toEqual([75, 90]);
    expect(a.zones.byBlock).toHaveLength(a.window.blocks.length);
    const athlete = (await call('GET', `/api/athletes/${id}`)).json();
    const put = await call('PUT', `/api/athletes/${id}/params`, {
      ...athlete.params,
      intensityCuts: [70, 80, 90],
    });
    expect(put.statusCode).toBe(200);
    const b = (await call('GET', `/api/athletes/${id}/block-analysis?source=actual`)).json();
    expect(b.zones.cuts).toEqual([70, 80, 90]);
    expect(b.zones.byBlock[0].zones).toHaveLength(4);
  });
  it('granularidad muscular configurable: la vista agrupada no duplica series', async () => {
    const q = 'from=2026-01-01&to=2026-12-31&cutoff=2026-11-08';
    const fino = (await call('GET', `/api/athletes/${id}/weekly-muscles?${q}&view=fino`)).json();
    const grueso = (await call('GET', `/api/athletes/${id}/weekly-muscles?${q}&view=grueso`)).json();
    const keys = new Set(grueso.rows.map((r: { muscle: string }) => r.muscle));
    expect(keys.size).toBeLessThanOrEqual(5);
    expect(new Set(fino.rows.map((r: { muscle: string }) => r.muscle)).size).toBeGreaterThan(keys.size);
    expect(grueso.rows.every((r: { label: string }) => typeof r.label === 'string')).toBe(true);
  });
  it('TRAC ampliado: se guarda aparte y NO cambia la disposición', async () => {
    const base = { date: '2026-11-07', sleep: 7, energy: 7, motivation: 7, stress: 4, pain: 2 };
    expect((await call('POST', `/api/athletes/${id}/checkins`, base)).statusCode).toBe(200);
    const sinExtras = (await call('GET', `/api/athletes/${id}/checkins`))
      .json()
      .find((c: { date: string }) => c.date === '2026-11-07');
    await call('POST', `/api/athletes/${id}/checkins`, {
      ...base,
      soreness: 6,
      confidence: 8,
      sleepHours: 6.5,
      bodyweightKg: 83.4,
      note: 'poco sueño',
    });
    const conExtras = (await call('GET', `/api/athletes/${id}/checkins`))
      .json()
      .find((c: { date: string }) => c.date === '2026-11-07');
    expect(conExtras.readiness).toBe(sinExtras.readiness);
    expect(conExtras).toMatchObject({
      soreness: 6,
      confidence: 8,
      sleepHours: 6.5,
      bodyweightKg: 83.4,
      note: 'poco sueño',
    });
    expect((await call('POST', `/api/athletes/${id}/checkins`, { ...base, soreness: 11 })).statusCode).toBe(
      400,
    );
  });
  it('exportación para IA: markdown y JSON del mismo corte, sin accesos', async () => {
    const md = await call('GET', `/api/athletes/${id}/export?asOf=2026-11-08`);
    expect(md.statusCode).toBe(200);
    expect(md.headers['content-type']).toContain('text/markdown');
    expect(md.body).toContain('## e1RM');
    expect(md.body).not.toMatch(/password|token/i);
    const js = (await call('GET', `/api/athletes/${id}/export?asOf=2026-11-08&format=json`)).json();
    expect(js.version).toBe('export-v1');
    expect(js.blocks.length).toBeGreaterThan(0);
  });
  it('las series de las sesiones exponen el rol del movimiento', async () => {
    const s = (await call('GET', `/api/athletes/${id}/sessions`)).json();
    expect(s[0].sets[0]).toHaveProperty('exposureRole');
  });
});
