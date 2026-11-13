import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  changeCommentSchema,
  coachReviewSchema,
  compareQuerySchema,
  competitionSchema,
  sessionFeedbackSchema,
} from '@coaching/contracts';
import { readinessOf } from '@coaching/engine';
import type { AppContext } from '../app.js';
import { NotFoundError } from '../services/errors.js';
import { parse } from './http.js';

const idParam = z.object({ id: z.string().min(1) });
const cutoffQuery = z.object({
  cutoff: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Lecturas e historial por atleta + dashboard. Todo GET es de solo lectura. */
export function registerHistoryRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { athletes, history, historyService: hs } = ctx;
  const must = async (id: string) => {
    if (!(await athletes.get(id))) throw new NotFoundError('Atleta inexistente');
  };
  const cut = (q: unknown) => parse(cutoffQuery, q).cutoff ?? ctx.today();

  app.get('/api/dashboard', async () => await ctx.dashboard.build(ctx.today()));

  app.get('/api/athletes/:id/plan-versions', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    return await hs.versions(id);
  });
  app.get('/api/athletes/:id/history', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    return await hs.events(id, cut(req.query));
  });
  app.patch('/api/athletes/:id/history/:eventId', async (req) => {
    const { id, eventId } = parse(z.object({ id: z.string(), eventId: z.string() }), req.params);
    await must(id);
    const { coachComment } = parse(changeCommentSchema, req.body);
    if (!(await history.setEventComment(id, eventId, coachComment)))
      throw new NotFoundError('Evento inexistente');
    return { ok: true }; // el motivo es OPCIONAL y solo enriquece el porqué
  });
  app.get('/api/athletes/:id/blocks', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    return await hs.blocks(id, cut(req.query));
  });
  // Analizador integral de bloques (solo lectura, determinista por corte): ventana actual + 3 previos.
  app.get('/api/athletes/:id/block-analysis', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    const q = parse(
      z.object({
        asOf: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        block: z.string().min(1).optional(),
        source: z.enum(['planned', 'actual']).default('actual'),
        lift: z.enum(['SQ', 'BP', 'DL', 'ALL']).default('ALL'),
      }),
      req.query,
    );
    const out = await ctx.blockAnalysis.build(id, {
      asOf: q.asOf ?? ctx.today(),
      block: q.block,
      source: q.source,
      lift: q.lift,
    });
    if (!out) throw new NotFoundError('No hay bloques para analizar (o el bloque pedido no existe)');
    return out;
  });
  app.get('/api/athletes/:id/compare', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    return await hs.compare(id, parse(compareQuerySchema, req.query), ctx.today());
  });
  app.get('/api/athletes/:id/load', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    return await hs.load(id, cut(req.query));
  });
  app.get('/api/athletes/:id/performance', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    return await hs.performance(id, cut(req.query));
  });
  app.get('/api/athletes/:id/sessions', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    return await hs.sessions(id);
  });
  app.get('/api/athletes/:id/checkins', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    return (await ctx.records.listCheckIns(id)).map((c) => ({ ...c, readiness: readinessOf(c) })).reverse();
  });

  app.post('/api/athletes/:id/session-feedback', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    await history.upsertFeedback(id, parse(sessionFeedbackSchema, req.body));
    return { ok: true };
  });
  app.post('/api/athletes/:id/coach-reviews', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    await history.upsertReview(id, parse(coachReviewSchema, req.body));
    return { ok: true };
  });
  app.get('/api/athletes/:id/coach-reviews', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    return await history.listReviews(id);
  });
  app.post('/api/athletes/:id/competitions', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    return reply.code(201).send({ id: await history.addCompetition(id, parse(competitionSchema, req.body)) });
  });
  app.get('/api/athletes/:id/competitions', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    return await history.listCompetitions(id);
  });
}
