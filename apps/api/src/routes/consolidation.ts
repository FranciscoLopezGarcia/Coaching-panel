import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  abQuerySchema,
  coreQuerySchema,
  exposureLinkSchema,
  hevyExerciseMapSchema,
  hevyImportSchema,
  interventionCreateSchema,
  interventionTransitionSchema,
  macroSchema,
  mesoSchema,
  microSchema,
  periodQuerySchema,
  performanceProjectionQuerySchema,
  planCsvImportSchema,
  programOpFullSchema,
  replaySchema,
  revisionsQuerySchema,
  saveTemplateSchema,
  sourceQuerySchema,
  strengthReferenceSchema,
} from '@coaching/contracts';
import { stepFor, type Lift } from '@coaching/engine';
import type { AppContext } from '../app.js';
import { NotFoundError } from '../services/errors.js';
import { toEngineParams } from '../services/params.js';
import { parse } from './http.js';

const idParam = z.object({ id: z.string().min(1) });
const cutoffOnly = z.object({
  cutoff: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const dateRange = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cutoff: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  source: z.string().optional(),
});

/** Consolidación del motor: catálogo, estado explicativo, métricas, récords, importaciones, referencias, intervenciones, programación, consultas y replay. */
export function registerConsolidationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const must = (id: string) => {
    const a = ctx.athletes.get(id);
    if (!a) throw new NotFoundError('Atleta inexistente');
    return a;
  };
  const cut = (q: unknown) => parse(cutoffOnly, q).cutoff ?? ctx.today();
  const step = (id: string) => stepFor(toEngineParams(must(id).params), 'SQ');

  /* ----- catálogo (no depende de un atleta) ----- */
  app.get('/api/catalog', async () => ctx.queries.catalog());

  /* ----- estado multidimensional, métricas y récords ----- */
  app.get('/api/athletes/:id/state', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.queries.state(id);
  });
  app.get('/api/athletes/:id/metrics', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const q = parse(
      periodQuerySchema.extend({ cutoff: z.string().optional(), source: z.string().optional() }),
      req.query,
    );
    return ctx.queries.metrics(id, { ...q, cutoff: q.cutoff ?? ctx.today() });
  });
  app.get('/api/athletes/:id/records', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const q = parse(sourceQuerySchema, req.query);
    return ctx.queries.records(id, q.cutoff ?? ctx.today(), q.source);
  });
  app.get('/api/athletes/:id/recommendations/:key/evidence', async (req) => {
    const { id, key } = parse(z.object({ id: z.string(), key: z.string() }), req.params);
    must(id);
    return ctx.queries.evidence(id, key, cut(req.query));
  });

  /* ----- consultas para el frontend ----- */
  app.get('/api/athletes/:id/weekly', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const q = parse(dateRange, req.query);
    return ctx.queries.weekly(id, { ...q, cutoff: q.cutoff ?? ctx.today() });
  });
  app.get('/api/athletes/:id/weekly-muscles', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const q = parse(dateRange, req.query);
    return ctx.queries.weeklyMuscles(id, { ...q, cutoff: q.cutoff ?? ctx.today() });
  });
  app.get('/api/athletes/:id/week-compare', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const q = parse(
      z.object({
        lift: z.enum(['SQ', 'BP', 'DL', 'ALL']).default('ALL'),
        exercise: z.string().optional(),
        cutoff: z.string().optional(),
        source: z.string().optional(),
      }),
      req.query,
    );
    return ctx.queries.weekCompare(id, { ...q, cutoff: q.cutoff ?? ctx.today() });
  });
  app.get('/api/athletes/:id/period-compare', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const q = parse(
      abQuerySchema.extend({ cutoff: z.string().optional(), source: z.string().optional() }),
      req.query,
    );
    return ctx.queries.comparePeriods(id, { ...q, cutoff: q.cutoff ?? ctx.today() });
  });
  app.get('/api/athletes/:id/series', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const q = parse(dateRange, req.query);
    return ctx.queries.series(id, { ...q, cutoff: q.cutoff ?? ctx.today() });
  });
  app.get('/api/athletes/:id/annotations', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.queries.annotations(id, parse(dateRange, req.query));
  });
  app.get('/api/athletes/:id/exposures/:exposureId', async (req) => {
    const { id, exposureId } = parse(z.object({ id: z.string(), exposureId: z.string() }), req.params);
    must(id);
    return ctx.queries.exposure(id, exposureId, cut(req.query));
  });

  /* ----- variables núcleo: NL, SI, tonelaje, volumen por grupo muscular, fatiga entre series y entre sesiones ----- */
  app.get('/api/athletes/:id/core', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const q = parse(coreQuerySchema, req.query);
    const today = ctx.today();
    const cutoff = q.cutoff ?? (q.basis === 'previsto' && q.to > today ? q.to : today);
    return ctx.queries.core(id, { ...q, cutoff });
  });

  /* ----- proyección de rendimiento (EXPERIMENTAL, solo lectura) ----- */
  app.get('/api/athletes/:id/performance-projection', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.projection.run(id, parse(performanceProjectionQuerySchema, req.query));
  });

  /* ----- macro / meso / microciclo ----- */
  app.post('/api/athletes/:id/macros', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return reply.code(201).send(ctx.programmingRepo.createMacro(id, parse(macroSchema, req.body)));
  });
  app.get('/api/athletes/:id/macros', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.queries.macros(id);
  });
  app.get('/api/athletes/:id/macros/active', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const { macroId } = parse(z.object({ macroId: z.string().optional() }), req.query);
    return ctx.queries.activeMacro(id, cut(req.query), macroId);
  });
  app.get('/api/athletes/:id/macros/:macroId', async (req) => {
    const { id, macroId } = parse(z.object({ id: z.string(), macroId: z.string() }), req.params);
    must(id);
    return ctx.queries.macro(id, macroId, cut(req.query));
  });
  app.put('/api/athletes/:id/mesos', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    ctx.programmingRepo.upsertMeso(id, parse(mesoSchema, req.body));
    return { ok: true };
  });
  app.get('/api/athletes/:id/mesos', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.programmingRepo.listMesos(id);
  });
  app.get('/api/athletes/:id/microcycles', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.programmingRepo.listMicros(id);
  });
  app.get('/api/athletes/:id/mesos/:blockKey', async (req) => {
    const { id, blockKey } = parse(z.object({ id: z.string(), blockKey: z.string() }), req.params);
    must(id);
    return ctx.queries.meso(id, blockKey, cut(req.query));
  });
  app.put('/api/athletes/:id/microcycles', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    ctx.programmingRepo.upsertMicro(id, parse(microSchema, req.body));
    return { ok: true };
  });

  /* ----- lectura íntegra de la programación vigente ----- */
  app.get('/api/athletes/:id/plan', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const q = parse(
      z.object({
        sessionKey: z.string().optional(),
        blockKey: z.string().optional(),
        weekNo: z.coerce.number().int().positive().optional(),
        exposureId: z.string().optional(),
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        includeActual: z.enum(['true', 'false']).default('true'),
      }),
      req.query,
    );
    return ctx.programming.readPlan(id, { ...q, includeActual: q.includeActual === 'true' }, step(id));
  });
  app.get('/api/athletes/:id/plan-versions/:versionId', async (req) => {
    const { id, versionId } = parse(z.object({ id: z.string(), versionId: z.string() }), req.params);
    must(id);
    return ctx.programming.version(id, versionId);
  });

  /* ----- programación: operaciones y plantillas ----- */
  app.post('/api/athletes/:id/program', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.programming.run(id, parse(programOpFullSchema, req.body), step(id));
  });
  app.post('/api/athletes/:id/templates', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return reply.code(201).send(ctx.programming.saveTemplate(id, parse(saveTemplateSchema, req.body)));
  });
  app.get('/api/athletes/:id/templates', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.programmingRepo.listTemplates(id);
  });
  app.put('/api/athletes/:id/exposure-links', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const b = parse(exposureLinkSchema, req.body);
    ctx.programmingRepo.link(id, b.from, b.to, ctx.today(), b.note);
    return {
      ok: true,
      note: 'Vínculo explícito: la identidad de las series de origen se trata como la de destino al evaluar. Nada se fusiona por inferencia.',
    };
  });
  app.get('/api/athletes/:id/exposure-links', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.programmingRepo.links(id);
  });
  app.delete('/api/athletes/:id/exposure-links/:from', async (req) => {
    const { id, from } = parse(z.object({ id: z.string(), from: z.string() }), req.params);
    must(id);
    return { removed: ctx.programmingRepo.unlink(id, from) };
  });

  /* ----- importaciones ----- */
  app.post('/api/athletes/:id/imports/hevy', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.imports.hevy(id, parse(hevyImportSchema, req.body));
  });
  app.post('/api/athletes/:id/imports/plan-csv', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.imports.planCsv(id, parse(planCsvImportSchema, req.body), step(id));
  });
  app.get('/api/athletes/:id/imports', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.observed.batches(id);
  });

  /* ----- mapeo de ejercicios de Hevy (persistente y revisable) ----- */
  app.get('/api/athletes/:id/imports/hevy/exercise-map', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.exerciseMap.list(id);
  });
  app.put('/api/athletes/:id/imports/hevy/exercise-map', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const { title, ...m } = parse(hevyExerciseMapSchema, req.body);
    ctx.exerciseMap.put(id, title, m, new Date().toISOString());
    return { ok: true, map: ctx.exerciseMap.list(id) };
  });
  app.delete('/api/athletes/:id/imports/hevy/exercise-map', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const { title } = parse(z.object({ title: z.string().min(1) }), req.query);
    return { removed: ctx.exerciseMap.remove(id, title) };
  });

  /* ----- trazabilidad de ediciones de registros ----- */
  app.get('/api/athletes/:id/revisions', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    const q = parse(revisionsQuerySchema, req.query);
    return { ...ctx.revisions.list(id, q), limit: q.limit, offset: q.offset };
  });

  /* ----- referencias de fuerza ----- */
  app.post('/api/athletes/:id/references', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return reply.code(201).send(ctx.references.add(id, parse(strengthReferenceSchema, req.body)));
  });
  app.get('/api/athletes/:id/references', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.references.list(id);
  });

  /* ----- intervenciones ----- */
  app.post('/api/athletes/:id/interventions', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return reply.code(201).send(ctx.interventions.create(id, parse(interventionCreateSchema, req.body)));
  });
  app.get('/api/athletes/:id/interventions', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.interventions.list(id, cut(req.query));
  });
  app.post('/api/athletes/:id/interventions/:iid/transition', async (req) => {
    const { id, iid } = parse(z.object({ id: z.string(), iid: z.string() }), req.params);
    must(id);
    return ctx.interventions.transition(id, iid, parse(interventionTransitionSchema, req.body));
  });
  app.post('/api/athletes/:id/interventions/:iid/link', async (req) => {
    const { id, iid } = parse(z.object({ id: z.string(), iid: z.string() }), req.params);
    must(id);
    const { eventId } = parse(z.object({ eventId: z.string() }), req.body);
    return ctx.interventions.link(id, iid, eventId);
  });

  /* ----- replay histórico ----- */
  app.post('/api/athletes/:id/replay', async (req) => {
    const { id } = parse(idParam, req.params);
    must(id);
    return ctx.replay.run(id, parse(replaySchema, req.body));
  });
}

export type { Lift };
