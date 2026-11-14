import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { DecisionsRepo } from '../src/repositories/decisions.js';
import { HistoryRepo } from '../src/repositories/history.js';
import { RecordsRepo } from '../src/repositories/records.js';
import { seedDemoData } from '../src/seed/load.js';

const TODAY = '2026-03-10';
let app: FastifyInstance;
let ctx: AppContext;
let ids: Record<string, string>;
const A = () => ids['DEMO A · progresa (sintético)'] as string;
const C = () => ids['DEMO C · incompleto (sintético)'] as string;
const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();
const post = (url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, payload: payload as object });
const put = (url: string, payload: unknown) => app.inject({ method: 'PUT', url, payload: payload as object });

beforeEach(async () => {
  ctx = await buildContext({ ...loadConfig({}), dbPath: ':memory:' }, await openDb(':memory:'), () => TODAY);
  app = await buildApp(ctx);
  ids = await seedDemoData(ctx);
});

/* ---------- datos SINTÉTICOS ---------- */
const HEAD =
  'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe';
const hv = (start: string, ex: string, i: number, type: string, kg: string, reps: string, rpe = '') =>
  `Entreno,"${start}",,,${ex},,,${i},${type},${kg},${reps},,,${rpe}`;
const HEVY = [
  HEAD,
  hv('2 mar 2026, 18:00', 'Squat (Barbell)', 0, 'warmup', '60', '5'),
  hv('2 mar 2026, 18:00', 'Squat (Barbell)', 1, 'normal', '140', '5'),
  hv('2 mar 2026, 18:00', 'Squat (Barbell)', 2, 'normal', '140', '5'),
  hv('4 mar 2026, 18:00', 'Squat (Barbell)', 1, 'normal', '145', '5'),
  hv('4 mar 2026, 18:00', 'Squat (Barbell)', 2, 'normal', '145', '3'),
  hv('4 mar 2026, 18:00', 'Squat (Barbell)', 3, 'normal', '185', '1'),
  hv('4 mar 2026, 18:00', 'Row (Dumbbell)', 1, 'normal', '30', '10'),
].join('\n');

describe('Migración 003: compatibilidad con datos del esquema anterior', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'migrations');
  async function legacyDb() {
    const db = await openDb(':memory:', { migrate: false });
    await db.exec(
      'PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    for (const f of ['001_init.sql', '002_stages_2_4.sql']) {
      await db.exec(readFileSync(join(dir, f), 'utf8'));
      await db.run('INSERT INTO schema_migrations VALUES (?, ?)', f, 'x');
    }
    await db.run(
      "INSERT INTO athletes (id,name,competition_exercises,created_at) VALUES ('a','Legacy','{\"SQ\":\"Squat comp\"}','x')",
    );
    const ins = (...p: (string | number | null)[]) =>
      db.run(
        "INSERT INTO planned_sets (id,athlete_id,session_key,slot_key,exercise_name,lift,planned_date,set_no,reps,target_rpe,planned_kg,is_warmup,block_key,week_no,day_no,family_key,ref_kg) VALUES (?,'a',?,?,?,?,?,1,5,8,?,0,'B1',1,1,'F1',180)",
        ...p,
      );
    await ins('s1', 'k1', 'squat-comp|D1', 'Squat comp', 'SQ', '2026-03-02', 150);
    await ins('s2', 'k2', 'squat-comp|D3', 'Squat comp', 'SQ', '2026-03-04', null);
    await db.run(
      "INSERT INTO actual_sets (athlete_id,planned_set_id,status,kg,reps,rpe,performed_on,updated_at) VALUES ('a','s1','done',150,5,8,'2026-03-02','x')",
    );
    const old = {
      key: 'SQ|squat-comp|D1|R-LOAD|2026-03-02|reglas-v0.1-propuesta',
      evaluatedOn: '2026-03-03',
      dataUntil: '2026-03-02',
      lift: 'SQ',
      slotKey: 'squat-comp|D1',
      status: 'margen_carga',
      ruleId: 'R-LOAD',
      rulesVersion: 'reglas-v0.1-propuesta',
      rank: 5,
      isPrincipal: true,
      summary: 'x',
      evidence: [],
      missing: [],
      alternatives: [],
      proposal: '',
      reviewWhen: '',
      confidence: 'Moderada',
      validity: 'vigente',
      expiryReason: '',
      coachDecision: 'Aprobada',
      coachNote: 'ok',
      decidedOn: '2026-03-03',
      support: [],
      paramsText: '',
      readiness: '',
    };
    await db.run(
      "INSERT INTO decisions (athlete_id,key,lift,rule_id,validity,coach_decision,evaluated_on,payload) VALUES ('a',?,'SQ','R-LOAD','vigente','Aprobada','2026-03-03',?)",
      old.key,
      JSON.stringify(old),
    );
    await db.run(
      "INSERT INTO evaluations (athlete_id,cutoff,rules_version,payload) VALUES ('a','2026-03-03','reglas-v0.1-propuesta',?)",
      JSON.stringify({
        cutoff: '2026-03-03',
        rulesVersion: 'reglas-v0.1-propuesta',
        lifts: {},
        blocks: [],
        families: [],
      }),
    );
    const oldSet = {
      id: 's1',
      sessionKey: 'k1',
      slotKey: 'squat-comp|D1',
      exerciseName: 'Squat comp',
      lift: 'SQ',
      plannedDate: '2026-03-02',
      setNo: 1,
      reps: 5,
      targetRpe: 8,
      plannedKg: 150,
      isWarmup: false,
      blockKey: 'B1',
      weekNo: 1,
      dayNo: 1,
      familyKey: 'F1',
      refKg: 180,
    };
    await db.run(
      "INSERT INTO plan_versions (id,athlete_id,seq,status,detected_on,effective_on,label,fingerprint,content) VALUES ('v1','a',1,'aplicado','2026-03-01',NULL,'','x',?)",
      JSON.stringify([oldSet]),
    );
    return db;
  }
  it('conserva todo: cada slot antiguo pasa a ser su PROPIA identidad (legacy_slot), sin fusiones por inferencia', async () => {
    const db = await legacyDb();
    expect(await runMigrations(db)).toEqual([
      '003_consolidacion.sql',
      '004_handoff.sql',
      '005_portal_atleta.sql',
      '006_notas_atleta.sql',
      '007_coach_y_tiempo_real.sql',
      '008_checkin_extras.sql',
      '009_perfil_competencias_biblioteca.sql',
    ]);
    const recs = new RecordsRepo(db);
    const sets = await recs.listPlanned('a');
    expect(sets.map((s) => [s.id, s.exposureId, s.variantKey, s.plannedKgSource])).toEqual([
      ['s1', 'squat-comp|D1', 'Squat comp', 'fixed'],
      ['s2', 'squat-comp|D3', 'Squat comp', null],
    ]);
    expect(await recs.identitySource('a', 'squat-comp|D1')).toBe('legacy_slot');
    expect(await recs.listActual('a')).toHaveLength(1); // la ejecución sigue intacta
    expect(await runMigrations(db)).toEqual([]); // idempotente
  });
  it('lee decisiones guardadas con el esquema anterior y las traduce (slot→exposición, confianza→suficiencia, decisión→ciclo)', async () => {
    const db = await legacyDb();
    await runMigrations(db);
    const [d] = await new DecisionsRepo(db).list('a');
    expect(d).toMatchObject({
      exposureId: 'squat-comp|D1',
      sufficiency: 'suficiente',
      lifecycle: 'aceptada',
      coachDecision: 'Aprobada',
      paramsVersion: 'params-v1',
      detectedOn: '2026-03-03',
      interventionId: null,
    });
    expect(d).not.toHaveProperty('confidence');
    expect(d!.coachNote).toBe('ok'); // la nota y la fecha de decisión del coach no se pierden
    expect(d!.decidedOn).toBe('2026-03-03');
  });
  it('una evaluación del esquema anterior se trata como obsoleta (hay que reevaluar) y los snapshots se actualizan al leerlos', async () => {
    const db = await legacyDb();
    await runMigrations(db);
    const dec = new DecisionsRepo(db);
    expect(await dec.latestEvaluation('a')).toBeNull();
    expect(await dec.hasLegacyEvaluation('a')).toBe(true);
    const v = (await new HistoryRepo(db).listVersions('a'))[0]!;
    expect(v.sets[0]).toMatchObject({
      exposureId: 'squat-comp|D1',
      variantKey: 'Squat comp',
      plannedKgSource: 'fixed',
      protocol: null,
      copiedFrom: null,
    });
  });
  it('reimportar con una identidad declarada distinta la reclasifica; con la misma, conserva el origen legacy', async () => {
    const db = await legacyDb();
    await runMigrations(db);
    const recs = new RecordsRepo(db);
    const [a] = await recs.listPlanned('a');
    await recs.upsertPlanned('a', [a!]);
    expect(await recs.identitySource('a', 'squat-comp|D1')).toBe('legacy_slot');
    await recs.upsertPlanned('a', [{ ...a!, exposureId: 'squat-primaria' }]);
    expect(await recs.identitySource('a', 'squat-primaria')).toBe('declarada');
  });
});

