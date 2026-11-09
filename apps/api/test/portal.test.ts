import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';

/** Portal del atleta: cuentas, aislamiento, modos de vista, registro de series y TRAC. BD en memoria, hoy = 2026-11-10. */
let app: FastifyInstance;
let a1: string;
let a2: string;
const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, token?: string) =>
  app.inject({
    method,
    url,
    payload: body as object,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
const j = async (r: ReturnType<typeof call>) => (await r).json();

const set = (
  id: string,
  session: string,
  name: string,
  no: number,
  date: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  sessionKey: session,
  slotKey: `b:w1:d1:${name}`,
  exposureId: name,
  exerciseName: name,
  lift: name.startsWith('Squat') ? 'SQ' : null,
  plannedDate: date,
  setNo: no,
  reps: 5,
  targetRpe: 8,
  plannedKg: 100,
  refKg: 140,
  isWarmup: false,
  blockKey: 'b1',
  weekNo: 1,
  dayNo: 1,
  priority: 1,
  protocol: null,
  ...extra,
});

beforeAll(async () => {
  const ctx = buildContext({ ...loadConfig({}), dbPath: ':memory:' }, openDb(':memory:'), () => '2026-11-10');
  app = await buildApp(ctx);
  a1 = (await j(call('POST', '/api/athletes', { name: 'Ana' }))).id;
  a2 = (await j(call('POST', '/api/athletes', { name: 'Beto' }))).id;
  await call('POST', `/api/athletes/${a1}/plan`, {
    sets: [
      set('w1', 's-hoy', 'Squat comp', 1, '2026-11-10', { plannedKg: 60, isWarmup: true, targetRpe: null }),
      set('t1', 's-hoy', 'Squat comp', 2, '2026-11-10', {
        protocol: {
          loadMode: 'kg',
          segment: 'top',
          pct: null,
          capKg: null,
          tempo: null,
          pauseSec: null,
          instructions: null,
        },
      }),
      set('b1', 's-hoy', 'Squat comp', 3, '2026-11-10', { plannedKg: 90 }),
      set('x1', 's-sig', 'Bench comp', 1, '2026-11-12', { weekNo: 1, dayNo: 3 }),
    ],
    status: 'aplicado',
  });
  await call('POST', `/api/athletes/${a2}/plan`, {
    sets: [set('o1', 's-otro', 'Deadlift comp', 1, '2026-11-10')],
    status: 'aplicado',
  });
  await call('PUT', `/api/athletes/${a1}/account`, { email: 'Ana@Mail.com', password: 'secreto1' });
  await call('PUT', `/api/athletes/${a2}/account`, { email: 'beto@mail.com', password: 'otraclave' });
});

const login = async (email: string, password: string) =>
  j(call('POST', '/api/auth/login', { email, password }));

describe('cuenta y acceso', () => {
  it('el coach asigna email y contraseña; el atleta entra (el email no distingue mayúsculas) y la contraseña se guarda con hash', async () => {
    const r = await login('ana@mail.com', 'secreto1');
    expect(r.token).toBeTruthy();
    expect(r.athlete.name).toBe('Ana');
    const acc = await j(call('GET', `/api/athletes/${a1}/account`));
    expect(acc.account.email).toBe('ana@mail.com');
    expect(JSON.stringify(acc)).not.toContain('secreto1');
  });
  it('contraseña incorrecta o email inexistente: 401; un email no puede repetirse entre atletas', async () => {
    expect(
      (await call('POST', '/api/auth/login', { email: 'ana@mail.com', password: 'mala' })).statusCode,
    ).toBe(401);
    expect(
      (await call('POST', '/api/auth/login', { email: 'nadie@mail.com', password: 'secreto1' })).statusCode,
    ).toBe(401);
    expect(
      (await call('PUT', `/api/athletes/${a2}/account`, { email: 'ana@mail.com', password: 'otraclave' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call('PUT', `/api/athletes/${a2}/account`, { email: 'x@mail.com', password: '123' })).statusCode,
    ).toBe(400);
  });
  it('sin token no hay portal; con token solo se ve el propio atleta; el coach API se rechaza con token de atleta', async () => {
    expect((await call('GET', '/api/me/home')).statusCode).toBe(401);
    const { token } = await login('ana@mail.com', 'secreto1');
    expect((await call('GET', '/api/me/sessions/s-otro', undefined, token)).statusCode).toBe(404);
    expect((await call('GET', '/api/athletes', undefined, token)).statusCode).toBe(403);
    expect(
      (
        await call(
          'PUT',
          '/api/me/sets',
          { plannedSetId: 'o1', status: 'done', kg: 100, reps: 5, rpe: 8 },
          token,
        )
      ).statusCode,
    ).toBe(422);
  });
  it('cambiar la contraseña cierra las sesiones abiertas', async () => {
    const { token } = await login('beto@mail.com', 'otraclave');
    expect((await call('GET', '/api/me/home', undefined, token)).statusCode).toBe(200);
    await call('PUT', `/api/athletes/${a2}/account`, { email: 'beto@mail.com', password: 'nuevaclave' });
    expect((await call('GET', '/api/me/home', undefined, token)).statusCode).toBe(401);
  });
});

describe('home, selector y siguiente', () => {
  it('home: la sesión de hoy, el bloque y el TRAC', async () => {
    const { token } = await login('ana@mail.com', 'secreto1');
    const h = await j(call('GET', '/api/me/home', undefined, token));
    expect(h.session.key).toBe('s-hoy');
    expect(h.block).toMatchObject({ key: 'b1', weeks: 1 });
    expect(h.next.key).toBe('s-hoy');
    expect(h.trac.doneToday).toBe(false);
    const p = await j(call('GET', '/api/me/plan', undefined, token));
    expect(p.blocks[0].weeksList[0].sessions.map((s: { key: string }) => s.key)).toEqual(['s-hoy', 's-sig']);
  });
  it('registrar una serie la deja hecha y el siguiente entreno avanza', async () => {
    const { token } = await login('ana@mail.com', 'secreto1');
    for (const id of ['w1', 't1', 'b1'])
      expect(
        (
          await call(
            'PUT',
            '/api/me/sets',
            { plannedSetId: id, status: 'done', kg: 100, reps: 5, rpe: 8 },
            token,
          )
        ).statusCode,
      ).toBe(200);
    const n = await j(call('GET', '/api/me/next', undefined, token));
    expect(n.next.key).toBe('s-sig');
    const s = await j(call('GET', '/api/me/sessions/s-hoy', undefined, token));
    expect(s.status).toBe('done');
    expect(s.exercises[0].sets.map((x: { kind: string }) => x.kind)).toEqual(['warmup', 'top', 'work']);
  });
  it('TRAC: el atleta lo carga y queda como hecho hoy', async () => {
    const { token } = await login('ana@mail.com', 'secreto1');
    expect(
      (
        await call(
          'POST',
          '/api/me/checkins',
          { sleep: 7, energy: 6, motivation: 8, stress: 4, pain: 1 },
          token,
        )
      ).statusCode,
    ).toBe(200);
    const h = await j(call('GET', '/api/me/home', undefined, token));
    expect(h.trac.doneToday).toBe(true);
    expect(h.trac.today.sleep).toBe(7);
  });
});

describe('qué ve el atleta de cada serie', () => {
  const view = async (mode: string | null) => {
    await call('PUT', `/api/athletes/${a1}/view-settings`, { sessionKey: 's-hoy', mode });
    const { token } = await login('ana@mail.com', 'secreto1');
    return (await j(call('GET', '/api/me/sessions/s-hoy', undefined, token))).exercises[0].sets[2];
  };
  it('completo: carga, RPE y % del RM', async () => {
    expect(await view('completo')).toMatchObject({ kg: 90, rpe: 8, pct: 64.3 });
  });
  it('solo RPE: no llega ni la carga ni el porcentaje (el servidor los quita)', async () => {
    const s = await view('solo_rpe');
    expect(s).toMatchObject({ kg: null, pct: null, rpe: 8 });
  });
  it('solo carga: sin RPE', async () => {
    expect(await view('solo_carga')).toMatchObject({ kg: 90, rpe: null, pct: null });
  });
  it('RPE y %: sin kg', async () => {
    expect(await view('rpe_porcentaje')).toMatchObject({ kg: null, rpe: 8, pct: 64.3 });
  });
});

describe('qué ve el atleta por ejercicio y sincronización en vivo', () => {
  const proto = (extra: Record<string, unknown>) => ({
    loadMode: 'kg',
    segment: 'work',
    pct: null,
    capKg: null,
    tempo: null,
    pauseSec: null,
    instructions: null,
    ...extra,
  });
  const tok = async () => (await login('ana@mail.com', 'secreto1')).token;

  it('el ajuste por ejercicio (protocolo) manda sobre el de la sesión; el otro ejercicio no cambia', async () => {
    await call('POST', `/api/athletes/${a1}/plan`, {
      sets: [
        set('v1', 's-mix', 'Squat comp', 1, '2026-11-11', {
          protocol: proto({ athleteView: 'solo_rpe', pauseSec: 180 }),
        }),
        set('v2', 's-mix', 'Bench comp', 1, '2026-11-11', {
          protocol: proto({ athleteView: 'completo', pauseSec: 120 }),
        }),
        set('v3', 's-mix', 'Remo', 1, '2026-11-11'),
      ],
      status: 'aplicado',
    });
    await call('PUT', `/api/athletes/${a1}/view-settings`, { sessionKey: 's-mix', mode: 'solo_carga' });
    const t = await tok();
    const s = await j(call('GET', '/api/me/sessions/s-mix', undefined, t));
    const by = (n: string) => s.exercises.find((e: { name: string }) => e.name === n);
    expect(by('Squat comp').mode).toBe('solo_rpe');
    expect(by('Squat comp').sets[0]).toMatchObject({ kg: null, pct: null, rpe: 8, pauseSec: 180 });
    expect(by('Bench comp').sets[0]).toMatchObject({ kg: 100, rpe: 8, pauseSec: 120 });
    expect(by('Remo').sets[0]).toMatchObject({ kg: 100, rpe: null }); // sesión: solo carga
  });

  it('valor por movimiento del atleta (*lift:SQ) cuando el ejercicio no define nada', async () => {
    await call('PUT', `/api/athletes/${a1}/view-settings`, { sessionKey: 's-mix', mode: null });
    await call('PUT', `/api/athletes/${a1}/view-settings`, {
      sessionKey: '*lift:SQ',
      mode: 'rpe_porcentaje',
    });
    await call('POST', `/api/athletes/${a1}/plan`, {
      sets: [set('l1', 's-lift', 'Squat tempo', 1, '2026-11-13', { lift: 'SQ' })],
      status: 'aplicado',
    });
    const s = await j(call('GET', '/api/me/sessions/s-lift', undefined, await tok()));
    expect(s.exercises[0].sets[0]).toMatchObject({ kg: null, rpe: 8 });
    await call('PUT', `/api/athletes/${a1}/view-settings`, { sessionKey: '*lift:SQ', mode: null });
  });

  it('cada escritura sube la revisión del atleta; las lecturas no', async () => {
    const t = await tok();
    const r0 = (await j(call('GET', '/api/me/rev', undefined, t))).rev;
    expect((await j(call('GET', '/api/me/rev', undefined, t))).rev).toBe(r0);
    await call('PUT', `/api/athletes/${a1}/view-settings`, { sessionKey: 's-hoy', mode: 'solo_rpe' });
    const r1 = (await j(call('GET', '/api/me/rev', undefined, t))).rev;
    expect(r1).toBeGreaterThan(r0);
    await call('PUT', '/api/me/sets', { plannedSetId: 'b1', status: 'done', kg: 90, reps: 5, rpe: 8 }, t);
    const r2 = (await j(call('GET', '/api/me/rev', undefined, t))).rev;
    expect(r2).toBeGreaterThan(r1);
    // otro atleta no mueve la revisión de Ana
    await call('PUT', `/api/athletes/${a2}/view-settings`, { sessionKey: '*', mode: 'solo_rpe' });
    expect((await j(call('GET', '/api/me/rev', undefined, t))).rev).toBe(r2);
    // un error no sube la revisión
    await call('PUT', '/api/me/sets', { plannedSetId: 'nada', status: 'done', kg: 90, reps: 5, rpe: 8 }, t);
    expect((await j(call('GET', '/api/me/rev', undefined, t))).rev).toBe(r2);
  });

  it('SSE real: el atleta recibe el aviso en milisegundos cuando el coach cambia algo', async () => {
    const url = await app.listen({ port: 0, host: '127.0.0.1' });
    const t = await tok();
    const ctrl = new AbortController();
    const res = await fetch(`${url}/api/me/events`, {
      headers: { authorization: `Bearer ${t}` },
      signal: ctrl.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const until = async (pred: () => boolean) => {
      const t0 = Date.now();
      while (!pred()) {
        if (Date.now() - t0 > 3000) throw new Error('sin aviso: ' + buf);
        buf += dec.decode((await reader.read()).value);
      }
    };
    await until(() => buf.includes('event: rev')); // revisión inicial
    const n0 = (buf.match(/event: rev/g) ?? []).length;
    const t0 = Date.now();
    await fetch(`${url}/api/athletes/${a1}/view-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionKey: 's-hoy', mode: 'completo' }),
    });
    await until(() => (buf.match(/event: rev/g) ?? []).length > n0);
    expect(Date.now() - t0).toBeLessThan(1000);
    ctrl.abort();
  });
});

describe('notas y progresión sugerida', () => {
  const tok = async () => (await login('ana@mail.com', 'secreto1')).token;
  const proto = (extra: Record<string, unknown>) => ({
    loadMode: 'kg',
    segment: 'work',
    pct: null,
    capKg: null,
    tempo: null,
    pauseSec: null,
    instructions: null,
    ...extra,
  });
  const acc = (id: string, sk: string, no: number, date: string, extra: Record<string, unknown> = {}) =>
    set(id, sk, 'Remo', no, date, {
      plannedKg: 50,
      reps: 8,
      targetRpe: 8,
      weekNo: 2,
      priority: 3,
      protocol: proto({ repsMax: 10, ...extra }),
    });
  beforeAll(async () => {
    await call('POST', `/api/athletes/${a1}/plan`, {
      sets: [
        acc('r1', 's-rem1', 1, '2026-11-03'),
        acc('r2', 's-rem1', 2, '2026-11-03'),
        acc('r3', 's-rem1', 3, '2026-11-03'),
        ...[1, 2, 3].map((n) =>
          acc(`q${n}`, 's-rem2', n, '2026-11-17', {
            athleteProgression: 'reps_kg',
            instructions: 'Controlá la bajada',
          }),
        ),
      ],
      status: 'aplicado',
    });
    const t = await tok();
    // en el entreno anterior: 10, 8 y 8 reps a 50 kg
    for (const [id, reps, rpe] of [
      ['r1', 10, 8],
      ['r2', 8, 8.5],
      ['r3', 8, 9],
    ] as const)
      await call('PUT', '/api/me/sets', { plannedSetId: id, status: 'done', kg: 50, reps, rpe }, t);
  });
  it('el coach ve la sugerencia completa: 9 reps con la misma carga, 1RM y fatiga', async () => {
    const r = await j(call('GET', `/api/athletes/${a1}/progression?sessionKey=s-rem2`));
    const s = r.items[0].suggestion;
    expect(s.action).toBe('subir_reps');
    expect(s.sets[0]).toEqual({ reps: 9, kg: 50 });
    expect(s.fatigueDrop).toBe(2);
    expect(s.e1rm).toBeGreaterThan(50);
  });
  it('el atleta la ve solo si el coach la habilitó, con la meta en cada serie', async () => {
    const s = await j(call('GET', '/api/me/sessions/s-rem2', undefined, await tok()));
    const ex = s.exercises[0];
    expect(ex.goalText).toContain('9 reps');
    expect(ex.goalText).toContain('50 kg');
    expect(ex.sets[0].goal).toEqual({ reps: 9, kg: 50 });
    expect(ex.coachNotes).toEqual(['Controlá la bajada']);
  });
  it('si el coach no la habilita (o la vista oculta el kg), el atleta no recibe esos números', async () => {
    await call('POST', `/api/athletes/${a1}/plan`, {
      sets: [1, 2, 3].map((n) => acc(`q${n}`, 's-rem2', n, '2026-11-17', { athleteProgression: null })),
      status: 'aplicado',
    });
    let ex = (await j(call('GET', '/api/me/sessions/s-rem2', undefined, await tok()))).exercises[0];
    expect(ex.goalText).toBe('');
    expect(ex.sets[0].goal).toBeNull();
    await call('POST', `/api/athletes/${a1}/plan`, {
      sets: [1, 2, 3].map((n) =>
        acc(`q${n}`, 's-rem2', n, '2026-11-17', { athleteProgression: 'reps_kg', athleteView: 'solo_rpe' }),
      ),
      status: 'aplicado',
    });
    ex = (await j(call('GET', '/api/me/sessions/s-rem2', undefined, await tok()))).exercises[0];
    expect(ex.sets[0].goal).toEqual({ reps: 9, kg: null });
    expect(ex.goalText).not.toContain('kg');
  });
  it('nota del atleta debajo del ejercicio: la guarda, la ve el coach y borrar la deja vacía', async () => {
    const t = await tok();
    expect(
      (
        await call(
          'PUT',
          '/api/me/notes',
          { sessionKey: 's-rem2', exerciseName: 'Remo', note: 'Me molestó el codo' },
          t,
        )
      ).statusCode,
    ).toBe(200);
    expect((await j(call('GET', '/api/me/sessions/s-rem2', undefined, t))).exercises[0].athleteNote).toBe(
      'Me molestó el codo',
    );
    const n = await j(call('GET', `/api/athletes/${a1}/notes?sessionKey=s-rem2`));
    expect(n.notes[0]).toMatchObject({ exerciseName: 'Remo', note: 'Me molestó el codo' });
    await call('PUT', '/api/me/notes', { sessionKey: 's-rem2', exerciseName: 'Remo', note: '' }, t);
    expect((await j(call('GET', `/api/athletes/${a1}/notes`))).notes).toEqual([]);
    expect(
      (await call('PUT', '/api/me/notes', { sessionKey: 'nada', exerciseName: 'Remo', note: 'x' }, t))
        .statusCode,
    ).toBe(404);
  });
});

afterAll(async () => {
  await app.close();
});
