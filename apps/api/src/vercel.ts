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

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app.server.emit('request', req, res);
}
