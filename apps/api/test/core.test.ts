import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { LAB_DEFAULT_START, addDays, createLab } from '../src/seed/lab.js';

/** Variables núcleo y tablas por HTTP, sobre el laboratorio ficticio (BD en memoria). */
let app: FastifyInstance;
let ids: Record<string, string>;
const wk = (w: number) => addDays(LAB_DEFAULT_START, (w - 1) * 7 + 6);
const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();
const status = async (url: string) => (await app.inject({ method: 'GET', url })).statusCode;

beforeAll(async () => {
  const k = { value: LAB_DEFAULT_START };
  const ctx = buildContext({ ...loadConfig({}), dbPath: ':memory:' }, openDb(':memory:'), () => '2026-11-08');
  app = await buildApp(ctx);
  ids = Object.fromEntries(createLab(ctx, k, LAB_DEFAULT_START).map((c) => [c.key, c.id]));
});

describe('GET /athletes/:id/core', () => {
  it('E · NL semanal 50 en las 12 semanas con 2 y luego 3 sesiones; tonelaje, SI y músculos por semana', async () => {
    const r = await get(
      `/api/athletes/${ids['E']}/core?from=${LAB_DEFAULT_START}&to=${wk(12)}&cutoff=${wk(12)}&lift=SQ`,
    );
    expect(r.version).toBe('nucleo-v1');
    expect(r.weeks).toHaveLength(12);
    for (const w of r.weeks) expect(w.totals.nl.value).toBe(50);
    expect(r.weeks.map((w: { sessions: number }) => w.sessions)).toEqual([
      2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3,
    ]);
    expect(r.weeks[0].totals.tonnage.value).toBeGreaterThan(0);
    expect(r.weeks[0].totals.si.rts.total.status).toBe('available');
    expect(
      r.weeks[0].muscles.rows.find((m: { muscle: string }) => m.muscle === 'cuadriceps').directSets,
    ).toBe(10);
    expect(r.totals.nl.value).toBe(600);
    expect(JSON.stringify(r.totals.si)).toContain('efort-xl-v1');
  });
  it('B · fatiga entre series (deriva de RPE) y entre sesiones (cambio vs la anterior, fatiga reportada, razón agudo/crónico)', async () => {
    const r = await get(
      `/api/athletes/${ids['B']}/core?from=${LAB_DEFAULT_START}&to=${wk(12)}&cutoff=${wk(12)}&lift=SQ&view=sessions`,
    );
    expect(r.weeks).toEqual([]);
    const withDrift = r.sessions.filter((s: { exercises: { fatigueBetweenSets: { rpe: unknown } }[] }) =>
      s.exercises.some((e) => e.fatigueBetweenSets.rpe),
    );
    expect(withDrift.length).toBeGreaterThan(0);
    const late = r.sessions.at(-1);
    expect(late.fatigue.endFatigue === null || late.fatigue.endFatigue >= 1).toBe(true);
    expect(late.fatigue.rolling.ratio).not.toBeNull(); // más de 28 días de historia
    const withPrev = r.sessions
      .flatMap((x: { exercises: { vsPrevious: { daysSince: number } | null }[] }) => x.exercises)
      .find((e: { vsPrevious: unknown }) => e.vsPrevious);
    expect(withPrev.vsPrevious.daysSince).toBe(7); // mismo ejercicio y variante: el lunes anterior
    expect(late.fatigue.readiness.ageDays).toBeGreaterThanOrEqual(0);
  });
  it('D · datos incompletos: SI parcial o no disponible sin inventar; NL y tonelaje siguen', async () => {
    const r = await get(
      `/api/athletes/${ids['D']}/core?from=${LAB_DEFAULT_START}&to=${wk(10)}&cutoff=${wk(10)}`,
    );
    expect(r.totals.nl.status).not.toBe('unavailable');
    expect(r.totals.si.rts.total.status).toBe('partial');
    expect(r.warnings.join(' ')).toMatch(/sin RPE real/);
    const w8 = r.weeks.find(
      (w: { week: { from: string } }) => w.week.from === addDays(LAB_DEFAULT_START, 49),
    );
    expect(w8.sessions).toBe(0); // la semana sin registro no se rellena con ceros
    expect(w8.totals.nl.value).toBeNull();
  });
  it('respeta el corte: el laboratorio tiene semanas posteriores que no aparecen', async () => {
    const r = await get(
      `/api/athletes/${ids['A']}/core?from=${LAB_DEFAULT_START}&to=${wk(16)}&cutoff=${wk(10)}&view=sessions`,
    );
    expect(r.sessions.every((s: { date: string }) => s.date <= wk(10))).toBe(true);
    expect(r.period.to).toBe(wk(10));
  });
  it('dominio amplio de la curva a pedido; validaciones', async () => {
    const a = await get(
      `/api/athletes/${ids['A']}/core?from=${LAB_DEFAULT_START}&to=${wk(4)}&cutoff=${wk(4)}&domain=amplio&view=weeks`,
    );
    expect(a.domain).toBe('amplio');
    expect(await status(`/api/athletes/${ids['A']}/core?from=2026-02-01&to=2026-01-01`)).toBe(400);
    expect(await status(`/api/athletes/${ids['A']}/core?to=2026-01-01`)).toBe(400);
    expect(await status(`/api/athletes/nope/core?from=2026-01-01&to=2026-02-01`)).toBe(404);
  });
  it('es de solo lectura y no depende del estado de evaluación', async () => {
    const before = await get(`/api/athletes/${ids['C']}/state`);
    await get(`/api/athletes/${ids['C']}/core?from=${LAB_DEFAULT_START}&to=${wk(12)}&cutoff=${wk(12)}`);
    expect(await get(`/api/athletes/${ids['C']}/state`)).toEqual(before);
  });
});

