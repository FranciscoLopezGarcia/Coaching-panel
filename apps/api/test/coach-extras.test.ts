import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { LAB_DEFAULT_START, createLab } from '../src/seed/lab.js';

let app: FastifyInstance;
let id: string;
type M = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const call = async (method: M, url: string, payload?: unknown) =>
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

describe('Perfil ampliado', () => {
  it('sin perfil devuelve vacíos (no ceros) y guarda/lee lo cargado', async () => {
    const v = (await call('GET', `/api/athletes/${id}/profile`)).json();
    expect(v.bodyweightKg).toBeNull();
    expect(v.updatedAt).toBeNull();
    const put = await call('PUT', `/api/athletes/${id}/profile`, {
      sex: 'F',
      bodyweightKg: 63.5,
      weightClass: '63',
      federation: 'IPF',
      equipment: 'raw',
      daysPerWeek: 4,
      goals: 'Nacional',
    });
    expect(put.statusCode).toBe(200);
    const w = (await call('GET', `/api/athletes/${id}/profile`)).json();
    expect(w).toMatchObject({
      sex: 'F',
      bodyweightKg: 63.5,
      federation: 'IPF',
      daysPerWeek: 4,
      birthDate: null,
    });
  });
  it('rechaza valores imposibles', async () => {
    expect((await call('PUT', `/api/athletes/${id}/profile`, { bodyweightKg: 5 })).statusCode).toBe(400);
    expect((await call('PUT', `/api/athletes/${id}/profile`, { daysPerWeek: 9 })).statusCode).toBe(400);
  });
});

describe('Competencias, intentos y marcas', () => {
  let comp: string;
  it('alta, edición parcial sin pisar el resto, y listado con días restantes', async () => {
    const c = await call('POST', `/api/athletes/${id}/competitions`, {
      name: 'Regional',
      date: '2026-12-20',
      phase: 'pico',
      location: 'Córdoba',
      importance: 'A',
    });
    expect(c.statusCode).toBe(201);
    comp = c.json().id;
    expect(
      (await call('PATCH', `/api/athletes/${id}/competitions/${comp}`, { weightClass: '63' })).statusCode,
    ).toBe(200);
    const list = (await call('GET', `/api/athletes/${id}/competitions-detail`)).json();
    const r = list.find((x: { id: string }) => x.id === comp);
    expect(r).toMatchObject({ location: 'Córdoba', weightClass: '63', importance: 'A', daysLeft: 42 });
    expect(r.total).toBeNull();
  });
  it('intentos: el resultado solo existe si hubo intento realizado; total solo con un válido por movimiento', async () => {
    const put = await call('PUT', `/api/athletes/${id}/competitions/${comp}/attempts`, {
      attempts: [
        { lift: 'SQ', attemptNo: 1, plannedKg: 150, actualKg: 150, result: 'valido' },
        { lift: 'SQ', attemptNo: 2, plannedKg: 160, actualKg: 162.5, result: 'nulo' },
        { lift: 'SQ', attemptNo: 3, plannedKg: 165, actualKg: null, result: 'valido' }, // sin intento realizado: se descarta el resultado
        { lift: 'BP', attemptNo: 1, plannedKg: 90, actualKg: 90, result: 'valido' },
      ],
    });
    expect(put.statusCode).toBe(200);
    const r = (await call('GET', `/api/athletes/${id}/competitions-detail`))
      .json()
      .find((x: { id: string }) => x.id === comp);
    expect(r.best).toEqual({ SQ: 150, BP: 90 });
    expect(r.total).toBeNull(); // falta DL: faltante ≠ cero
    expect(
      r.attempts.find((a: { lift: string; attemptNo: number }) => a.lift === 'SQ' && a.attemptNo === 3)
        .result,
    ).toBeNull();
    await call('PUT', `/api/athletes/${id}/competitions/${comp}/attempts`, {
      attempts: [
        { lift: 'SQ', attemptNo: 1, plannedKg: 150, actualKg: 150, result: 'valido' },
        { lift: 'BP', attemptNo: 1, plannedKg: 90, actualKg: 90, result: 'valido' },
        { lift: 'DL', attemptNo: 1, plannedKg: 180, actualKg: 182.5, result: 'valido' },
      ],
    });
    const t = (await call('GET', `/api/athletes/${id}/competitions-detail`))
      .json()
      .find((x: { id: string }) => x.id === comp);
    expect(t.total).toBe(150 + 90 + 182.5);
  });
  it('intentos repetidos se rechazan', async () => {
    const r = await call('PUT', `/api/athletes/${id}/competitions/${comp}/attempts`, {
      attempts: [
        { lift: 'SQ', attemptNo: 1, plannedKg: 100, actualKg: null, result: null },
        { lift: 'SQ', attemptNo: 1, plannedKg: 110, actualKg: null, result: null },
      ],
    });
    expect(r.statusCode).toBe(422);
  });
  it('marcas: competencia y entrenamiento lado a lado, sin mezclarlas', async () => {
    const m = (await call('GET', `/api/athletes/${id}/marks`)).json();
    const sq = m.find((x: { lift: string }) => x.lift === 'SQ');
    expect(sq.competition).toMatchObject({ kg: 150, competition: 'Regional' });
    expect(sq.trainingHeaviest === null || sq.trainingHeaviest.kg > 0).toBe(true);
    if (sq.trainingSingle && sq.competition) expect(sq.diffKg).toBeCloseTo(150 - sq.trainingSingle.kg);
    else expect(sq.diffKg).toBeNull();
  });
  it('borrar una competencia borra sus intentos', async () => {
    expect((await call('DELETE', `/api/athletes/${id}/competitions/${comp}`)).statusCode).toBe(200);
    const list = (await call('GET', `/api/athletes/${id}/competitions-detail`)).json();
    expect(list.some((x: { id: string }) => x.id === comp)).toBe(false);
    expect((await call('DELETE', `/api/athletes/${id}/competitions/${comp}`)).statusCode).toBe(404);
  });
});

