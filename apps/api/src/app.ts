import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadInstance, type InstanceInfo } from './instance.js';
import { loadConfig, todayIso, type Config } from './config.js';
import { openDb, type Db } from './db/connection.js';
import { AthletesRepo } from './repositories/athletes.js';
import { DecisionsRepo } from './repositories/decisions.js';
import { HistoryRepo } from './repositories/history.js';
import { InterventionsRepo } from './repositories/interventions.js';
import { ObservedRepo } from './repositories/observed.js';
import { ProgrammingRepo } from './repositories/programming.js';
import { ExerciseMapRepo, RevisionsRepo } from './repositories/revisions.js';
import { RecordsRepo } from './repositories/records.js';
import { ReferencesRepo } from './repositories/references.js';
import { AccountsRepo } from './repositories/accounts.js';
import { CoachesRepo } from './repositories/coaches.js';
import { LiveBus } from './services/live.js';
import { registerPortalRoutes } from './routes/portal.js';
import { registerAdminRoutes } from './routes/admin.js';
import { BlockAdmin } from './services/blocks.js';
import { BlockAnalysisService } from './services/block-analysis.js';
import { registerAthleteRoutes } from './routes/athletes.js';
import { registerConsolidationRoutes } from './routes/consolidation.js';
import { registerErrorHandler } from './routes/http.js';
import { registerTableRoutes } from './routes/tables.js';
import { registerHistoryRoutes } from './routes/history.js';
import { DashboardService } from './services/dashboard.js';
import { DataLoader } from './services/data.js';
import { EvaluationService } from './services/evaluation.js';
import { HistoryService } from './services/history.js';
import { ImportService } from './services/imports.js';
import { InterventionService } from './services/interventions.js';
import { PlanService } from './services/plan.js';
import { ProgrammingService } from './services/programming.js';
import { ProjectionService } from './services/projection.js';
import { QueryService } from './services/queries.js';
import { ReplayService } from './services/replay.js';

export interface AppContext {
  config: Config;
  instance: InstanceInfo;
  db: Db;
  athletes: AthletesRepo;
  records: RecordsRepo;
  decisions: DecisionsRepo;
  history: HistoryRepo;
  observed: ObservedRepo;
  revisions: RevisionsRepo;
  exerciseMap: ExerciseMapRepo;
  references: ReferencesRepo;
  accounts: AccountsRepo;
  interventionsRepo: InterventionsRepo;
  programmingRepo: ProgrammingRepo;
  evaluation: EvaluationService;
  plans: PlanService;
  historyService: HistoryService;
  dashboard: DashboardService;
  imports: ImportService;
  interventions: InterventionService;
  programming: ProgrammingService;
  queries: QueryService;
  replay: ReplayService;
  projection: ProjectionService;
  loader: DataLoader;
  coaches: CoachesRepo;
  blocks: BlockAdmin;
  blockAnalysis: BlockAnalysisService;
  live: LiveBus;
  today: () => string;
}

/** Composición de dependencias (sin estado global): permite tests con DB en memoria y reloj fijo. */
export async function buildContext(config: Config, db?: Db, today?: () => string): Promise<AppContext> {
  db ??= await openDb(config.dbPath, { authToken: config.tursoToken });
  const athletes = new AthletesRepo(db);
  const records = new RecordsRepo(db);
  const decisions = new DecisionsRepo(db);
  const history = new HistoryRepo(db);
  const observed = new ObservedRepo(db);
  const references = new ReferencesRepo(db);
  const accounts = new AccountsRepo(db);
  const coaches = new CoachesRepo(db);
  const live = new LiveBus(db);
  const revisions = new RevisionsRepo(db);
  const exerciseMap = new ExerciseMapRepo(db);
  const interventionsRepo = new InterventionsRepo(db);
  const programmingRepo = new ProgrammingRepo(db);
  const clock = today ?? (() => todayIso(config.timeZone));
  const nowIso = () => `${clock()}T12:00:00.000Z`;
  const loader = new DataLoader(
    athletes,
    records,
    history,
    observed,
    references,
    interventionsRepo,
    programmingRepo,
  );
  const plans = new PlanService(db, records, history, clock);
  return {
    config,
    instance: loadInstance(config.dbPath),
    db,
    athletes,
    records,
    decisions,
    history,
    observed,
    revisions,
    exerciseMap,
    references,
    accounts,
    coaches,
    blocks: new BlockAdmin(db, records, programmingRepo, plans),
    blockAnalysis: new BlockAnalysisService(loader, history),
    live,
    interventionsRepo,
    programmingRepo,
    loader,
    plans,
    evaluation: new EvaluationService(db, loader, decisions, history),
    historyService: new HistoryService(loader, history),
    dashboard: new DashboardService(athletes, records, decisions, history),
    imports: new ImportService(observed, plans, config.timeZone, nowIso, exerciseMap),
    interventions: new InterventionService(interventionsRepo, decisions, loader, clock, nowIso),
    programming: new ProgrammingService(records, programmingRepo, plans, nowIso, history),
    queries: new QueryService(loader, decisions, history, programmingRepo, records),
    replay: new ReplayService(loader, history),
    projection: new ProjectionService(loader, db, clock),
    today: clock,
  };
}

export async function buildApp(ctx0?: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const ctx = ctx0 ?? (await buildContext(loadConfig()));
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 25 * 1024 * 1024 });
  await app.register(cors, { origin: ctx.config.webOrigin });
  registerErrorHandler(app);
  // Diagnóstico de rendimiento: tiempo total del servidor y consultas a la base por pedido (visible en las herramientas del navegador).
  app.addHook('onRequest', async (req) => {
    (req as unknown as { t0: number; q0: number }).t0 = performance.now();
    (req as unknown as { t0: number; q0: number }).q0 = ctx.db.queries;
  });
  app.addHook('onSend', async (req, reply, payload) => {
    const r = req as unknown as { t0?: number; q0?: number };
    if (r.t0 !== undefined)
      reply.header(
        'server-timing',
        `app;dur=${Math.round(performance.now() - r.t0)}, db;desc="${ctx.db.queries - (r.q0 ?? 0)} consultas"`,
      );
    return payload;
  });
  registerAthleteRoutes(app, ctx);
  registerHistoryRoutes(app, ctx);
  registerConsolidationRoutes(app, ctx);
  registerTableRoutes(app);
  registerPortalRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  if (ctx.config.coachEmail && ctx.config.coachPassword)
    await ctx.coaches.ensure(ctx.config.coachEmail, ctx.config.coachPassword, new Date().toISOString());
  return app;
}