describe('GET /tables/*', () => {
  it('índice con versiones y todas las tablas responden', async () => {
    const idx = await get('/api/tables');
    expect(idx.versions.rpe).toBe('rts-curva-default-v1');
    expect(idx.tables.length).toBeGreaterThanOrEqual(9);
    const rpe = await get('/api/tables/rpe');
    expect(rpe.rows).toHaveLength(50);
    expect(rpe.stats.available).toBe(860);
    expect(rpe.legacyTable.divergent).toBe(107);
    expect((await get('/api/tables/rm')).rows).toHaveLength(50);
    expect((await get('/api/tables/rm/inverse?pct=81.1')).reps).toBeCloseTo(7, 4);
    const load = await get('/api/tables/load?e1rm=200&stepKg=2.5');
    expect(load.kg[4][load.rpes.indexOf(8)]).toBe(160);
    expect((await get('/api/tables/formulas')).rows).toHaveLength(36);
    expect((await get('/api/tables/prg-rpe')).divergentCells).toBe(38);
    expect((await get('/api/tables/si/rts')).validation.measuredCells).toBe(170);
    expect((await get('/api/tables/si/efort')).xlPerKg).toHaveLength(50);
    expect((await get('/api/tables/si/efort-curve')).rows[0].pct).toBe(100);
    const prg = await get('/api/tables/si/prg?pctFrom=50&pctTo=100&pctStep=25&repsMax=3');
    expect(prg.pcts).toEqual([50, 75, 100]);
    expect(prg.si[0]).toHaveLength(3);
  });
  it('validaciones', async () => {
    expect(await status('/api/tables/load')).toBe(400);
    expect(await status('/api/tables/load?e1rm=-5')).toBe(400);
    expect(await status('/api/tables/rm/inverse?pct=0')).toBe(400);
  });
});

