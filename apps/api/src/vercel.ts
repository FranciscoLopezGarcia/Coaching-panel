import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';

/**
 * Entrada para Vercel (función serverless). Una sola app Fastify por instancia caliente: abre la base (Turso), aplica migraciones
 * pendientes y crea el coach inicial en el arranque en frío; después atiende cada pedido sin reabrir nada.
 */
let ready: Promise<FastifyInstance> | null = null;
const getApp = () =>
  (ready ??= (async () => {
    const app = await buildApp(undefined, { logger: false });
    await app.ready();
    return app;
  })().catch((e) => {
    ready = null; // si el arranque falla (p. ej. base inaccesible), el próximo pedido reintenta
    throw e;
  }));

function fail(res: ServerResponse, code: number, error: string) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!process.env.COACHING_DB_URL && !process.env.TURSO_DATABASE_URL)
    return fail(
      res,
      503,
      'Falta configurar la base de datos (COACHING_DB_URL y COACHING_DB_TOKEN en Vercel).',
    );
  let app: FastifyInstance;
  try {
    app = await getApp();
  } catch (e) {
    console.error('Arranque de la API falló:', e);
    // nunca devolver valores de variables de entorno (p. ej. el token) en un mensaje público
    let msg = (e as Error).message;
    for (const v of [process.env.COACHING_DB_TOKEN, process.env.TURSO_AUTH_TOKEN, process.env.COACH_PASSWORD])
      if (v) msg = msg.split(v).join('***');
    msg = msg.replace(/Bearer\s+\S+/g, 'Bearer ***').replace(/eyJ[\w.-]{20,}/g, '***');
    return fail(res, 500, `La API no pudo arrancar: ${msg.slice(0, 300)}`);
  }
  app.server.emit('request', req, res);
}
