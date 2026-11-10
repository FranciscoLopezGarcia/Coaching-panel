import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { checkInSchema } from '@coaching/contracts';
import type { AppContext } from '../app.js';
import { VIEW_MODES } from '../repositories/accounts.js';
import { NotFoundError } from '../services/errors.js';
import { parse } from './http.js';
import { PortalService } from '../services/portal.js';
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
  const me = async (req: FastifyRequest): Promise<string> => {
    const t = bearer(req);
    const id = t ? await ctx.accounts.athleteOfToken(t, new Date()) : null;
    if (!id) throw Object.assign(new Error('Iniciá sesión para continuar.'), { statusCode: 401 });
    return id;
  };

  const live = ctx.live;
  /** Canal SSE (solo con proceso largo, p. ej. local): avisa «hubo cambios» al instante; el cliente vuelve a pedir lo que muestra. */
  const stream = async (req: FastifyRequest, reply: FastifyReply, athleteId: string) => {
    if (ctx.config.serverless)
      return reply.code(501).send({ error: 'Sin canal en vivo en este entorno: usá el sondeo.' });
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
    send(await live.rev(athleteId));
    const off = live.subscribe(athleteId, send);
    const beat = setInterval(() => res.write(': latido\n\n'), 15000);
    req.raw.on('close', () => {
      clearInterval(beat);
      off();
    });
  };
  // Toda escritura exitosa que afecta a un atleta sube su revisión ANTES de contestar (en serverless nada corre después de responder).
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || reply.statusCode >= 400)
      return payload;
    const m = /^\/api\/athletes\/([^/?]+)/.exec(req.url);
    if (m) await live.bump(decodeURIComponent(m[1] as string));
    else {
      const t = bearer(req);
      if (req.url.startsWith('/api/me') && t) {
        const id = await ctx.accounts.athleteOfToken(t, new Date());
        if (id) await live.bump(id);
      }
    }
    return payload;
  });
  app.get('/api/me/rev', async (req) => {
    const t = bearer(req);
    const rev = t ? await ctx.accounts.revOfToken(t, new Date()) : null;
    if (rev === null) throw Object.assign(new Error('Iniciá sesión para continuar.'), { statusCode: 401 });
    return { rev };
  });
  app.get('/api/me/events', async (req, reply) => stream(req, reply, await me(req)));
  app.get('/api/athletes/:id/rev', async (req) => ({
    rev: await live.rev(parse(idParam, req.params).id),
  }));

  // Acceso. Con login de coach activado (producción): todo /api/* exige token de coach salvo lo público y lo del atleta (que valida
  // su propio token). Con un token de atleta, las rutas del coach se rechazan siempre. Sin login de coach (local) se mantiene lo de antes.
  const PUBLIC = [/^\/api\/instance$/, /^\/api\/health$/, /^\/api\/coach\/(login|session)$/];
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] as string;
    if (!path.startsWith('/api/') || req.method === 'OPTIONS') return;
    if (path.startsWith('/api/me') || path.startsWith('/api/auth') || PUBLIC.some((re) => re.test(path)))
      return;
    const t = bearer(req);
    if (!ctx.config.coachAuth) {
      if (t)
        return reply.code(403).send({ error: 'Las cuentas de atleta solo acceden al portal del atleta.' });
      return;
    }
    if (!t) return reply.code(401).send({ error: 'Iniciá sesión como coach.' });
    if (await ctx.coaches.emailOfToken(t, new Date())) return;
    if (await ctx.accounts.athleteOfToken(t, new Date()))
      return reply.code(403).send({ error: 'Las cuentas de atleta solo acceden al portal del atleta.' });
    return reply.code(401).send({ error: 'La sesión de coach venció: volvé a ingresar.' });
  });

  /* ----- login del coach ----- */
  const CFAILS = new Map<string, { n: number; until: number }>();
  app.get('/api/coach/session', async (req) => {
    const t = bearer(req);
    const e = t ? await ctx.coaches.emailOfToken(t, new Date()) : null;
    return { authRequired: ctx.config.coachAuth, authenticated: !!e, email: e };
  });
  app.post('/api/coach/login', async (req, reply) => {
    const b = parse(z.object({ email, password: z.string().min(1).max(100) }), req.body);
    const f = CFAILS.get(b.email);
    if (f && f.n >= 5 && f.until > Date.now())
      return reply.code(429).send({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.' });
    const id = await ctx.coaches.verify(b.email, b.password);
    if (!id) {
      CFAILS.set(b.email, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60000 });
      return reply.code(401).send({ error: 'Email o contraseña incorrectos.' });
    }
    CFAILS.delete(b.email);
    return { token: await ctx.coaches.createToken(id, new Date()), email: b.email };
  });
  app.post('/api/coach/logout', async (req) => {
    const t = bearer(req);
    if (t) await ctx.coaches.revoke(t);
    return { ok: true };
  });
  app.put('/api/coach/password', async (req, reply) => {
    const t = bearer(req);
    const e = t ? await ctx.coaches.emailOfToken(t, new Date()) : null;
    if (!e) return reply.code(401).send({ error: 'Iniciá sesión como coach.' });
    const b = parse(z.object({ password: z.string().min(8, 'Mínimo 8 caracteres').max(100) }), req.body);
    await ctx.coaches.setPassword(e, b.password, new Date().toISOString());
    return { ok: true };
  });

  /* ----- coach: cuenta del atleta y qué ve en cada entreno ----- */
  const account = z.object({ email, password: z.string().min(6, 'Mínimo 6 caracteres').max(100) });
  app.put('/api/athletes/:id/account', async (req) => {
    const { id } = parse(idParam, req.params);
    if (!(await ctx.athletes.get(id))) throw new NotFoundError('Atleta inexistente');
    const b = parse(account, req.body);
    try {
      await ctx.accounts.setAccount(id, b.email, b.password, new Date().toISOString());
    } catch (e) {
      throw Object.assign(e as Error, { statusCode: 409 });
    }
    return { ok: true, email: b.email };
  });
  app.get('/api/athletes/:id/account', async (req) => {
    const { id } = parse(idParam, req.params);
    return { account: await ctx.accounts.getAccount(id) };
  });
  app.delete('/api/athletes/:id/account', async (req) => {
    const { id } = parse(idParam, req.params);
    return { removed: await ctx.accounts.deleteAccount(id) };
  });
  app.get('/api/athletes/:id/view-settings', async (req) => {
    const { id } = parse(idParam, req.params);
    return { modes: VIEW_MODES, settings: await ctx.accounts.viewSettings(id) };
  });
  app.put('/api/athletes/:id/view-settings', async (req) => {
    const { id } = parse(idParam, req.params);
    if (!(await ctx.athletes.get(id))) throw new NotFoundError('Atleta inexistente');
    const b = parse(
      z.object({ sessionKey: z.string().min(1).default('*'), mode: z.enum(VIEW_MODES).nullable() }),
      req.body,
    );
    if (b.mode === null) await ctx.accounts.clearViewMode(id, b.sessionKey);
    else await ctx.accounts.setViewMode(id, b.sessionKey, b.mode);
    return { ok: true, settings: await ctx.accounts.viewSettings(id) };
  });

  /* ----- acceso ----- */
  app.post('/api/auth/login', async (req, reply) => {
    const b = parse(z.object({ email, password: z.string().min(1).max(100) }), req.body);
    const f = FAILS.get(b.email);
    if (f && f.n >= 5 && f.until > Date.now())
      return reply.code(429).send({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.' });
    const id = await ctx.accounts.verify(b.email, b.password);
    if (!id) {
      FAILS.set(b.email, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60000 });
      return reply.code(401).send({ error: 'Email o contraseña incorrectos.' });
    }
    FAILS.delete(b.email);
    const a = await ctx.athletes.get(id);
    return { token: await ctx.accounts.createToken(id, new Date()), athlete: { id, name: a?.name ?? '' } };
  });
  app.post('/api/auth/logout', async (req) => {
    const t = bearer(req);
    if (t) await ctx.accounts.revoke(t);
    return { ok: true };
  });

  /* ----- portal del atleta ----- */
  app.get('/api/me/home', async (req) => await portal.home(await me(req)));
  app.get('/api/me/plan', async (req) => await portal.plan(await me(req)));
  app.get('/api/me/next', async (req) => await portal.next(await me(req)));
  app.get(
    '/api/me/sessions/:key',
    async (req) =>
      await portal.session(await me(req), parse(z.object({ key: z.string().min(1) }), req.params).key),
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
    return await portal.logSet(await me(req), b);
  });
  app.put('/api/me/notes', async (req) => {
    const id = await me(req);
    const b = parse(
      z.object({
        sessionKey: z.string().min(1),
        exerciseName: z.string().min(1).max(120),
        note: z.string().max(600),
      }),
      req.body,
    );
    if (!(await portal.hasSession(id, b.sessionKey))) throw new NotFoundError('Esa sesión no existe');
    await ctx.accounts.setNote(id, b.sessionKey, b.exerciseName, b.note, new Date().toISOString());
    return { ok: true };
  });
  app.get('/api/athletes/:id/progression', async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ sessionKey: z.string().min(1) }), req.query);
    return { items: await portal.progression(id, q.sessionKey) };
  });
  app.get('/api/athletes/:id/notes', async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ sessionKey: z.string().optional() }), req.query);
    // además: el cierre que dejó el atleta al terminar el entreno (fatiga y comentario)
    const finish = q.sessionKey
      ? ((await ctx.history.listFinishes(id)).find((f) => f.sessionKey === q.sessionKey) ?? null)
      : null;
    return { notes: await ctx.accounts.notes(id, q.sessionKey), finish };
  });
  app.post('/api/me/checkins', async (req) => {
    const id = await me(req);
    const c = parse(checkInSchema.partial({ date: true }), req.body);
    await ctx.records.upsertCheckIn(
      id,
      { ...c, date: c.date ?? ctx.today() } as never,
      'Registrado por el atleta',
    );
    return { ok: true };
  });
  app.post('/api/me/sessions/:key/finish', async (req) => {
    const id = await me(req);
    const { key } = parse(z.object({ key: z.string().min(1) }), req.params);
    const b = parse(
      z.object({ endFatigue: z.number().min(1).max(10).nullable(), note: z.string().max(300).optional() }),
      req.body,
    );
    return await portal.finish(id, key, b.endFatigue, b.note);
  });
  return portal;
}
