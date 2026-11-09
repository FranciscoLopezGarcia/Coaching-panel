import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { seedDemoData } from '../src/seed/load.js';

const TODAY = '2026-03-10';
let app: FastifyInstance;
let ctx: AppContext;
let ids: Record<string, string>;
const A = () => ids['DEMO A · progresa (sintético)'] as string;
const B = () => ids['DEMO B · molestia (sintético)'] as string;
const C = () => ids['DEMO C · incompleto (sintético)'] as string;
const D = () => ids['DEMO D · fatiga intra-sesión (sintético)'] as string;
const E = () => ids['DEMO E · candidato a récord (sintético)'] as string;

const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();
const post = async (url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, payload: payload as object });

beforeEach(async () => {
  ctx = await buildContext({ ...loadConfig({}), dbPath: ':memory:' }, await openDb(':memory:'), () => TODAY);
  app = await buildApp(ctx);
  ids = await seedDemoData(ctx);
});

describe('API · recorrido registro → evaluación → decisión del coach', () => {
  it('atleta que progresa: propuesta principal pendiente; el coach la aprueba sin tocar la programación', async () => {
    const planBefore = await ctx.records.listPlanned(A());
    const ev = (await post(`/api/athletes/${A()}/evaluate`, {})).json();
    expect(ev.evaluation.lifts.SQ.principal.status).toBe('ventana_expresion');
    expect(
      ev.evaluation.lifts.SQ.results.some((r: { status: string }) => r.status === 'progreso_sostenido'),
    ).toBe(true);
    const principal = ev.decisions.find(
      (d: { lift: string; isPrincipal: boolean }) => d.lift === 'BP' && d.isPrincipal,
    );
    expect(principal.coachDecision).toBe('Pendiente');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/athletes/${A()}/decisions/${encodeURIComponent(principal.key)}`,
      payload: { coachDecision: 'Aprobada', coachNote: 'probar el sábado' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().decidedOn).toBe(TODAY);

    const again = (await post(`/api/athletes/${A()}/evaluate`, {})).json(); // idempotente
    expect(again.decisions.length).toBe(ev.decisions.length);
    expect(again.decisions.find((d: { key: string }) => d.key === principal.key).coachDecision).toBe(
      'Aprobada',
    );
    expect(await ctx.records.listPlanned(A())).toEqual(planBefore);
  });

  it('molestia reciente ⇒ revisión del coach en squat y sin propuestas ofensivas', async () => {
    const ev = (await post(`/api/athletes/${B()}/evaluate`, {})).json();
    const sq = ev.evaluation.lifts.SQ;
    expect(sq.principal.status).toBe('revision_coach');
    expect(sq.blocked).toBe(true);
    expect(
      sq.results.filter((r: { status: string }) =>
        ['candidato_pr', 'ventana_expresion', 'margen_carga'].includes(r.status),
      ),
    ).toHaveLength(0);
  });

  it('atleta incompleto ⇒ datos insuficientes con faltantes explícitos (nada inventado)', async () => {
    const ev = (await post(`/api/athletes/${C()}/evaluate`, {})).json();
    expect(ev.evaluation.lifts.SQ.principal.status).toBe('datos_insuficientes');
    expect(ev.evaluation.lifts.SQ.principal.missing.length).toBeGreaterThan(0);
    expect(ev.evaluation.lifts.BP.principal.status).toBe('datos_insuficientes');
  });

  it('deterioro intra-sesión con fatiga ⇒ candidato a redistribuir frecuencia (no una ventana)', async () => {
    const ev = (await post(`/api/athletes/${D()}/evaluate`, {})).json();
    expect(ev.evaluation.lifts.SQ.principal.status).toBe('candidato_frecuencia');
    expect(ev.evaluation.lifts.SQ.principal.proposal).toMatch(/MISMO volumen semanal/);
  });

  it('récord de reps con chequeo y revisión vigentes ⇒ candidato a PR "listo", sin probabilidad', async () => {
    const ev = (await post(`/api/athletes/${E()}/evaluate`, {})).json();
    const p = ev.evaluation.lifts.SQ.principal;
    expect(p.status).toBe('candidato_pr');
    expect(p.summary).toMatch(/^Candidato a récord: 155 kg/);
    expect(JSON.stringify(p)).not.toMatch(/probabilidad de éxito: \d/);
  });

  it('el dashboard lista estado principal y decisiones pendientes', async () => {
    await post(`/api/athletes/${A()}/evaluate`, {});
    const rows = await get('/api/athletes');
    const a = rows.find((r: { id: string }) => r.id === A());
    expect(a.lifts.SQ.status).toBe('ventana_expresion');
    expect(a.pendingDecisions).toBeGreaterThan(0);
    expect(a.lastRecord).toBe('2026-03-08');
  });
});

describe('API · versiones del plan e historial automático', () => {
  it('el ajuste de volumen se detectó como UN evento compuesto (18→24 NL) y el seguimiento está pendiente', async () => {
    const h = await get(`/api/athletes/${A()}/history`);
    expect(h.events).toHaveLength(1);
    const ev = h.events[0].event;
    expect(ev.actor).toBeNull();
    expect(ev.effectiveEstimated).toBe(true);
    const sq = ev.changes.find((c: { lift: string }) => c.lift === 'SQ');
    expect(sq.classification).toBe('volumen_aumentado');
    expect(sq.summary).toMatch(/NL semanales 15→20/);
    expect(h.events[0].outcomes[0].state).toBe('pendiente');
    expect(h.events[0].outcomes[0].text).toMatch(/todavía no empezó/);
  });

  it('reimportar el mismo plan no crea versiones ni eventos; los borradores no generan eventos', async () => {
    const planned = (await ctx.records.listActivePlanned(A())).map((s) => ({ ...s }));
    const before = (await get(`/api/athletes/${A()}/plan-versions`)).length;
    const again = (
      await post(`/api/athletes/${A()}/plan`, { sets: planned.reverse(), replace: true })
    ).json();
    expect(again.changed).toBe(false);
    expect((await get(`/api/athletes/${A()}/plan-versions`)).length).toBe(before);

    const edited = planned.map((s) =>
      s.id.endsWith('-1') && s.blockKey === 'ACUM-2' ? { ...s, reps: 6 } : { ...s },
    );
    const draft = (
      await post(`/api/athletes/${A()}/plan`, { sets: edited, status: 'borrador', replace: true })
    ).json();
    expect(draft.status).toBe('borrador');
    expect(draft.event).toBeNull();
    expect((await get(`/api/athletes/${A()}/history`)).events).toHaveLength(1); // sigue 1
    expect((await ctx.records.listActivePlanned(A())).some((s) => s.reps === 6)).toBe(false); // el plan vigente no cambió
    const applied = (
      await post(`/api/athletes/${A()}/plan`, { sets: edited, status: 'aplicado', replace: true })
    ).json();
    expect(applied.changed).toBe(true);
    expect(applied.event).not.toBeNull();
    expect((await get(`/api/athletes/${A()}/history`)).events).toHaveLength(2);
  });

  it('retirar series con ejecución las conserva como historial; sin ejecución se borran', async () => {
    const planned = (await ctx.records.listActivePlanned(B())).map((s) => ({ ...s }));
    const keep = planned.filter((s) => s.lift !== 'SQ' || s.sessionKey !== 'b-sq-B1-1');
    const r = (await post(`/api/athletes/${B()}/plan`, { sets: keep, replace: true })).json();
    expect(r.retired).toBe(3);
    expect((await ctx.records.listActual(B())).length).toBeGreaterThan(0);
    expect((await ctx.records.listPlanned(B())).some((s) => s.sessionKey === 'b-sq-B1-1')).toBe(true); // historial
    expect((await ctx.records.listActivePlanned(B())).some((s) => s.sessionKey === 'b-sq-B1-1')).toBe(false);
  });

  it('el motivo del coach es opcional y se puede agregar después', async () => {
    const h = await get(`/api/athletes/${A()}/history`);
    const id = h.events[0].event.id as string;
    expect(h.events[0].event.coachComment).toBe('');
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/athletes/${A()}/history/${encodeURIComponent(id)}`,
      payload: { coachComment: 'más volumen para el bloque 2' },
    });
    expect(r.statusCode).toBe(200);
    expect((await get(`/api/athletes/${A()}/history`)).events[0].event.coachComment).toBe(
      'más volumen para el bloque 2',
    );
  });
});

