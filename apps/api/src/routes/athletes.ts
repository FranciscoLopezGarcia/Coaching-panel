import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  checkInSchema,
  createAthleteSchema,
  decisionPatchSchema,
  evaluateSchema,
  importPlanSchema,
  importSetsSchema,
  paramsSchema,
  type AthleteDetail,
  type AthleteSummary,
} from '@coaching/contracts';
import { LIFTS } from '@coaching/engine';
import type { AppContext } from '../app.js';
import { NotFoundError, UnprocessableError } from '../services/errors.js';
import { validateStored } from '../services/params.js';
import { parse } from './http.js';

const idParam = z.object({ id: z.string().min(1) });

export function registerAthleteRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { athletes, records, decisions, evaluation, config } = ctx;
  const must = async (id: string) => {
    const a = await athletes.get(id);
    if (!a) throw new NotFoundError('Atleta inexistente');
    return a;
  };

  app.get(
    '/api/athletes',
    async (): Promise<AthleteSummary[]> =>
      await Promise.all(
        (await athletes.list()).map(async (a) => {
          const ev = await decisions.latestEvaluation(a.id);
          const lifts: AthleteSummary['lifts'] = {};
          for (const l of LIFTS) {
            const p = ev?.lifts[l]?.principal;
            lifts[l] = p
              ? { status: p.status, summary: p.summary, sufficiency: p.sufficiency, dataUntil: p.dataUntil }
              : null;
          }
          return {
            id: a.id,
            name: a.name,
            lastRecord: await records.lastRecordDate(a.id),
            evaluatedOn: ev?.cutoff ?? null,
            lifts,
            pendingDecisions: (await decisions.list(a.id, 'vigente')).filter(
              (d) => d.coachDecision === 'Pendiente' && d.isPrincipal && d.status !== 'datos_insuficientes',
            ).length,
          };
        }),
      ),
  );

  app.post('/api/athletes', async (req, reply) => {
    const body = parse(createAthleteSchema, req.body);
    return reply.code(201).send(await athletes.create(body.name, body.competitionExercises));
  });

  app.get('/api/athletes/:id', async (req): Promise<AthleteDetail> => {
    const { id } = parse(idParam, req.params);
    const a = await must(id);
    return {
      id: a.id,
      name: a.name,
      competitionExercises: a.competitionExercises,
      params: a.params,
      evaluation: await decisions.latestEvaluation(id),
      decisions: await decisions.list(id),
    };
  });

  app.put('/api/athletes/:id/params', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    const params = parse(paramsSchema, req.body);
    const issues = validateStored(params);
    if (issues.length) throw new UnprocessableError('Parámetros inválidos', { issues });
    await athletes.setParams(id, params);
    return { params };
  });

  app.post('/api/athletes/:id/plan', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    return await ctx.plans.importPlan(id, parse(importPlanSchema, req.body));
  });

  app.post('/api/athletes/:id/sets', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    const { sets, reason } = parse(importSetsSchema, req.body);
    const missing = await records.missingPlanned(
      id,
      sets.map((s) => s.plannedSetId),
    );
    if (missing.length)
      throw new UnprocessableError('La ejecución debe referirse a series previstas existentes', { missing });
    return { upserted: await records.upsertActual(id, sets, `${ctx.today()}T12:00:00.000Z`, reason) };
  });

  app.post('/api/athletes/:id/checkins', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    const { reason, ...checkin } = parse(
      checkInSchema.extend({ reason: z.string().max(200).optional() }),
      req.body,
    );
    await records.upsertCheckIn(id, checkin, reason);
    return { ok: true };
  });

  app.post('/api/athletes/:id/evaluate', async (req) => {
    const { id } = parse(idParam, req.params);
    const { cutoff } = parse(evaluateSchema, req.body ?? {});
    return await evaluation.evaluate(id, cutoff ?? ctx.today());
  });

  app.get('/api/athletes/:id/decisions', async (req) => {
    const { id } = parse(idParam, req.params);
    await must(id);
    const { validity } = parse(z.object({ validity: z.enum(['vigente', 'expirada']).optional() }), req.query);
    return await decisions.list(id, validity);
  });

  app.patch('/api/athletes/:id/decisions/:key', async (req) => {
    const { id, key } = parse(z.object({ id: z.string(), key: z.string() }), req.params);
    await must(id);
    const body = parse(decisionPatchSchema, req.body);
    const row = await decisions.decide(id, key, body.coachDecision, body.coachNote ?? '', ctx.today());
    if (!row) throw new NotFoundError('Decisión inexistente');
    return row; // aprobar NO modifica la programación
  });

  app.get('/api/health', async () => ({
    ok: true,
    timeZone: config.timeZone,
    instance: {
      mode: ctx.instance.mode,
      fictitious: ctx.instance.fictitious,
      datasetId: ctx.instance.datasetId,
      label: ctx.instance.label,
    },
  }));
  // identificación de la instancia + catálogo del laboratorio (vacío fuera del laboratorio)
  app.get('/api/instance', async () => ctx.instance);
}