describe('Importación de Hevy: dry-run, confirmación e idempotencia', () => {
  const imp = (body: Record<string, unknown>) =>
    post(`/api/athletes/${C()}/imports/hevy`, { csv: HEVY, ...body });
  it('el dry-run no escribe nada y describe qué se importaría', async () => {
    const r = (await imp({ mode: 'dry_run' })).json();
    expect(r.mode).toBe('dry_run');
    expect(r.applied).toBeNull();
    expect(r.preview).toMatchObject({
      newRows: 7,
      rejected: 0,
      sessions: 2,
      dateRange: { from: '2026-03-02', to: '2026-03-04' },
      withRpe: 0,
    });
    expect(r.preview.unmappedExercises).toEqual([{ title: 'Row (Dumbbell)', sets: 1 }]);
    expect(r.preview.dateInterpretation).toMatch(/hora local escrita/);
    expect(await ctx.observed.list(C())).toHaveLength(0);
  });
  it('aplicar exige confirmar exactamente lo que se vio (token)', async () => {
    const dry = (await imp({ mode: 'dry_run' })).json();
    const sin = await imp({ mode: 'apply' });
    expect(sin.statusCode).toBe(422);
    expect(sin.json().details.expectedToken).toBe(dry.preview.token);
    expect((await imp({ mode: 'apply', confirmToken: 'otro' })).statusCode).toBe(422);
    expect(await ctx.observed.list(C())).toHaveLength(0);
    const ok = (await imp({ mode: 'apply', confirmToken: dry.preview.token })).json();
    expect(ok.applied).toMatchObject({ inserted: 7, ignored: 0 });
    expect(await ctx.observed.list(C())).toHaveLength(7);
  });
  it('reimportar el mismo archivo no duplica; un archivo con filas nuevas suma solo las nuevas', async () => {
    const t = (await imp({ mode: 'dry_run' })).json().preview.token;
    await imp({ mode: 'apply', confirmToken: t });
    const again = (await imp({ mode: 'dry_run' })).json();
    expect(again.preview).toMatchObject({ newRows: 0, duplicatesExisting: 7 });
    const more = HEVY + '\n' + hv('6 mar 2026, 18:00', 'Squat (Barbell)', 1, 'normal', '150', '5');
    const d2 = (await imp({ csv: more, mode: 'dry_run' })).json();
    expect(d2.preview.newRows).toBe(1);
    const a2 = (await imp({ csv: more, mode: 'apply', confirmToken: d2.preview.token })).json();
    expect(a2.applied.inserted).toBe(1);
    expect(await ctx.observed.list(C())).toHaveLength(8);
    expect((await get(`/api/athletes/${C()}/imports`)).length).toBe(2);
  });
  it('no deduce prescripción ni descanso de lo ejecutado: el plan y las versiones quedan intactos', async () => {
    const plannedBefore = (await ctx.records.listPlanned(C())).length;
    const versionsBefore = (await ctx.history.listVersions(C())).length;
    const t = (await imp({ mode: 'dry_run' })).json().preview.token;
    await imp({ mode: 'apply', confirmToken: t });
    expect((await ctx.records.listPlanned(C())).length).toBe(plannedBefore);
    expect((await ctx.history.listVersions(C())).length).toBe(versionsBefore);
  });
  it('un archivo que no es de Hevy falla con mensaje claro y 404 si el atleta no existe', async () => {
    const r = await imp({ csv: 'a,b\n1,2', mode: 'apply', confirmToken: 'x' });
    expect(r.statusCode).toBe(422);
    expect(JSON.stringify(r.json())).toMatch(/Faltan columnas obligatorias/);
    expect((await post('/api/athletes/zzz/imports/hevy', { csv: HEVY })).statusCode).toBe(404);
  });
  it('lo importado alimenta métricas y récords SIN RPE: NL, series, tonelaje, e1RM por fórmulas; e1RM por curva se abstiene', async () => {
    const t = (await imp({ mode: 'dry_run' })).json().preview.token;
    await imp({ mode: 'apply', confirmToken: t });
    const m = (await get(`/api/athletes/${C()}/metrics?from=2026-03-01&to=2026-03-31&lift=SQ&source=hevy`))
      .metrics;
    expect(m.nl).toMatchObject({ status: 'available', value: 5 + 5 + 5 + 3 + 1 }); // sin calentamiento
    expect(m.tonnage.value).toBe(140 * 10 + 145 * 5 + 145 * 3 + 185);
    expect(m.e1rm_prg_formulas.status).toBe('available');
    expect(m.e1rm_table_rpe).toMatchObject({ status: 'unavailable', value: null });
    expect(m.e1rm_table_rpe.missing).toContain('RPE real');
    const rec = (await get(`/api/athletes/${C()}/records?source=hevy`)).records;
    expect(
      rec.find((r: { type: string; key: string }) => r.type === 'single' && r.key === 'reps=1').value,
    ).toBe(185);
    expect(
      rec
        .filter((r: { type: string }) => r.type === 'best_e1rm')
        .every((r: { isRealPR: boolean }) => !r.isRealPR),
    ).toBe(true);
    const mus = await get(`/api/athletes/${C()}/weekly-muscles?from=2026-03-02&to=2026-03-08&source=hevy`);
    // 'Row (Dumbbell)' ya está en la convención v2 (remo: dorsales y espalda alta directos)
    expect(mus.unmappedExercises).toEqual([]);
    expect(mus.rows.some((r: { muscle: string }) => r.muscle === 'dorsales')).toBe(true);
  });
});