describe('API · comparativas, bloques y lecturas del perfil', () => {
  it('compara dos bloques por semana, con planificado y realizado separados', async () => {
    const q = (u: string) =>
      `/api/athletes/${A()}/compare?lift=SQ&a=ACUM-1&b=ACUM-2&universe=${u}&scope=full`;
    const planned = await get(q('planned'));
    const nl = planned.rows.find((r: { key: string }) => r.key === 'nl');
    expect([nl.a, nl.b]).toEqual([15, 20]);
    expect(planned.notes.join(' ')).toMatch(/Universo PLANIFICADO/);
    const actual = await get(q('actual'));
    expect(actual.rows.find((r: { key: string }) => r.key === 'nl').b).toBeNull(); // ACUM-2 aún no se ejecutó
    expect(actual.notes.join(' ')).toMatch(/Universo REALIZADO/);
  });
  it('bloques y familias: TTP censurado (observación incompleta) mientras sigue mejorando', async () => {
    const r = await get(`/api/athletes/${A()}/blocks`);
    const b = r.blocks.find(
      (x: { blockKey: string; lift: string }) => x.lift === 'SQ' && x.blockKey === 'ACUM-1',
    );
    expect(b.ttp.state).toBe('censurado');
    expect(b.ttp.censored).toBe(true);
    expect(r.families.find((f: { familyKey: string }) => f.familyKey === 'acumulacion').pattern).toBe(
      'insuficiente',
    );
  });
  it('carga, rendimiento y sesiones devuelven previsto y real por separado', async () => {
    const load = await get(`/api/athletes/${A()}/load`);
    expect(load.planned.length).toBeGreaterThan(0);
    expect(load.actual.length).toBeGreaterThan(0);
    const perf = await get(`/api/athletes/${A()}/performance`);
    expect(perf.SQ.exposures.length).toBe(6);
    expect(perf.SQ.records.find((x: { reps: number }) => x.reps === 5).kg).toBe(155);
    const ses = await get(`/api/athletes/${A()}/sessions`);
    expect(ses[0].sets[0]).toHaveProperty('planned');
    expect(ses[0].sets[0]).toHaveProperty('actual');
  });
  it('dashboard: tarjetas, prioridades, oportunidades y competencias', async () => {
    for (const id of Object.values(ids)) await post(`/api/athletes/${id}/evaluate`, {});
    const d = await get('/api/dashboard');
    expect(d.cards.active).toBe(7);
    expect(d.cards.needReview).toBeGreaterThanOrEqual(2); // B (molestia) y A (posible fin en peso muerto)
    expect(d.priorities.some((p: { athleteName: string }) => p.athleteName.startsWith('DEMO B'))).toBe(true);
    expect(d.opportunities.length).toBeGreaterThan(0);
    expect(d.competitions.map((c: { daysLeft: number }) => c.daysLeft)).toEqual([25, 60]);
  });
  it('registra feedback de sesión, revisión técnica y competencias', async () => {
    expect(
      (await post(`/api/athletes/${C()}/session-feedback`, { sessionKey: 'c-sq-B1-1', endFatigue: 6 }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await post(`/api/athletes/${C()}/coach-reviews`, {
          lift: 'SQ',
          date: TODAY,
          verdict: 'no_comparable',
          note: 'cambió la profundidad',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(`/api/athletes/${C()}/competitions`, {
          name: 'Nacional',
          date: '2026-06-01',
          phase: 'Peaking',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await post(`/api/athletes/${C()}/session-feedback`, { sessionKey: 'x', endFatigue: 11 })).statusCode,
    ).toBe(400);
    expect(await get(`/api/athletes/${C()}/coach-reviews`)).toHaveLength(1);
  });
  it('una revisión técnica "no comparable" bloquea las propuestas ofensivas', async () => {
    await post(`/api/athletes/${E()}/coach-reviews`, {
      lift: 'SQ',
      date: '2026-03-09',
      verdict: 'no_comparable',
      note: '',
    });
    const ev = (await post(`/api/athletes/${E()}/evaluate`, {})).json();
    expect(ev.evaluation.lifts.SQ.principal.ruleId).toBe('B-TECNICA');
  });
});

describe('API · validación y errores', () => {
  it('rechaza ejecución que no cuelga de una serie prevista (422)', async () => {
    const r = await post(`/api/athletes/${C()}/sets`, {
      sets: [
        { plannedSetId: 'nope', status: 'done', kg: 100, reps: 5, rpe: 8, performedOn: TODAY, pain: null },
      ],
    });
    expect(r.statusCode).toBe(422);
  });
  it('rechaza un plan con ids de serie duplicados (no se fusionan en silencio)', async () => {
    const one = (await ctx.records.listActivePlanned(A()))[0]!;
    const r = await post(`/api/athletes/${A()}/plan`, { sets: [one, one] });
    expect(r.statusCode).toBe(422);
    expect(r.json().details.duplicates).toEqual([one.id]);
  });
  it('rechaza datos inválidos (400) y atleta inexistente (404)', async () => {
    expect((await post('/api/athletes', { name: '' })).statusCode).toBe(400);
    expect((await post('/api/athletes/zzz/evaluate', {})).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/athletes/zzz/history' })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/api/athletes/${A()}/compare?lift=SQ&a=x` })).statusCode,
    ).toBe(400);
  });
  it('rechaza fechas mal formadas y puntajes fuera de rango', async () => {
    expect(
      (
        await post(`/api/athletes/${C()}/checkins`, {
          date: '10/03/2026',
          sleep: 5,
          energy: 5,
          motivation: 5,
          stress: 5,
          pain: 5,
        })
      ).statusCode,
    ).toBe(400);
    expect((await post(`/api/athletes/${C()}/evaluate`, { cutoff: '2026-13-99x' })).statusCode).toBe(400);
  });
});