describe('Panel hoy / semana', () => {
  it('lista las sesiones de la semana con su estado', async () => {
    const a = (await call('GET', `/api/athletes/${id}/agenda?date=2026-06-03`)).json();
    expect(a.week).toEqual({ from: '2026-06-01', to: '2026-06-07' });
    expect(a.sessions.length).toBeGreaterThan(0);
    for (const s of a.sessions) {
      expect(['hecha', 'parcial', 'sin_registro', 'pendiente']).toContain(s.status);
      expect(s.date >= a.week.from && s.date <= a.week.to).toBe(true);
      expect(s.setsDone).toBeLessThanOrEqual(s.setsPlanned);
    }
  });
});

describe('Panel de todos los atletas', () => {
  it('devuelve una fila por atleta con su semana', async () => {
    const r = (await call('GET', '/api/today?date=2026-06-03')).json();
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]).toHaveProperty('athleteName');
    expect(r[0].week.from).toBe('2026-06-01');
  });
});

describe('Biblioteca de ejercicios', () => {
  it('trae la fija con músculos y patrón, y un ejercicio propio aporta sus músculos al análisis', async () => {
    const lib0 = (await call('GET', '/api/exercise-library')).json();
    const fija = lib0.find((e: { name: string }) => e.name === 'Sentadilla competencia');
    expect(fija.origin).toBe('fija');
    expect(fija.muscles.length).toBeGreaterThan(0);
    const c = await call('POST', '/api/exercise-library', {
      name: 'Press Larsen raro',
      lift: 'BP',
      muscles: { direct: ['pectoral'], indirect: ['triceps'] },
    });
    expect(c.statusCode).toBe(201);
    expect((await call('POST', '/api/exercise-library', { name: 'Press Larsen raro' })).statusCode).toBe(422);
    const lib = (await call('GET', '/api/exercise-library')).json();
    const mio = lib.find((e: { name: string }) => e.name === 'Press Larsen raro');
    expect(mio.origin).toBe('propia');
    expect(mio.muscles.map((m: { group: string; kind: string }) => `${m.group}:${m.kind}`)).toEqual([
      'pectoral:directo',
      'triceps:indirecto',
    ]);
    expect((await call('DELETE', `/api/exercise-library/${c.json().id}`)).statusCode).toBe(200);
  });
});

describe('Plantilla de bloque y cumplimiento', () => {
  it('guarda un bloque entero como plantilla y la lista como tipo «bloque»', async () => {
    const blocks = (await call('GET', `/api/athletes/${id}/blocks`)).json();
    const blockKey = blocks.blocks[0].blockKey;
    const s = await call('POST', `/api/athletes/${id}/block-templates`, { name: 'Mi bloque', blockKey });
    expect(s.statusCode).toBe(201);
    const l = (await call('GET', `/api/athletes/${id}/templates`)).json();
    const t = l.find((x: { name: string }) => x.name === 'Mi bloque');
    expect(t.kind).toBe('bloque');
    expect(t.weeks).toBeGreaterThan(0);
    const prev = await call('POST', `/api/athletes/${id}/program`, {
      mode: 'preview',
      op: { type: 'apply_block_template', templateId: t.id, blockKey: 'NUEVO', startDate: '2027-03-01' },
    });
    expect(prev.statusCode).toBe(200);
    // una plantilla de bloque no se aplica como si fuera de una semana
    const mal = await call('POST', `/api/athletes/${id}/program`, {
      mode: 'preview',
      op: { type: 'apply_template', templateId: t.id, blockKey: 'NUEVO', weekNo: 1, startDate: '2027-03-01' },
    });
    expect(mal.statusCode).toBe(422);
  });
  it('el análisis trae el cumplimiento por bloque y por semana', async () => {
    const a = (await call('GET', `/api/athletes/${id}/block-analysis?source=actual`)).json();
    expect(a.compliance).toHaveLength(a.window.blocks.length);
    const c = a.compliance[0];
    expect(c.total.setsPlanned).toBe(c.total.setsDone + c.total.setsSkipped + c.total.setsUnknown);
    expect(c.weeks.length).toBeGreaterThan(0);
  });
});

describe('Acceso', () => {
  it('con login de coach activo, las rutas nuevas exigen sesión (sin token → 401)', async () => {
    const ctx = await buildContext(
      { ...loadConfig({}), dbPath: ':memory:', coachAuth: true },
      await openDb(':memory:'),
      () => '2026-11-08',
    );
    const guarded = await buildApp(ctx);
    for (const url of [
      '/api/exercise-library',
      '/api/today',
      '/api/athletes/x/profile',
      '/api/athletes/x/marks',
    ])
      expect((await guarded.inject({ method: 'GET', url })).statusCode).toBe(401);
  });
});