describe('Fatiga entre series con la prescripción (rango de repeticiones y RPE objetivo) y patrones', () => {
  it('3×8-10 con carga fija (10-10-8) y 3×3@7 (6-7-7): cada serie contra lo previsto y contra las demás', async () => {
    const k = { value: '2026-03-02' };
    const c2 = buildContext({ ...loadConfig({}), dbPath: ':memory:' }, openDb(':memory:'), () => k.value);
    const app2 = await buildApp(c2);
    const send = (method: 'POST' | 'GET', url: string, payload?: unknown) =>
      app2.inject({ method, url, payload: payload as object });
    const id = (await send('POST', '/api/athletes', { name: 'LAB-X · fatiga (ficticio)' })).json()
      .id as string;
    const mk = (
      session: string,
      n: number,
      ex: string,
      lift: string | null,
      reps: number,
      rpe: number | null,
      kg: number,
      protocol: unknown,
    ) => ({
      id: `${session}-${n}`,
      sessionKey: session,
      slotKey: 's|D1',
      exerciseName: ex,
      lift,
      plannedDate: '2026-03-02',
      setNo: n,
      reps,
      targetRpe: rpe,
      plannedKg: kg,
      blockKey: 'X1',
      weekNo: 1,
      dayNo: 1,
      familyKey: 'X',
      refKg: 150,
      exposureId: ex.toLowerCase().replace(/\W+/g, '-'),
      variantKey: ex,
      protocol,
    });
    const rangeProto = { loadMode: 'kg', segment: 'work', repsMax: 10 };
    const sets = [
      ...[1, 2, 3].map((n) => mk('s1', n, 'Leg Press (Machine)', null, 8, null, 200, rangeProto)),
      ...[1, 2, 3].map((n) => mk('s2', n, 'Squat comp', 'SQ', 3, 7, 140, null)),
    ];
    expect((await send('POST', `/api/athletes/${id}/plan`, { sets, status: 'aplicado' })).statusCode).toBe(
      200,
    );
    const done = (plannedSetId: string, kg: number, reps: number, rpe: number | null) => ({
      plannedSetId,
      status: 'done',
      kg,
      reps,
      rpe,
      performedOn: '2026-03-02',
      pain: null,
    });
    await send('POST', `/api/athletes/${id}/sets`, {
      sets: [
        done('s1-1', 200, 10, null),
        done('s1-2', 200, 10, null),
        done('s1-3', 200, 8, null),
        done('s2-1', 140, 3, 6),
        done('s2-2', 140, 3, 7),
        done('s2-3', 140, 3, 7),
      ],
    });
    const r = (
      await send('GET', `/api/athletes/${id}/core?from=2026-03-01&to=2026-03-08&cutoff=2026-03-08`)
    ).json();
    const ex = (name: string) =>
      r.sessions
        .flatMap((s: { exercises: { exerciseName: string }[] }) => s.exercises)
        .find((e: { exerciseName: string }) => e.exerciseName === name);
    const lp = ex('Leg Press (Machine)').fatigueBetweenSets;
    expect(lp.reps).toMatchObject({
      values: [10, 10, 8],
      pattern: 'descendente',
      constantLoad: true,
      lostBestToLast: 2,
      target: { reps: 8, repsMax: 10 },
      vsTarget: { within: 3, above: 0, below: 0 },
    });
    expect(lp.sets.map((x: { repsVsPrevious: number | null }) => x.repsVsPrevious)).toEqual([null, 0, -2]);
    const sq = ex('Squat comp').fatigueBetweenSets;
    expect(sq.sets.map((x: { rpeVsTarget: number }) => x.rpeVsTarget)).toEqual([-1, 0, 0]);
    expect(sq.rpe).toMatchObject({
      values: [6, 7, 7],
      pattern: 'ascendente',
      vsTarget: { below: 1, at: 2, above: 0 },
    });
    // patrones: leg press y sentadilla caen en el mismo patrón; suman
    expect(r.patterns.rows).toEqual([
      expect.objectContaining({ pattern: 'sentadilla', sets: 6, nl: 28 + 9 }),
    ]);
    expect(r.totals.nl.value).toBe(37);
  });
  it('tablas de convención muscular: grupos, patrones y consulta por ejercicio', async () => {
    const t = await get('/api/tables/muscles');
    expect(t.muscles.groups).toHaveLength(17);
    expect(t.patterns.patterns).toHaveLength(12);
    const l = await get('/api/tables/muscles/lookup?exercise=Lat%20Pulldown%20(Cable)');
    expect(l).toMatchObject({ mapped: true, pattern: 'traccion_vertical' });
    expect(l.muscles.find((m: { group: string }) => m.group === 'dorsales').kind).toBe('directo');
    expect((await get('/api/tables/muscles/lookup?exercise=Cosa%20Rara%20XYZ')).mapped).toBe(false);
  });
});
