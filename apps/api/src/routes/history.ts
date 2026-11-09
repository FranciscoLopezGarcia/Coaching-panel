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
  const must = (id: string) => {
    if (!athletes.get(id)) throw new NotFoundError('Atleta inexistente');
  };
  const cut = (q: unknown) => parse(cutoffQuery, q).cutoff ?? ctx.today();

  app.get('/api/dashboard', async () => ctx.dashboard.build(ctx.today()));

  app.get('/api/athletes/:id/plan-versions', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return hs.versions(id);
  });
  app.get('/api/athletes/:id/history', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return hs.events(id, cut(req.query));
  });
  app.patch('/api/athletes/:id/history/:eventId', async (req) => {
    const { id, eventId } = parse(z.object({ id: z.string(), eventId: z.string() }), req.params);
    must(id);
    const { coachComment } = parse(changeCommentSchema, req.body);
    if (!history.setEventComment(id, eventId, coachComment)) throw new NotFoundError('Evento inexistente');
    return { ok: true }; // el motivo es OPCIONAL y solo enriquece el porqué
  });
  app.get('/api/athletes/:id/blocks', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return hs.blocks(id, cut(req.query));
  });
  app.get('/api/athletes/:id/compare', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return hs.compare(id, parse(compareQuerySchema, req.query), ctx.today());
  });
  app.get('/api/athletes/:id/load', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return hs.load(id, cut(req.query));
  });
  app.get('/api/athletes/:id/performance', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return hs.performance(id, cut(req.query));
  });
  app.get('/api/athletes/:id/sessions', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return hs.sessions(id);
  });
  app.get('/api/athletes/:id/checkins', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.records
      .listCheckIns(id)
      .map((c) => ({ ...c, readiness: readinessOf(c) }))
      .reverse();
  });

  app.post('/api/athletes/:id/session-feedback', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    history.upsertFeedback(id, parse(sessionFeedbackSchema, req.body));
    return { ok: true };
  });
  app.post('/api/athletes/:id/coach-reviews', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    history.upsertReview(id, parse(coachReviewSchema, req.body));
    return { ok: true };
  });
  app.get('/api/athletes/:id/coach-reviews', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return history.listReviews(id);
  });
  app.post('/api/athletes/:id/competitions', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return reply.code(201).send({ id: history.addCompetition(id, parse(competitionSchema, req.body)) });
  });
  app.get('/api/athletes/:id/competitions', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return history.listCompetitions(id);
  });
}
