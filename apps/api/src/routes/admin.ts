import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { NotFoundError, UnprocessableError } from '../services/errors.js';
import { parse } from './http.js';

const idParam = z.object({ id: z.string().min(1) });
const blockParam = z.object({ id: z.string().min(1), blockKey: z.string().min(1) });
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    competitionExercises: z
      .object({
        SQ: z.string().trim().min(1).max(80).optional(),
        BP: z.string().trim().min(1).max(80).optional(),
        DL: z.string().trim().min(1).max(80).optional(),
      })
      .optional(),
  })
  .strict();

/** Editar y eliminar atletas y bloques (todas acciones del coach). */
export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const must = async (id: string) => {
    const a = await ctx.athletes.get(id);
    if (!a) throw new NotFoundError('Atleta inexistente');
    return a;
  };

  app.patch('/api/athletes/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    const patch = parse(patchSchema, req.body);
    if (!patch.name && !patch.competitionExercises) throw new UnprocessableError('No hay nada para cambiar.');
    await ctx.athletes.update(id, patch);
    const a = await must(id);
    return { id: a.id, name: a.name, competitionExercises: a.competitionExercises };
  });

  // Eliminar un atleta exige escribir su nombre exacto (anti-accidente).
  app.delete('/api/athletes/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const a = await must(id);
    const { confirm } = parse(z.object({ confirm: z.string() }), req.query);
    if (confirm.trim() !== a.name)
      throw new UnprocessableError('Para eliminar escribí el nombre exacto del atleta.', {
        expected: 'nombre exacto',
      });
    const r = await ctx.athletes.deleteAll(id);
    return { removed: a.name, ...r };
  });

  app.get('/api/athletes/:id/blocks/:blockKey/removal-preview', async (req) => {
    const { id, blockKey } = parse(blockParam, req.params);
    await must(id);
    return ctx.blocks.preview(id, blockKey);
  });

  app.delete('/api/athletes/:id/blocks/:blockKey', async (req) => {
    const { id, blockKey } = parse(blockParam, req.params);
    await must(id);
    const q = parse(z.object({ withExecution: z.enum(['0', '1']).default('0') }), req.query);
    return ctx.blocks.remove(id, blockKey, q.withExecution === '1');
  });
}
