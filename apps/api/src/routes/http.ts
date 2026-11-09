import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ConflictError, NotFoundError, UnprocessableError } from '../services/errors.js';

/** Valida un body/param con zod; lanza ZodError (400 en el manejador central). */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}

export { UnprocessableError };

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: Error, _req, reply: FastifyReply) => {
    if (err instanceof ZodError)
      return reply.code(400).send({ error: 'Datos inválidos', details: err.issues });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    if (err instanceof ConflictError)
      return reply.code(409).send({ error: err.message, details: err.details });
    if (err instanceof UnprocessableError)
      return reply.code(422).send({ error: err.message, details: err.details });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'Error interno' });
  });
}