describe('Referencias de fuerza fechadas', () => {
  it('el cálculo original usa la referencia vigente a cada fecha; el retrospectivo se rotula y no reescribe', async () => {
    const t = (await post(`/api/athletes/${C()}/imports/hevy`, { csv: HEVY, mode: 'dry_run' })).json().preview
      .token;
    await post(`/api/athletes/${C()}/imports/hevy`, { csv: HEVY, mode: 'apply', confirmToken: t });
    expect(
      (
        await post(`/api/athletes/${C()}/references`, {
          exerciseName: 'Squat (Barbell)',
          kg: 180,
          source: 'test',
          asOf: '2026-01-10',
        })
      ).statusCode,
    ).toBe(201);
    await post(`/api/athletes/${C()}/references`, {
      exerciseName: 'Squat (Barbell)',
      kg: 190,
      source: 'competencia',
      asOf: '2026-03-04',
    });
    const q = (mode: string) =>
      `/api/athletes/${C()}/metrics?from=2026-03-01&to=2026-03-31&lift=SQ&source=hevy&referenceMode=${mode}`;
    const orig = (await get(q('original'))).metrics.intensity_rel;
    const retro = (await get(q('retrospective'))).metrics.intensity_rel;
    expect(orig.method.version).toBe('v1');
    expect(retro.method.version).toBe('v1:retrospectivo');
    expect(retro.warnings.join(' ')).toMatch(/RETROSPECTIVO/);
    expect(orig.value).not.toBeCloseTo(retro.value, 3);
    expect(retro.reference).toMatchObject({ source: 'competencia', asOf: '2026-03-04', kg: 190 });
    expect((await get(`/api/athletes/${C()}/references`)).length).toBe(2);
  });
  it('rechaza una referencia no positiva o con fecha inválida', async () => {
    expect(
      (
        await post(`/api/athletes/${C()}/references`, {
          exerciseName: 'x',
          kg: -5,
          source: 'test',
          asOf: '2026-01-10',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(`/api/athletes/${C()}/references`, {
          exerciseName: 'x',
          kg: 100,
          source: 'test',
          asOf: '10/01/2026',
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('Programación canónica por CSV', () => {
  const H = 'block,week,date,exercise,protocol,exposure_id,lift,ref_kg,family';
  const plan = (...rows: string[]) => [H, ...rows].join('\n');
  it('dry-run con disponibilidad, errores por línea y token; apply crea UNA versión y es idempotente', async () => {
    const good = plan(
      'B9,1,2026-04-06,Squat comp,3x5@8,sq-primaria,SQ,180,F9',
      'B9,1,2026-04-08,Bench comp,3x5@8,bp-primaria,BP,,F9',
    );
    const dry = (await post(`/api/athletes/${C()}/imports/plan-csv`, { csv: good })).json();
    expect(dry.mode).toBe('dry_run');
    expect(dry.parse).toMatchObject({ ok: true, summary: { sets: 6, sessions: 2 } });
    const bp = dry.parse.availability.find((a: { lift: string }) => a.lift === 'BP');
    expect(bp.metrics.find((m: { id: string }) => m.id === 'tonnage').status).toBe('unavailable'); // banca sin referencia: no hay carga prevista
    const versionsBefore = (await ctx.history.listVersions(C())).length;
    expect((await ctx.history.listVersions(C())).length).toBe(versionsBefore); // el dry-run no crea versiones
    expect(
      (await post(`/api/athletes/${C()}/imports/plan-csv`, { csv: good, mode: 'apply' })).statusCode,
    ).toBe(422);
    const ok = (
      await post(`/api/athletes/${C()}/imports/plan-csv`, {
        csv: good,
        mode: 'apply',
        confirmToken: dry.token,
      })
    ).json();
    expect(ok.applied).toMatchObject({ changed: true });
    expect((await ctx.history.listVersions(C())).length).toBe(versionsBefore + 1); // UNA versión
    expect((await ctx.records.listActivePlanned(C())).filter((s) => s.blockKey === 'B9')).toHaveLength(6);
    const again = (
      await post(`/api/athletes/${C()}/imports/plan-csv`, {
        csv: good,
        mode: 'apply',
        confirmToken: dry.token,
      })
    ).json();
    expect(again.applied.changed).toBe(false);
  });
  it('un plan con errores no se aplica y muestra la línea y el motivo (no infiere fechas)', async () => {
    const bad = plan('B9,1,,Squat comp,3x5@8,sq,SQ,,', 'B9,1,2026-04-06,Squat comp,hacer 5,sq,SQ,,');
    const dry = (await post(`/api/athletes/${C()}/imports/plan-csv`, { csv: bad })).json();
    expect(dry.parse.ok).toBe(false);
    expect(dry.parse.errors.map((e: { line: number }) => e.line)).toEqual([2, 3]);
    expect(
      (
        await post(`/api/athletes/${C()}/imports/plan-csv`, {
          csv: bad,
          mode: 'apply',
          confirmToken: dry.token,
        })
      ).statusCode,
    ).toBe(422);
  });
});

describe('Parámetros: validación contra el registro', () => {
  it('rechaza valores fuera de rango y acepta paso de carga por lift', async () => {
    const bad = await put(`/api/athletes/${C()}/params`, { windowDays: 3 });
    expect(bad.statusCode === 400 || bad.statusCode === 422).toBe(true);
    const ok = await put(`/api/athletes/${C()}/params`, {
      perLift: { SQ: { stepKg: 5, minChangePct: 1.5 } },
      prRpe: 8.5,
    });
    expect(ok.statusCode).toBe(200);
    const r = (await post(`/api/athletes/${C()}/evaluate`, {})).json();
    expect(r.evaluation.paramsVersion).toBe('params-v2');
  });
  it('informa qué configuración esencial falta y qué interpretación queda suspendida, sin apagar las métricas', async () => {
    const st = await get(`/api/athletes/${C()}/state`);
    expect(st.missingConfig.map((m: { lift: string }) => m.lift).sort()).toEqual(['BP', 'DL', 'SQ']);
    expect(st.missingConfig[0].suspends.join(' ')).toMatch(/R-PROGRESS/);
  });
});

describe('Intervenciones: hallazgo → propuesta → decisión → aplicación → seguimiento', () => {
  const principalBp = async () => {
    const ev = (await post(`/api/athletes/${A()}/evaluate`, {})).json();
    return ev.decisions.find(
      (d: { lift: string; isPrincipal: boolean }) => d.lift === 'BP' && d.isPrincipal,
    ) as { key: string; lifecycle: string };
  };
  it('aceptar NO es aplicar; cada hito conserva su fecha; reevaluar no duplica ni borra', async () => {
    const p = await principalBp();
    expect(p.lifecycle).toBe('detectada');
    const i1 = (await post(`/api/athletes/${A()}/interventions`, { proposalKey: p.key })).json();
    const i2 = (await post(`/api/athletes/${A()}/interventions`, { proposalKey: p.key })).json();
    expect(i2.id).toBe(i1.id); // una propuesta, una intervención (idempotente)
    const acc = await post(`/api/athletes/${A()}/interventions/${i1.id}/transition`, {
      to: 'aceptada',
      on: '2026-03-11',
      note: 'probar el sábado',
    });
    expect(acc.json()).toMatchObject({ state: 'aceptada', decidedOn: '2026-03-11', appliedOn: null });
    let dec = (await get(`/api/athletes/${A()}/decisions`)).find((d: { key: string }) => d.key === p.key);
    expect(dec).toMatchObject({
      lifecycle: 'aceptada',
      coachDecision: 'Aprobada',
      interventionId: i1.id,
      decidedOn: '2026-03-11',
    });
    const ap = await post(`/api/athletes/${A()}/interventions/${i1.id}/transition`, {
      to: 'aplicada',
      on: '2026-03-14',
      appliedOn: '2026-03-13',
      appliedDescription: 'subí 5 kg en lugar de 2,5',
      deviatesFromProposal: true,
    });
    expect(ap.json()).toMatchObject({
      state: 'aplicada',
      decidedOn: '2026-03-11',
      appliedOn: '2026-03-13',
      deviatesFromProposal: true,
    });
    const before = (await get(`/api/athletes/${A()}/decisions`)).length;
    await post(`/api/athletes/${A()}/evaluate`, {});
    const decs = await get(`/api/athletes/${A()}/decisions`);
    expect(decs.length).toBe(before);
    dec = decs.find((d: { key: string }) => d.key === p.key);
    expect(dec).toMatchObject({ lifecycle: 'aplicada', interventionId: i1.id });
  });
  it('seguimiento pendiente hasta que haya exposiciones posteriores y nunca afirma causalidad', async () => {
    const p = await principalBp();
    const i = (await post(`/api/athletes/${A()}/interventions`, { proposalKey: p.key })).json();
    await post(`/api/athletes/${A()}/interventions/${i.id}/transition`, { to: 'aceptada', on: '2026-03-10' });
    await post(`/api/athletes/${A()}/interventions/${i.id}/transition`, {
      to: 'aplicada',
      on: '2026-03-10',
      appliedOn: '2026-03-10',
      appliedDescription: 'ok',
    });
    const list = await get(`/api/athletes/${A()}/interventions`);
    expect(list[0].intervention.state).toBe('seguimiento'); // la aplicación llegó: el seguimiento arranca solo
    expect(list[0].followUp.state).toBe('pendiente');
    expect(list[0].followUp.text).toMatch(/No se evalúa todavía/);
    expect(JSON.stringify(list)).not.toMatch(/produjo|causó|gracias a/i);
  });
  it('registra una intervención sin propuesta previa, la vincula con una modificación del plan y rechaza transiciones incoherentes', async () => {
    const m = (
      await post(`/api/athletes/${A()}/interventions`, {
        lift: 'SQ',
        appliedOn: '2026-03-09',
        appliedDescription: 'sumé una serie',
        on: '2026-03-09',
      })
    ).json();
    expect(m).toMatchObject({ origin: 'manual', proposalKey: null, state: 'aplicada', detectedOn: null });
    const evId = (await get(`/api/athletes/${A()}/history`)).events[0].event.id as string;
    const linked = (await post(`/api/athletes/${A()}/interventions/${m.id}/link`, { eventId: evId })).json();
    expect(linked.linkedEventId).toBe(evId);
    expect(
      (await post(`/api/athletes/${A()}/interventions/${m.id}/link`, { eventId: 'nope' })).statusCode,
    ).toBe(404);
    expect(
      (await post(`/api/athletes/${A()}/interventions/${m.id}/transition`, { to: 'aceptada' })).statusCode,
    ).toBe(422);
    expect((await post(`/api/athletes/${A()}/interventions`, { proposalKey: 'no-existe' })).statusCode).toBe(
      404,
    );
    expect((await post(`/api/athletes/${A()}/interventions`, {})).statusCode).toBe(422); // manual sin lift
  });
  it('el endpoint de decisión anterior sigue funcionando y se traduce al ciclo de vida', async () => {
    const p = await principalBp();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/athletes/${A()}/decisions/${encodeURIComponent(p.key)}`,
      payload: { coachDecision: 'Aprobada', coachNote: 'x' },
    });
    expect(r.json()).toMatchObject({ lifecycle: 'aceptada', coachDecision: 'Aprobada' });
  });
});

describe('Operaciones de programación', () => {
  const op = (body: Record<string, unknown>) => post(`/api/athletes/${A()}/program`, body);
  const counts = async () => ({
    planned: (await ctx.records.listActivePlanned(A())).length,
    versions: (await ctx.history.listVersions(A())).length,
    events: (await ctx.history.listEvents(A())).length,
    actual: (await ctx.records.listActual(A())).length,
  });
  const dup = {
    type: 'duplicate_session',
    sessionKey: 'a-sq-ACUM-1-1',
    newSessionKey: 'a-sq-extra',
    plannedDate: '2026-03-12',
    dayNo: 4,
  };
  it('la vista previa NO guarda nada y trae diferencias y disponibilidad', async () => {
    const before = await counts();
    const r = (await op({ mode: 'preview', op: dup })).json();
    expect(r.mode).toBe('preview');
    expect(r.saved).toBeNull();
    expect(r.preview.addedSets).toBe(3);
    expect(r.preview.availability.length).toBeGreaterThan(0);
    expect(await counts()).toEqual(before);
  });
  it('un borrador no modifica el plan vigente ni genera eventos; aplicar genera UNA versión y UN evento', async () => {
    const before = await counts();
    const d = (await op({ mode: 'draft', op: dup })).json();
    expect(d.saved.status).toBe('borrador');
    expect((await counts()).planned).toBe(before.planned);
    expect((await counts()).events).toBe(before.events);
    const a = (await op({ mode: 'apply', op: dup, label: 'copia' })).json();
    expect(a.saved).toMatchObject({ changed: true, status: 'aplicado' });
    const after = await counts();
    expect(after.planned).toBe(before.planned + 3);
    expect(after.events).toBe(before.events + 1);
    expect(after.actual).toBe(before.actual); // no se copian resultados
    const copied = (await ctx.records.listActivePlanned(A())).filter((s) => s.sessionKey === 'a-sq-extra');
    expect(
      copied.every(
        (s) => s.copiedFrom !== null && s.exposureId === 'sq-primaria' && s.id.startsWith('a-sq-extra-'),
      ),
    ).toBe(true);
    expect(new Set(copied.map((s) => s.id)).size).toBe(3);
    expect((await ctx.records.listActual(A())).some((x) => x.plannedSetId.startsWith('a-sq-extra'))).toBe(
      false,
    );
  });
  it('nunca sobrescribe programación existente sin confirmación explícita', async () => {
    const dupExisting = await op({ mode: 'apply', op: { ...dup, newSessionKey: 'a-sq-ACUM-1-2' } });
    expect(dupExisting.statusCode).toBe(422);
    const wk = { type: 'repeat_week', blockKey: 'ACUM-1', sourceWeek: 1, targetWeek: 2 };
    const r = await op({ mode: 'apply', op: wk });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toMatch(/no se sobrescribe/);
    const prev = (await op({ mode: 'preview', op: { ...wk, replaceExisting: true } })).json();
    expect(prev.preview.overwrites).toBeGreaterThan(0);
  });
  it('cambiar protocolos exige una selección explícita y toca solo los destinos', async () => {
    expect(
      (await op({ mode: 'apply', op: { type: 'change_protocol', selection: {}, change: { reps: 3 } } }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await op({
          mode: 'apply',
          op: { type: 'change_protocol', selection: { sessionKeys: ['zzz'] }, change: { reps: 3 } },
        })
      ).statusCode,
    ).toBe(422);
    const before = await ctx.records.listActivePlanned(A());
    const r = (
      await op({
        mode: 'apply',
        op: { type: 'change_protocol', selection: { sessionKeys: ['a-sq-ACUM-2-f1'] }, change: { reps: 6 } },
      })
    ).json();
    expect(r.saved.changed).toBe(true);
    const after = await ctx.records.listActivePlanned(A());
    expect(after.filter((s) => s.reps === 6).every((s) => s.sessionKey === 'a-sq-ACUM-2-f1')).toBe(true);
    expect(after.filter((s) => s.sessionKey !== 'a-sq-ACUM-2-f1').map((s) => s.reps)).toEqual(
      before.filter((s) => s.sessionKey !== 'a-sq-ACUM-2-f1').map((s) => s.reps),
    );
  });
  it('plantillas: guardar una semana y aplicarla a otro bloque con ids nuevos e identidad conservada', async () => {
    const t = (
      await post(`/api/athletes/${A()}/templates`, { name: 'Semana tipo', blockKey: 'ACUM-1', weekNo: 1 })
    ).json();
    expect((await get(`/api/athletes/${A()}/templates`))[0].name).toBe('Semana tipo');
    const r = (
      await op({
        mode: 'apply',
        op: {
          type: 'apply_template',
          templateId: t.id,
          blockKey: 'NUEVO',
          weekNo: 1,
          startDate: '2026-06-01',
          familyKey: 'F-nueva',
        },
      })
    ).json();
    expect(r.saved.changed).toBe(true);
    const nuevos = (await ctx.records.listActivePlanned(A())).filter((s) => s.blockKey === 'NUEVO');
    expect(nuevos).toHaveLength(3);
    expect(
      nuevos.every(
        (s) =>
          s.exposureId === 'sq-primaria' &&
          s.copiedFrom === null &&
          s.familyKey === 'F-nueva' &&
          s.plannedDate === '2026-06-01',
      ),
    ).toBe(true);
    expect(
      (
        await op({
          mode: 'apply',
          op: {
            type: 'apply_template',
            templateId: t.id,
            blockKey: 'NUEVO',
            weekNo: 1,
            startDate: '2026-06-01',
          },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await op({
          mode: 'preview',
          op: { type: 'apply_template', templateId: 'x', blockKey: 'N', weekNo: 1, startDate: '2026-06-01' },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('mover una sesión cambia la ubicación pero conserva ids e identidad', async () => {
    const before = (await ctx.records.listActivePlanned(A())).filter((s) => s.sessionKey === 'a-sq-ACUM-1-6');
    await op({
      mode: 'apply',
      op: {
        type: 'move_session',
        sessionKey: 'a-sq-ACUM-1-6',
        plannedDate: '2026-03-09',
        dayNo: 2,
        slotKey: 'squat-comp|D2',
      },
    });
    const after = (await ctx.records.listActivePlanned(A())).filter((s) => s.sessionKey === 'a-sq-ACUM-1-6');
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
    expect(
      after.every((s) => s.exposureId === 'sq-primaria' && s.dayNo === 2 && s.plannedDate === '2026-03-09'),
    ).toBe(true);
    const ex = await get(`/api/athletes/${A()}/exposures/sq-primaria`);
    expect(
      ex.sessions.find((s: { sessionKey: string }) => s.sessionKey === 'a-sq-ACUM-1-6').location.slotKey,
    ).toBe('squat-comp|D2');
  });
});

describe('Vínculos explícitos entre identidades de exposición', () => {
  it('dos identidades separadas se evalúan por separado; un vínculo EXPLÍCITO las une y sin él nada se fusiona', async () => {
    const created = (await post('/api/athletes', { name: 'Vínculos' })).json().id as string;
    await put(`/api/athletes/${created}/params`, {
      perLift: { SQ: { minChangePct: 1.5, minChangeKg: 2.5 } },
    });
    const mk = (exp: string, k: string, dates: string[], kgs: number[]) =>
      dates.flatMap((d, i) =>
        [1, 2, 3].map((n) => ({
          id: `${k}${i}-${n}`,
          sessionKey: `${k}${i}`,
          slotKey: `${exp}|x`,
          exposureId: exp,
          exerciseName: 'Squat comp',
          lift: 'SQ',
          plannedDate: d,
          setNo: n,
          reps: 5,
          targetRpe: 8,
          plannedKg: kgs[i],
          blockKey: 'B1',
          weekNo: 1,
          dayNo: 1,
          familyKey: 'F1',
        })),
      );
    const sets = [
      ...mk('sq-lunes', 'a', ['2026-02-02', '2026-02-09', '2026-02-16'], [145, 147.5, 150]),
      ...mk('sq-jueves', 'b', ['2026-02-23', '2026-03-02', '2026-03-09'], [152.5, 155, 157.5]),
    ];
    expect((await post(`/api/athletes/${created}/plan`, { sets })).statusCode).toBe(200);
    const actual = sets.map((s) => ({
      plannedSetId: s.id,
      status: 'done',
      kg: s.plannedKg,
      reps: 5,
      rpe: 8,
      performedOn: s.plannedDate,
      pain: null,
    }));
    expect((await post(`/api/athletes/${created}/sets`, { sets: actual })).statusCode).toBe(200);
    const ev1 = (await post(`/api/athletes/${created}/evaluate`, {})).json();
    const prog = (e: typeof ev1) =>
      e.evaluation.lifts.SQ.results.filter((r: { ruleId: string }) => r.ruleId === 'R-PROGRESS');
    expect(prog(ev1)).toHaveLength(2); // dos identidades: nada se fusiona por inferencia
    expect(prog(ev1).every((r: { status: string }) => r.status !== 'progreso_sostenido')).toBe(true);
    expect(
      (
        await put(`/api/athletes/${created}/exposure-links`, {
          from: 'sq-jueves',
          to: 'sq-lunes',
          note: 'la misma exposición movida de día',
        })
      ).statusCode,
    ).toBe(200);
    const ev2 = (await post(`/api/athletes/${created}/evaluate`, {})).json();
    expect(prog(ev2)).toHaveLength(1);
    expect(prog(ev2)[0].status).toBe('progreso_sostenido');
    expect((await get(`/api/athletes/${created}/exposure-links`))[0]).toMatchObject({
      from: 'sq-jueves',
      to: 'sq-lunes',
    });
    expect(
      (
        await app.inject({ method: 'DELETE', url: `/api/athletes/${created}/exposure-links/sq-jueves` })
      ).json().removed,
    ).toBe(true);
  });
});

describe('Consultas para el frontend', () => {
  it('estado multidimensional con las cinco dimensiones, conclusión principal y explicación en cada hallazgo', async () => {
    await post(`/api/athletes/${A()}/evaluate`, {});
    const st = await get(`/api/athletes/${A()}/state`);
    expect(st.paramsVersion).toBe('params-v2');
    const sq = st.lifts.SQ;
    expect(sq.dimensions.map((d: { id: string }) => d.id)).toEqual([
      'rendimiento',
      'recuperacion',
      'respuesta',
      'oportunidades',
      'calidad_datos',
    ]);
    expect(sq.principal.key).toBeTruthy();
    const dec = (await get(`/api/athletes/${A()}/decisions`)).find(
      (d: { isPrincipal: boolean; lift: string }) => d.isPrincipal && d.lift === 'SQ',
    );
    expect(dec.explanation).toMatchObject({
      ruleVersion: 'reglas-v0.2-propuesta',
      paramsVersion: 'params-v2',
    });
    expect(dec.assessment).toHaveProperty('sufficiency');
    expect(dec).not.toHaveProperty('confidence');
  });
  it('evidencia de una recomendación: abre las sesiones y registros usados', async () => {
    const ev = (await post(`/api/athletes/${A()}/evaluate`, {})).json();
    const p = ev.decisions.find(
      (d: { isPrincipal: boolean; lift: string }) => d.isPrincipal && d.lift === 'SQ',
    );
    const r = await get(`/api/athletes/${A()}/recommendations/${encodeURIComponent(p.key)}/evidence`);
    expect(r.records.length).toBeGreaterThan(0);
    expect(r.records.find((x: { ref: { kind: string } }) => x.ref.kind === 'session').sets[0]).toHaveProperty(
      'planned',
    );
    expect(
      (await app.inject({ method: 'GET', url: `/api/athletes/${A()}/recommendations/zzz/evidence` }))
        .statusCode,
    ).toBe(404);
  });
  it('catálogo y matriz de disponibilidad', async () => {
    const c = await get('/api/catalog');
    expect(c.metrics.length).toBeGreaterThan(20);
    expect(c.availability.find((a: { id: string }) => a.id === 'e1rm_table_rpe').abstention).toMatch(
      /Sin RPE real/,
    );
    expect(c.metrics.find((m: { id: string }) => m.id === 'ctl_atl').implementation).toBe(
      'disputada_no_implementada',
    );
  });
  it('resumen semanal por movimiento (previsto y realizado separados) y semana actual vs anterior', async () => {
    const w = await get(`/api/athletes/${A()}/weekly?from=2026-03-02&to=2026-03-15`);
    const sq = w.filter((r: { movement: { lift: string } }) => r.movement.lift === 'SQ');
    expect(sq.some((r: { planned: unknown; actual: { nl?: unknown } }) => r.planned && r.actual.nl)).toBe(
      true,
    );
    expect(w.some((r: { week: { partial: boolean } }) => r.week.partial)).toBe(true);
    const future = w.find(
      (r: { week: { from: string }; movement: { lift: string } }) =>
        r.week.from === '2026-03-09' && r.movement.lift === 'SQ',
    );
    expect(future.planned).not.toBeNull(); // la programación de la semana en curso/futura se ve
    expect(future.week).toMatchObject({ days: 7, elapsedDays: 2, partial: true });
    const wc = await get(`/api/athletes/${A()}/week-compare?lift=SQ`);
    expect(wc.b.partial).toBe(true);
    expect(wc.notes.join(' ')).toMatch(/dosis POR SEMANA|parcial/);
  });
  it('comparación de períodos A/B con duraciones distintas', async () => {
    const c = await get(
      `/api/athletes/${A()}/period-compare?aFrom=2026-01-26&aTo=2026-02-08&bFrom=2026-02-09&bTo=2026-03-08&lift=SQ`,
    );
    expect([c.a.weeks, c.b.weeks]).toEqual([2, 4]);
    const nl = c.rows.find((r: { metricId: string }) => r.metricId === 'nl');
    expect(nl.aPerWeek).not.toBeNull();
    expect(c.notes.join(' ')).toMatch(/POR SEMANA/);
  });
  it('series: velas OHLC solo con ≥ 2 observaciones comparables en la semana; nunca se fabrican', async () => {
    const s = await get(`/api/athletes/${A()}/series?from=2026-01-01&to=2026-03-31`);
    const curve = s.performance.find(
      (p: { methodId: string; exercise: string }) =>
        p.methodId === 'table-rpe' && p.exercise === 'Squat comp',
    );
    expect(curve.points.length).toBe(6);
    expect(curve.candles).toEqual([]); // una sesión por semana: no hay velas
    expect(curve.skipped.length).toBe(6);
    expect(s.notes.join(' ')).toMatch(/no se unen en una tendencia/);
    expect(s.load.every((d: { nl: number }) => d.nl > 0)).toBe(true);
  });
  it('macro, meso y microciclos con fechas explícitas y duración variable', async () => {
    const m = (
      await post(`/api/athletes/${A()}/macros`, {
        name: 'Temporada',
        startDate: '2026-01-05',
        objective: 'fuerza',
      })
    ).json();
    await put(`/api/athletes/${A()}/mesos`, {
      blockKey: 'ACUM-1',
      macroId: m.id,
      name: 'Acumulación 1',
      objective: 'fuerza',
    });
    await put(`/api/athletes/${A()}/mesos`, {
      blockKey: 'ACUM-2',
      macroId: m.id,
      name: 'Acumulación 2',
      startDate: '2026-03-15',
      endDate: '2026-03-28',
    });
    await put(`/api/athletes/${A()}/microcycles`, {
      blockKey: 'ACUM-1',
      weekNo: 1,
      startDate: '2026-01-26',
      endDate: '2026-02-01',
    });
    // el seed ya crea un macro activo: se consulta el nuevo por id (con 2 macros activos, `/active` devuelve uno solo; ver GAPS)
    const active = await get(`/api/athletes/${A()}/macros/${m.id}`);
    expect(active.mesos.map((x: { blockKey: string }) => x.blockKey).sort()).toEqual(['ACUM-1', 'ACUM-2']);
    expect(active.mesos.find((x: { blockKey: string }) => x.blockKey === 'ACUM-1').durationWeeks).toBe(6);
    expect(active.mesos.find((x: { blockKey: string }) => x.blockKey === 'ACUM-2').durationWeeks).toBe(2);
    const meso = await get(`/api/athletes/${A()}/mesos/ACUM-1`);
    expect(meso.microcycles[0]).toMatchObject({ weekNo: 1, explicitDates: true, from: '2026-01-26' });
    expect(meso.microcycles[1].explicitDates).toBe(false);
    expect((await get(`/api/athletes/${A()}/macros`)).length).toBe(2);
    expect((await app.inject({ method: 'GET', url: `/api/athletes/${A()}/mesos/zzz` })).statusCode).toBe(404);
  });
  it('anotaciones de cambios, intervenciones y competencias; detalle de exposición con comparabilidad', async () => {
    const a = await get(`/api/athletes/${A()}/annotations?from=2026-01-01&to=2027-12-31`);
    expect(new Set(a.map((x: { kind: string }) => x.kind))).toEqual(new Set(['cambio', 'competencia']));
    const ex = await get(`/api/athletes/${A()}/exposures/sq-primaria`);
    expect(ex).toMatchObject({ exposureId: 'sq-primaria', role: 'primaria' });
    expect(ex.comparability).toMatchObject({ segments: 1 });
    expect(ex.identity.note).toMatch(/NO implica comparabilidad/);
    expect(ex.sessions.length).toBeGreaterThanOrEqual(6);
    expect((await app.inject({ method: 'GET', url: `/api/athletes/${A()}/exposures/zzz` })).statusCode).toBe(
      404,
    );
  });
});

describe('Replay histórico por API', () => {
  it('devuelve el reporte con método, versiones, cobertura y limitaciones', async () => {
    const r = (await post(`/api/athletes/${A()}/replay`, { from: '2026-01-11', to: '2026-03-08' })).json();
    expect(r.method).toMatchObject({
      rulesVersion: 'reglas-v0.2-propuesta',
      paramsVersion: 'params-v2',
      step: 'weekly',
    });
    expect(r.planKnowledge.snapshots + r.planKnowledge.assumedComplete).toBe(r.points.length);
    expect(r.limitations.join(' ')).toMatch(/No hay datos de lesión/);
    expect(r.coverage.SQ.cutoffs).toBeGreaterThan(0);
    expect((await post(`/api/athletes/${A()}/replay`, { from: 'x', to: 'y' })).statusCode).toBe(400);
  });
});

describe('Compatibilidad de contratos con el consumidor provisional', () => {
  it('el resumen del plantel usa `sufficiency` y las decisiones conservan el alias `coachDecision`', async () => {
    await post(`/api/athletes/${A()}/evaluate`, {});
    const [row] = (await get('/api/athletes')).filter((x: { id: string }) => x.id === A());
    expect(row.lifts.SQ).toHaveProperty('sufficiency');
    expect(row.lifts.SQ).not.toHaveProperty('confidence');
    const d = (await get(`/api/athletes/${A()}`)).decisions[0];
    expect(d).toHaveProperty('coachDecision');
    expect(d).toHaveProperty('lifecycle');
  });
});
