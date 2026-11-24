import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { FAMILIES, FUERZA_METRICS } from '../../web/src/analysis/families';
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

describe('GET /athletes/:id/analysis (Analizar: una sola respuesta, solo lectura)', () => {
  it('trae períodos, bloques, distribución, récords y TTP, y es determinista', async () => {
    for (const id of ids) {
      const r = await get(`/api/athletes/${id}/analysis`);
      expect(r.statusCode).toBe(200);
      const j = r.json();
      expect(j.version).toBe('analysis-frame-v1');
      const mids: string[] = j.metrics.map((m: { id: string }) => m.id);
      expect(new Set(mids).size).toBe(mids.length);
      expect(mids).toEqual(expect.arrayContaining(['nl', 'tonnage', 'si_total', 'compliance_sets']));
      expect(j.periods.length).toBeGreaterThan(0);
      for (const p of j.periods) {
        // sin fuga de futuro: nada realizado después del corte
        if (p.actual) expect(p.from <= j.asOf).toBe(true);
        for (const v of Object.values({ ...(p.planned ?? {}), ...(p.actual ?? {}) }))
          expect(v === null || Number.isFinite(v as number)).toBe(true);
      }
      expect(Array.isArray(j.distribution.actual.weeks)).toBe(true);
      expect(Array.isArray(j.distribution.planned.muscles)).toBe(true);
      expect(j.summary).toHaveProperty('blocks');
      expect((await get(`/api/athletes/${id}/analysis`)).json()).toEqual(j);
    }
  });
  it('el registro del servidor y las familias de la pantalla coinciden: cada magnitud vive en una sola tarjeta', async () => {
    const j = (await get(`/api/athletes/${ids[0]}/analysis`)).json();
    const registry: string[] = j.metrics.map((m: { id: string }) => m.id).sort();
    const shown = [...FAMILIES.flatMap((f) => f.metrics), ...FUERZA_METRICS].sort();
    expect(shown).toEqual(registry);
  });
  it('escala por sesión y filtro por lift', async () => {
    const id = ids[0] as string;
    const week = (await get(`/api/athletes/${id}/analysis?lift=SQ`)).json();
    const sess = (await get(`/api/athletes/${id}/analysis?lift=SQ&granularity=session`)).json();
    expect(sess.granularity).toBe('session');
    expect(sess.periods.length).toBeGreaterThanOrEqual(week.periods.length);
    expect(sess.periods.every((p: { sessionKey: string | null }) => p.sessionKey !== null)).toBe(true);
    // la suma de NL por sesión coincide con la de NL por semana (misma regla, otra escala)
    const nl = (j: { periods: { actual: { nl: number | null } | null }[] }) =>
      j.periods.reduce((a, p) => a + (p.actual?.nl ?? 0), 0);
    expect(nl(sess)).toBe(nl(week));
  });
  it('valida parámetros y atleta inexistente', async () => {
    expect((await get(`/api/athletes/${ids[0]}/analysis?granularity=hora`)).statusCode).toBe(400);
    expect((await get(`/api/athletes/${ids[0]}/analysis?asOf=ayer`)).statusCode).toBe(400);
    expect((await get(`/api/athletes/nope/analysis`)).statusCode).toBe(404);
  });
});
