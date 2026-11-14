import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  attemptsPutSchema,
  competitionSchema,
  customExerciseSchema,
  profileSchema,
} from '@coaching/contracts';
import type { AppContext } from '../app.js';
import { NotFoundError, UnprocessableError } from '../services/errors.js';
import { fullLibrary } from '../services/library.js';
import { parse } from './http.js';

const idParam = z.object({ id: z.string().min(1) });
const compParam = z.object({ id: z.string().min(1), compId: z.string().min(1) });
const dateQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Perfil ampliado, competencias con intentos, marcas, panel hoy/semana y biblioteca de ejercicios. */
export function registerCoachExtrasRoutes(app: FastifyInstance, ctx: AppContext): void {
  const x = ctx.coachExtras;

  app.get('/api/athletes/:id/profile', async (req) => await x.profile(parse(idParam, req.params).id));
  app.put('/api/athletes/:id/profile', async (req) => {
    const { id } = parse(idParam, req.params);
    await x.putProfile(id, parse(profileSchema, req.body));
    return { ok: true };
  });

  app.get(
    '/api/athletes/:id/competitions-detail',
    async (req) => await x.competitions(parse(idParam, req.params).id),
  );
  app.patch('/api/athletes/:id/competitions/:compId', async (req) => {
    const { id, compId } = parse(compParam, req.params);
    const body = parse(z.record(z.unknown()), req.body);
    await x.updateCompetition(id, compId, body, (m) => parse(competitionSchema, m));
    return { ok: true };
  });
  app.delete('/api/athletes/:id/competitions/:compId', async (req) => {
    const { id, compId } = parse(compParam, req.params);
    await x.deleteCompetition(id, compId);
    return { ok: true };
  });
  app.put('/api/athletes/:id/competitions/:compId/attempts', async (req) => {
    const { id, compId } = parse(compParam, req.params);
    try {
      await x.putAttempts(id, compId, parse(attemptsPutSchema, req.body).attempts);
    } catch (e) {
      if (e instanceof NotFoundError) throw e;
      if (e instanceof Error && e.message.startsWith('Intento repetido'))
        throw new UnprocessableError(e.message);
      throw e;
    }
    return { ok: true };
  });
  app.get('/api/athletes/:id/marks', async (req) => await x.marks(parse(idParam, req.params).id));
  app.get('/api/athletes/:id/agenda', async (req) => {
    const { id } = parse(idParam, req.params);
    return await x.agenda(id, parse(dateQuery, req.query).date);
  });

  // Panel «hoy» de todos los atletas (solo lectura): sesiones de hoy y de la semana, check-in y próxima competencia.
  app.get('/api/today', async (req) => {
    const date = parse(dateQuery, req.query).date ?? ctx.today();
    const list = await ctx.athletes.list();
    return await Promise.all(
      list.map(async (a) => ({ athleteId: a.id, athleteName: a.name, ...(await x.agenda(a.id, date)) })),
    );
  });

  app.get('/api/exercise-library', async () => fullLibrary(await ctx.extrasRepo.listExercises()));
  app.post('/api/exercise-library', async (req, reply) => {
    const body = parse(customExerciseSchema, req.body);
    try {
      return reply
        .code(201)
        .send({ id: await ctx.extrasRepo.addExercise(body, ctx.today() + 'T12:00:00.000Z') });
    } catch (e) {
      if (/UNIQUE/i.test((e as Error).message))
        throw new UnprocessableError('Ya existe un ejercicio propio con ese nombre.');
      throw e;
    }
  });
  app.put('/api/exercise-library/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    if (!(await ctx.extrasRepo.updateExercise(id, parse(customExerciseSchema, req.body))))
      throw new NotFoundError('Ejercicio inexistente');
    return { ok: true };
  });
  app.delete('/api/exercise-library/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    if (!(await ctx.extrasRepo.deleteExercise(id))) throw new NotFoundError('Ejercicio inexistente');
    return { ok: true };
  });
}
