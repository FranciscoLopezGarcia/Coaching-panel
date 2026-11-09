import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { checkInSchema } from '@coaching/contracts';
import type { AppContext } from '../app.js';
import { VIEW_MODES } from '../repositories/accounts.js';
import { NotFoundError } from '../services/errors.js';
import { parse } from './http.js';
import { PortalService } from '../services/portal.js';
import { LiveBus } from '../services/live.js';
import type { FastifyReply } from 'fastify';

const idParam = z.object({ id: z.string().min(1) });
const email = z.string().trim().toLowerCase().email().max(120);
const FAILS = new Map<string, { n: number; until: number }>();

/**
 * Portal del atleta. Cuentas: el coach asigna email y contraseña a cada atleta; el atleta inicia sesión y recibe un token (30 días).
 * Todo lo del atleta cuelga de /api/me/* y solo ve SU información. LÍMITE CONOCIDO: el lado del coach no tiene autenticación (demo local),
 * así que esto aísla a los atletas entre sí y del coach cuando usan su token, pero no protege la API del coach de quien llegue a ella sin token.
 */
export function registerPortalRoutes(app: FastifyInstance, ctx: AppContext): PortalService {
  const portal = new PortalService(
    ctx.athletes,
    ctx.records,
    ctx.programmingRepo,
    ctx.history,
    ctx.accounts,
    ctx.today,
    () => `${ctx.today()}T12:00:00.000Z`,
  );
  const bearer = (req: FastifyRequest) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
  const me = (req: FastifyRequest): string => {
    const t = bearer(req);
    const id = t ? ctx.accounts.athleteOfToken(t, new Date()) : null;
    if (!id) throw Object.assign(new Error('Iniciá sesión para continuar.'), { statusCode: 401 });
    return id;
  };

  const live = new LiveBus();
  ctx.live = live;
  /** Canal SSE: avisa «hubo cambios» (la revisión) apenas ocurren; el cliente vuelve a pedir lo que muestra. */
  const stream = (req: FastifyRequest, reply: FastifyReply, athleteId: string) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': String(req.headers.origin ?? '*'),
    });
    const send = (rev: number) => res.write(`event: rev\ndata: ${JSON.stringify({ rev })}\n\n`);
    res.write('retry: 1500\n\n');
    send(live.rev(athleteId));
    const off = live.subscribe(athleteId, send);
    const beat = setInterval(() => res.write(': latido\n\n'), 15000);
    req.raw.on('close', () => {
      clearInterval(beat);
      off();
    });
  };
  // Toda escritura exitosa que afecta a un atleta sube su revisión (después de responder: ya está guardada).
  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || reply.statusCode >= 400)
      return;
    const m = /^\/api\/athletes\/([^/?]+)/.exec(req.url);
    if (m) return void live.bump(decodeURIComponent(m[1] as string));
    const t = bearer(req);
    if (req.url.startsWith('/api/me') && t) {
      const id = ctx.accounts.athleteOfToken(t, new Date());
      if (id) live.bump(id);
    }
  });
  app.get('/api/me/rev', async (req) => ({ rev: live.rev(me(req)) }));
  app.get('/api/me/events', async (req, reply) => stream(req, reply, me(req)));
  app.get('/api/athletes/:id/rev', async (req) => ({
    rev: live.rev(parse(idParam, req.params).id),
  }));
  app.get('/api/athletes/:id/events', async (req, reply) =>
    stream(req, reply, parse(idParam, req.params).id),
  );

  // Una cuenta de atleta solo puede usar el portal: con su token, las rutas del coach se rechazan.
  app.addHook('onRequest', async (req, reply) => {
    if (bearer(req) && !req.url.startsWith('/api/me') && !req.url.startsWith('/api/auth'))
      return reply.code(403).send({ error: 'Las cuentas de atleta solo acceden al portal del atleta.' });
  });

  /* ----- coach: cuenta del atleta y qué ve en cada entreno ----- */
  const account = z.object({ email, password: z.string().min(6, 'Mínimo 6 caracteres').max(100) });
  app.put('/api/athletes/:id/account', async (req) => {
    const { id } = parse(idParam, req.params);
    if (!ctx.athletes.get(id)) throw new NotFoundError('Atleta inexistente');
    const b = parse(account, req.body);
    try {
      ctx.accounts.setAccount(id, b.email, b.password, new Date().toISOString());
    } catch (e) {
      throw Object.assign(e as Error, { statusCode: 409 });
    }
    return { ok: true, email: b.email };
  });
  app.get('/api/athletes/:id/account', async (req) => {
    const { id } = parse(idParam, req.params);
    return { account: ctx.accounts.getAccount(id) };
  });
  app.delete('/api/athletes/:id/account', async (req) => {
    const { id } = parse(idParam, req.params);
    return { removed: ctx.accounts.deleteAccount(id) };
  });
  app.get('/api/athletes/:id/view-settings', async (req) => {
    const { id } = parse(idParam, req.params);
    return { modes: VIEW_MODES, settings: ctx.accounts.viewSettings(id) };
  });
  app.put('/api/athletes/:id/view-settings', async (req) => {
    const { id } = parse(idParam, req.params);
    if (!ctx.athletes.get(id)) throw new NotFoundError('Atleta inexistente');
    const b = parse(
      z.object({ sessionKey: z.string().min(1).default('*'), mode: z.enum(VIEW_MODES).nullable() }),
      req.body,
    );
    if (b.mode === null) ctx.accounts.clearViewMode(id, b.sessionKey);
    else ctx.accounts.setViewMode(id, b.sessionKey, b.mode);
    return { ok: true, settings: ctx.accounts.viewSettings(id) };
  });

  /* ----- acceso ----- */
  app.post('/api/auth/login', async (req, reply) => {
    const b = parse(z.object({ email, password: z.string().min(1).max(100) }), req.body);
    const f = FAILS.get(b.email);
    if (f && f.n >= 5 && f.until > Date.now())
      return reply.code(429).send({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.' });
    const id = ctx.accounts.verify(b.email, b.password);
    if (!id) {
      FAILS.set(b.email, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60000 });
      return reply.code(401).send({ error: 'Email o contraseña incorrectos.' });
    }
    FAILS.delete(b.email);
    const a = ctx.athletes.get(id);
    return { token: ctx.accounts.createToken(id, new Date()), athlete: { id, name: a?.name ?? '' } };
  });
  app.post('/api/auth/logout', async (req) => {
    const t = bearer(req);
    if (t) ctx.accounts.revoke(t);
    return { ok: true };
  });

  /* ----- portal del atleta ----- */
  app.get('/api/me/home', async (req) => portal.home(me(req)));
  app.get('/api/me/plan', async (req) => portal.plan(me(req)));
  app.get('/api/me/next', async (req) => portal.next(me(req)));
  app.get('/api/me/sessions/:key', async (req) =>
    portal.session(me(req), parse(z.object({ key: z.string().min(1) }), req.params).key),
  );
  app.put('/api/me/sets', async (req) => {
    const b = parse(
      z.object({
        plannedSetId: z.string().min(1),
        status: z.enum(['done', 'pending', 'skipped']),
        kg: z.number().positive().max(1000).nullable(),
        reps: z.number().int().positive().max(200).nullable(),
        rpe: z.number().min(1).max(10).nullable(),
        pain: z.number().min(0).max(10).nullable().optional(),
      }),
      req.body,
    );
    return portal.logSet(me(req), b);
  });
  app.put('/api/me/notes', async (req) => {
    const id = me(req);
    const b = parse(
      z.object({
        sessionKey: z.string().min(1),
        exerciseName: z.string().min(1).max(120),
        note: z.string().max(600),
      }),
      req.body,
    );
    if (!portal.hasSession(id, b.sessionKey)) throw new NotFoundError('Esa sesión no existe');
    ctx.accounts.setNote(id, b.sessionKey, b.exerciseName, b.note, new Date().toISOString());
    return { ok: true };
  });
  app.get('/api/athletes/:id/progression', async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ sessionKey: z.string().min(1) }), req.query);
    return { items: portal.progression(id, q.sessionKey) };
  });
  app.get('/api/athletes/:id/notes', async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ sessionKey: z.string().optional() }), req.query);
    return { notes: ctx.accounts.notes(id, q.sessionKey) };
  });
  app.post('/api/me/checkins', async (req) => {
    const id = me(req);
    const c = parse(checkInSchema.partial({ date: true }), req.body);
    ctx.records.upsertCheckIn(id, { ...c, date: c.date ?? ctx.today() } as never, 'Registrado por el atleta');
    return { ok: true };
  });
  app.post('/api/me/sessions/:key/finish', async (req) => {
    const id = me(req);
    const { key } = parse(z.object({ key: z.string().min(1) }), req.params);
    const b = parse(
      z.object({ endFatigue: z.number().min(1).max(10).nullable(), note: z.string().max(300).optional() }),
      req.body,
    );
    return portal.finish(id, key, b.endFatigue, b.note);
  });
  return portal;
}
