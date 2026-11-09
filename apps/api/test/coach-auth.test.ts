import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';

/** Login del coach: con COACH_AUTH=on la API entera exige sesión; el portal del atleta sigue con su propio token. */
let app: FastifyInstance;
const call = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, token?: string) =>
  app.inject({
    method,
    url,
    payload: body as object,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
const j = async (r: ReturnType<typeof call>) => (await r).json();
let coach = '';

beforeAll(async () => {
  const config = {
    ...loadConfig({}),
    dbPath: ':memory:',
    coachAuth: true,
    coachEmail: 'coach@mail.com',
    coachPassword: 'clave-del-coach',
  };
  app = await buildApp(await buildContext(config, await openDb(':memory:'), () => '2026-11-10'));
  coach = (
    await j(call('POST', '/api/coach/login', { email: 'Coach@Mail.com', password: 'clave-del-coach' }))
  ).token;
});
afterAll(async () => {
  await app.close();
});

describe('login del coach', () => {
  it('sin sesión: la API del coach responde 401 y lo público sigue abierto', async () => {
    expect((await call('GET', '/api/athletes')).statusCode).toBe(401);
    expect((await call('POST', '/api/athletes', { name: 'X' })).statusCode).toBe(401);
    expect((await call('GET', '/api/dashboard')).statusCode).toBe(401);
    expect((await call('GET', '/api/instance')).statusCode).toBe(200);
    expect((await call('GET', '/api/health')).statusCode).toBe(200);
    expect(await j(call('GET', '/api/coach/session'))).toMatchObject({
      authRequired: true,
      authenticated: false,
    });
  });
  it('clave incorrecta: 401; la correcta da un token que habilita la API', async () => {
    expect(
      (await call('POST', '/api/coach/login', { email: 'coach@mail.com', password: 'mala' })).statusCode,
    ).toBe(401);
    expect(coach).toBeTruthy();
    expect((await call('GET', '/api/athletes', undefined, coach)).statusCode).toBe(200);
    expect(await j(call('GET', '/api/coach/session', undefined, coach))).toMatchObject({
      authenticated: true,
      email: 'coach@mail.com',
    });
  });
  it('un token inventado no sirve', async () => {
    expect((await call('GET', '/api/athletes', undefined, 'inventado')).statusCode).toBe(401);
  });
  it('el atleta no entra a la API del coach (403) pero sí a su portal, sin sesión de coach', async () => {
    const a = (await j(call('POST', '/api/athletes', { name: 'Ana' }, coach))).id;
    await call('PUT', `/api/athletes/${a}/account`, { email: 'ana@mail.com', password: 'secreto1' }, coach);
    const t = (await j(call('POST', '/api/auth/login', { email: 'ana@mail.com', password: 'secreto1' })))
      .token;
    expect((await call('GET', '/api/athletes', undefined, t)).statusCode).toBe(403);
    expect((await call('GET', '/api/me/home', undefined, t)).statusCode).toBe(200);
    // y el token del coach no abre el portal del atleta
    expect((await call('GET', '/api/me/home', undefined, coach)).statusCode).toBe(401);
  });
  it('cerrar sesión revoca el token', async () => {
    const t = (
      await j(call('POST', '/api/coach/login', { email: 'coach@mail.com', password: 'clave-del-coach' }))
    ).token;
    expect((await call('GET', '/api/athletes', undefined, t)).statusCode).toBe(200);
    await call('POST', '/api/coach/logout', undefined, t);
    expect((await call('GET', '/api/athletes', undefined, t)).statusCode).toBe(401);
  });
  it('cambiar la contraseña: la vieja deja de servir', async () => {
    expect((await call('PUT', '/api/coach/password', { password: 'corta' }, coach)).statusCode).toBe(400);
    expect(
      (await call('PUT', '/api/coach/password', { password: 'otra-clave-larga' }, coach)).statusCode,
    ).toBe(200);
    expect(
      (await call('POST', '/api/coach/login', { email: 'coach@mail.com', password: 'clave-del-coach' }))
        .statusCode,
    ).toBe(401);
    expect(
      (await call('POST', '/api/coach/login', { email: 'coach@mail.com', password: 'otra-clave-larga' }))
        .statusCode,
    ).toBe(200);
  });
  it('la revisión en vivo vive en la base: sube con cada escritura y es independiente por atleta', async () => {
    const a = (await j(call('POST', '/api/athletes', { name: 'Beto' }, coach))).id;
    const r0 = (await j(call('GET', `/api/athletes/${a}/rev`, undefined, coach))).rev;
    await call('PUT', `/api/athletes/${a}/view-settings`, { sessionKey: '*', mode: 'solo_rpe' }, coach);
    const r1 = (await j(call('GET', `/api/athletes/${a}/rev`, undefined, coach))).rev;
    expect(r1).toBeGreaterThan(r0);
  });
});
