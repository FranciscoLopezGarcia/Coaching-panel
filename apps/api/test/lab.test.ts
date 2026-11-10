import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { LAB_CASES, LAB_DEFAULT_START, addDays, createLab, type LabCreated } from '../src/seed/lab.js';

/** Laboratorio FICTICIO: reproducibilidad, corte sin fuga de futuro y condiciones de cada caso (sin forzar etiquetas). */
const NOW = '2026-11-06';
let app: FastifyInstance;
let ctx: AppContext;
let ids: Record<string, LabCreated>;
const clock = { value: LAB_DEFAULT_START };
const wk = (w: number) => addDays(LAB_DEFAULT_START, (w - 1) * 7 + 6); // domingo de la semana w
const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();
const send = (method: 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object });
const evalAt = async (key: string, cutoff: string) =>
  (await send('POST', `/api/athletes/${ids[key]!.id}/evaluate`, { cutoff })).json();
const principalOf = (
  ev: { evaluation: { lifts: Record<string, { principal: { status: string } | null }> } },
  lift = 'SQ',
) => ev.evaluation.lifts[lift]?.principal?.status;

beforeAll(async () => {
  ctx = await buildContext(
    { ...loadConfig({}), dbPath: ':memory:' },
    await openDb(':memory:'),
    () => clock.value,
  );
  app = await buildApp(ctx);
  ids = Object.fromEntries((await createLab(ctx, clock, LAB_DEFAULT_START)).map((c) => [c.key, c]));
  clock.value = NOW;
});

describe('Laboratorio · creación', () => {
  it('crea 6 casos ficticios identificados, con macro, mesos, referencias fechadas, cuestionarios y programación por versiones', async () => {
    expect(Object.keys(ids)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    for (const c of LAB_CASES) {
      const a = ids[c.key]!;
      expect(a.name).toMatch(/^LAB-.*\(ficticio\)$/);
      expect(await ctx.programmingRepo.listMacros(a.id)).toHaveLength(1);
      expect((await ctx.programmingRepo.listMesos(a.id)).length).toBe(c.blocks.length);
      expect((await ctx.references.list(a.id)).length).toBe(c.refs.length);
      expect(await ctx.history.listVersions(a.id)).toHaveLength(c.publishAtWeek.length);
      expect((await ctx.records.listActual(a.id)).length).toBeGreaterThan(0);
    }
  });
  it('es reproducible: dos creaciones dan exactamente los mismos datos', async () => {
    const c2 = await buildContext(
      { ...loadConfig({}), dbPath: ':memory:' },
      await openDb(':memory:'),
      () => clock.value,
    );
    const k2 = { value: LAB_DEFAULT_START };
    const again = Object.fromEntries((await createLab(c2, k2, LAB_DEFAULT_START)).map((c) => [c.key, c]));
    for (const k of Object.keys(ids)) {
      expect(await c2.records.listActivePlanned(again[k]!.id)).toEqual(
        await ctx.records.listActivePlanned(ids[k]!.id),
      );
      expect(await c2.records.listActual(again[k]!.id)).toEqual(await ctx.records.listActual(ids[k]!.id));
      expect(await c2.records.listCheckIns(again[k]!.id)).toEqual(await ctx.records.listCheckIns(ids[k]!.id));
    }
  });
  it('la programación se publicó por bloques con fecha propia (el plan de la semana 13 no existía en la semana 8)', async () => {
    const v = await ctx.history.listVersions(ids['A']!.id);
    expect(v.map((x) => x.detectedOn)).toEqual([
      addDays(LAB_DEFAULT_START, -3),
      addDays(LAB_DEFAULT_START, 25),
      addDays(LAB_DEFAULT_START, 53),
      addDays(LAB_DEFAULT_START, 81),
    ]);
    expect(v[1]!.sets.length).toBeGreaterThan(v[0]!.sets.length);
  });
});

describe('Corte de evaluación sin fuga de futuro', () => {
  it('evaluar a un corte pasado no cambia aunque después se agreguen ejecución, cuestionarios, revisiones y una versión de plan nueva', async () => {
    // laboratorio propio: este test agrega datos y no debe contaminar a los demás
    const k = { value: LAB_DEFAULT_START };
    const c3 = await buildContext(
      { ...loadConfig({}), dbPath: ':memory:' },
      await openDb(':memory:'),
      () => k.value,
    );
    const app3 = await buildApp(c3);
    const f = (await createLab(c3, k, LAB_DEFAULT_START, undefined, ['F']))[0]!;
    k.value = NOW;
    const send3 = (method: 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
      app3.inject({ method, url, payload: payload as object });
    const ev3 = async (cutoff: string) =>
      (await send3('POST', `/api/athletes/${f.id}/evaluate`, { cutoff })).json();
    const cutoff = wk(10);
    const before = await ev3(cutoff);
    const snap = (e: typeof before) =>
      JSON.stringify(
        Object.entries(e.evaluation.lifts).map(([l, v]) => [
          l,
          (
            v as { results: { ruleId: string; status: string; summary: string; facts?: unknown }[] }
          ).results.map((r) => [r.ruleId, r.status, r.summary]),
        ]),
      );
    // información POSTERIOR al corte: ejecución de las semanas 13–14 (ya programadas), cuestionarios, revisión técnica, fatiga y un cambio de plan
    const id = f.id;
    const future = (await c3.records.listActivePlanned(id))
      .filter((s) => s.plannedDate > cutoff && s.weekNo >= 1 && s.plannedDate >= wk(12))
      .slice(0, 10);
    await send3('POST', `/api/athletes/${id}/sets`, {
      sets: future.map((s) => ({
        plannedSetId: s.id,
        status: 'done',
        kg: (s.plannedKg ?? 100) + 20,
        reps: 3,
        rpe: 10,
        performedOn: s.plannedDate,
        pain: 6,
      })),
    });
    await send3('POST', `/api/athletes/${id}/checkins`, {
      date: wk(13),
      sleep: 1,
      energy: 1,
      motivation: 1,
      stress: 10,
      pain: 9,
    });
    await send3('POST', `/api/athletes/${id}/coach-reviews`, {
      lift: 'BP',
      date: wk(11),
      verdict: 'no_comparable',
      note: 'posterior',
    });
    const sess = (await c3.records.listActivePlanned(id)).find((s) => s.plannedDate <= cutoff)!;
    await send3('POST', `/api/athletes/${id}/session-feedback`, {
      sessionKey: sess.sessionKey,
      endFatigue: 10,
    });
    // cambio de plan publicado HOY (después del corte) que altera series anteriores al corte
    await send3('POST', `/api/athletes/${id}/program`, {
      mode: 'apply',
      op: { type: 'change_protocol', selection: { blockKey: 'F-M1', weeks: [1] }, change: { reps: 8 } },
    });
    // prescripción AGREGADA hoy con fecha anterior al corte y sin ejecución: no era conocida entonces (bajaría el cumplimiento si se usara)
    const late = [1, 2, 3].map((n) => ({
      id: `late-${n}`,
      sessionKey: 'late-added',
      slotKey: 'squat-comp|D2',
      exerciseName: 'Squat comp',
      lift: 'SQ',
      plannedDate: addDays(cutoff, -2),
      setNo: n,
      reps: 5,
      targetRpe: 8,
      plannedKg: 120,
      blockKey: 'F-M3',
      weekNo: 2,
      dayNo: 5,
      familyKey: 'pico',
      refKg: 160,
      exposureId: 'sq-primaria',
      variantKey: 'Squat comp',
    }));
    const added = await send3('POST', `/api/athletes/${f.id}/program`, {
      mode: 'apply',
      op: { type: 'add_sets', sets: late },
    });
    expect(added.statusCode).toBe(200);
    const after = await ev3(cutoff);
    expect(snap(after)).toBe(snap(before));
    // y el mismo corte SÍ cambia si el corte se mueve hacia adelante (los datos nuevos existen)
    const later = await ev3(addDays(wk(14), 1));
    expect(snap(later)).not.toBe(snap(before));
  });
});

describe('Condiciones de cada caso (sin etiquetas forzadas)', () => {
  it('A · progreso comparable: no hay revisión técnica, deterioro ni datos insuficientes; cada corte usa solo lo conocido', async () => {
    for (const w of [6, 10, 12]) {
      const s = principalOf(await evalAt('A', wk(w)));
      expect([
        'revision_tecnica',
        'posible_fin_respuesta',
        'fin_esfuerzo',
        'datos_insuficientes',
      ]).not.toContain(s);
    }
    const m = await get(
      `/api/athletes/${ids['A']!.id}/metrics?from=${LAB_DEFAULT_START}&to=${wk(10)}&lift=SQ&cutoff=${wk(10)}`,
    );
    expect(m.metrics.e1rm_table_rpe.status).not.toBe('unavailable');
    expect(m.metrics.intensity_rel.status).not.toBe('unavailable'); // referencia fechada vigente
    // el e1RM por curva sube entre el inicio y el final del tramo
    const ser = await get(
      `/api/athletes/${ids['A']!.id}/series?from=${LAB_DEFAULT_START}&to=${wk(12)}&cutoff=${wk(12)}`,
    );
    expect(JSON.stringify(ser)).toContain('table-rpe');
  });
  it('B · deterioro: el esfuerzo real supera al objetivo, el rendimiento cae y los cuestionarios empeoran', async () => {
    const id = ids['B']!.id;
    const pesada = (await ctx.records.listActivePlanned(id)).filter(
      (s) => s.sessionKey.endsWith('squat-comp') && !s.isWarmup,
    );
    const act = new Map((await ctx.records.listActual(id)).map((a) => [a.plannedSetId, a]));
    const dev = (w: number) => {
      const xs = pesada.filter(
        (s) =>
          s.plannedDate >= addDays(LAB_DEFAULT_START, (w - 1) * 7) &&
          s.plannedDate < addDays(LAB_DEFAULT_START, w * 7),
      );
      return xs.reduce((a, s) => a + ((act.get(s.id)?.rpe ?? 0) - (s.targetRpe ?? 0)), 0) / xs.length;
    };
    expect(dev(2)).toBeLessThanOrEqual(0);
    expect(dev(11)).toBeGreaterThanOrEqual(1);
    const cks = await ctx.records.listCheckIns(id);
    expect(cks.at(-1)!.energy!).toBeLessThan(cks[0]!.energy!);
    expect(cks.at(-1)!.stress!).toBeGreaterThan(cks[0]!.stress!);
    const s8 = await evalAt('B', wk(8));
    expect(['progreso', 'progreso_sostenido', 'candidato_pr', 'oportunidad_pendiente']).not.toContain(
      principalOf(s8),
    );
  });
  it('C · mantenimiento: la estabilidad nunca se presenta como fin de respuesta', async () => {
    for (const w of [8, 12]) {
      const ev = await evalAt('C', wk(w));
      const end = ev.evaluation.lifts.SQ.results.find((r: { ruleId: string }) => r.ruleId === 'R-END');
      expect(end?.status).toBe('estabilidad_observada');
      expect(JSON.stringify(end)).toMatch(/mantenimiento/);
    }
  });
  it('D · incompleto: el e1RM por curva queda no disponible donde falta el RPE; sin registro ≠ cero; la referencia fechada no mira hacia atrás', async () => {
    const id = ids['D']!.id;
    const early = await get(
      `/api/athletes/${id}/metrics?from=${LAB_DEFAULT_START}&to=${wk(5)}&lift=SQ&cutoff=${wk(5)}`,
    );
    expect(early.metrics.e1rm_table_rpe.status).toBe('unavailable');
    expect(early.metrics.intensity_rel.status).toBe('unavailable'); // la referencia existe desde la semana 6
    const later = await get(
      `/api/athletes/${id}/metrics?from=${LAB_DEFAULT_START}&to=${wk(10)}&lift=SQ&cutoff=${wk(10)}`,
    );
    expect(later.metrics.intensity_rel.status).not.toBe('unavailable');
    expect(principalOf(await evalAt('D', wk(10)))).toBe('datos_insuficientes');
    // semana 8 sin registro: no hay series realizadas ese día, y las omitidas siguen siendo omitidas
    const act = await ctx.records.listActual(id);
    expect(act.filter((a) => a.status === 'skipped').length).toBeGreaterThan(0);
    expect(
      act.some(
        (a) =>
          a.performedOn &&
          a.performedOn >= addDays(LAB_DEFAULT_START, 49) &&
          a.performedOn < addDays(LAB_DEFAULT_START, 56),
      ),
    ).toBe(false);
    expect((await ctx.records.listCheckIns(id)).every((c) => c.date <= wk(3))).toBe(true); // cuestionario antiguo
  });
  it('E · redistribución: NL semanal constante, 2 → 3 sesiones por semana, misma exposición', async () => {
    const id = ids['E']!.id;
    const w = await get(`/api/athletes/${id}/weekly?from=${LAB_DEFAULT_START}&to=${wk(12)}&cutoff=${wk(12)}`);
    const text = JSON.stringify(w);
    expect(text).toContain('nl');
    const planned = (await ctx.records.listActivePlanned(id)).filter((s) => !s.isWarmup);
    for (let wkn = 1; wkn <= 12; wkn++) {
      const xs = planned.filter(
        (s) =>
          s.plannedDate >= addDays(LAB_DEFAULT_START, (wkn - 1) * 7) &&
          s.plannedDate < addDays(LAB_DEFAULT_START, wkn * 7),
      );
      expect(xs.reduce((a, s) => a + s.reps, 0)).toBe(50);
      expect(new Set(xs.map((s) => s.sessionKey)).size).toBe(wkn <= 6 ? 2 : 3);
      expect(new Set(xs.map((s) => s.exposureId))).toEqual(new Set(['sq-primaria']));
    }
    const wc = await get(`/api/athletes/${id}/week-compare?lift=SQ&cutoff=${wk(8)}`);
    const nl = wc.rows.find((r: { metricId: string }) => r.metricId === 'nl');
    expect(nl.diff).toBe(0);
  });
  it('F · oportunidad: si aparece, se declara como pendiente/potencial con límites y nunca como garantía', async () => {
    const ev = await evalAt('F', wk(12));
    const pr = ev.evaluation.lifts.BP.results.find((r: { ruleId: string }) => r.ruleId === 'R-PR');
    expect(['candidato_pr', 'oportunidad_pendiente', 'sin_senal']).toContain(pr.status);
    const text = JSON.stringify(ev);
    expect(text).not.toMatch(/va a levantar|PR asegurado|éxito asegurado/i);
    expect(JSON.stringify(pr.explanation?.limits ?? pr.missing ?? [])).not.toBe('[]');
    const dec = (await get(`/api/athletes/${ids['F']!.id}/decisions`)).find(
      (d: { ruleId: string }) => d.ruleId === 'R-PR',
    );
    if (dec)
      expect(
        (
          await get(
            `/api/athletes/${ids['F']!.id}/recommendations/${encodeURIComponent(dec.key)}/evidence?cutoff=${wk(12)}`,
          )
        ).explanation,
      ).toBeTruthy();
  });
});

describe('Prueba manual libre', () => {
  it('atleta → programación → registro → evaluar a una fecha → evidencias → intervención → semanas nuevas → seguimiento acotado por corte', async () => {
    const id = ids['B']!.id; // caso con deterioro: hay un hallazgo para intervenir
    const cutoff = wk(8);
    const ev = await evalAt('B', cutoff);
    const dec = ev.decisions.find(
      (d: { isPrincipal: boolean; lift: string }) => d.isPrincipal && d.lift === 'SQ',
    );
    const evidence = await get(
      `/api/athletes/${id}/recommendations/${encodeURIComponent(dec.key)}/evidence?cutoff=${cutoff}`,
    );
    expect(evidence.explanation).toBeTruthy();
    expect(JSON.stringify(evidence.records)).not.toContain(addDays(LAB_DEFAULT_START, 70)); // ningún registro posterior al corte
    const iv = (await send('POST', `/api/athletes/${id}/interventions`, { proposalKey: dec.key })).json();
    await send('POST', `/api/athletes/${id}/interventions/${iv.id}/transition`, {
      to: 'aceptada',
      on: cutoff,
    });
    await send('POST', `/api/athletes/${id}/interventions/${iv.id}/transition`, {
      to: 'aplicada',
      on: cutoff,
      appliedOn: addDays(cutoff, 1),
      appliedDescription: 'descarga manual',
    });
    const at8 = (await get(`/api/athletes/${id}/interventions?cutoff=${cutoff}`)).find(
      (x: { intervention: { id: string } }) => x.intervention.id === iv.id,
    );
    const at12 = (await get(`/api/athletes/${id}/interventions?cutoff=${wk(12)}`)).find(
      (x: { intervention: { id: string } }) => x.intervention.id === iv.id,
    );
    expect(at8.followUp.after).toBeNull(); // todavía no hay datos posteriores a la aplicación al corte 8
    expect(at12.followUp).toBeTruthy();
    // agregar semanas con el programa y registrar: la evaluación a un corte nuevo las incluye, la anterior no
    const base = await evalAt('B', cutoff);
    await send('POST', `/api/athletes/${id}/program`, {
      mode: 'apply',
      op: {
        type: 'repeat_week',
        blockKey: 'B-M4',
        sourceWeek: 1,
        targetWeek: 5,
        shiftDays: 28,
        replaceExisting: true,
      },
    });
    const same = await evalAt('B', cutoff);
    expect(principalOf(same)).toBe(principalOf(base));
  });
  it('crear un atleta ficticio desde cero y evaluarlo a una fecha elegida sin datos futuros', async () => {
    const a = (await send('POST', '/api/athletes', { name: 'LAB-X · manual (ficticio)' })).json();
    const mk = (d: string, n: number, kg: number) => ({
      id: `x-${d}-${n}`,
      sessionKey: `x-${d}`,
      slotKey: 's|D1',
      exerciseName: 'Squat comp',
      lift: 'SQ',
      plannedDate: d,
      setNo: n,
      reps: 5,
      targetRpe: 8,
      plannedKg: kg,
      blockKey: 'X1',
      weekNo: 1,
      dayNo: 1,
      familyKey: 'X',
      refKg: 150,
      exposureId: 'sq-primaria',
      variantKey: 'Squat comp',
    });
    const dates = Array.from({ length: 8 }, (_, i) => addDays(LAB_DEFAULT_START, i * 7));
    await send('POST', `/api/athletes/${a.id}/plan`, {
      sets: dates.flatMap((d, i) => [1, 2, 3].map((n) => mk(d, n, 100 + 2.5 * i))),
      status: 'aplicado',
    });
    await send('POST', `/api/athletes/${a.id}/sets`, {
      sets: dates.flatMap((d, i) =>
        [1, 2, 3].map((n) => ({
          plannedSetId: `x-${d}-${n}`,
          status: 'done',
          kg: 100 + 2.5 * i,
          reps: 5,
          rpe: 8,
          performedOn: d,
          pain: null,
        })),
      ),
    });
    // sin versión de plan conocida a esa fecha, la programación posterior no cuenta: el plan se publicó "hoy"
    const early = await evalAt('A', LAB_DEFAULT_START); // corte inicial de otro atleta: casi sin datos
    expect(principalOf(early)).toBeDefined();
    const e = (await send('POST', `/api/athletes/${a.id}/evaluate`, { cutoff: dates[4] })).json();
    const used = JSON.stringify(e.evaluation);
    expect(used).not.toContain(dates[6]);
  });
});

describe('Macro activo y meso vacío', () => {
  it('varios macros activos: no se elige en silencio (informa los otros) y se puede pedir uno por id', async () => {
    const id = ids['A']!.id;
    const extra = (
      await send('POST', `/api/athletes/${id}/macros`, {
        name: 'Macro nuevo',
        startDate: addDays(LAB_DEFAULT_START, 120),
      })
    ).json();
    const r = await get(`/api/athletes/${id}/macros/active`);
    expect(r.selection).toBe('mas_reciente_entre_varios_activos');
    expect(r.id).toBe(extra.id);
    expect(r.otherActiveMacros).toHaveLength(1);
    const pick = await get(`/api/athletes/${id}/macros/active?macroId=${r.otherActiveMacros[0].id}`);
    expect(pick.selection).toBe('explicita');
    expect(
      (await app.inject({ method: 'GET', url: `/api/athletes/${id}/macros/active?macroId=nope` })).statusCode,
    ).toBe(404);
  });
  it('un meso creado sin series responde con resumen vacío, no 404', async () => {
    const id = ids['C']!.id;
    await send('PUT', `/api/athletes/${id}/mesos`, {
      blockKey: 'C-VACIO',
      name: 'Meso vacío',
      startDate: addDays(LAB_DEFAULT_START, 200),
      endDate: addDays(LAB_DEFAULT_START, 227),
    });
    const r = await app.inject({ method: 'GET', url: `/api/athletes/${id}/mesos/C-VACIO` });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/athletes/${id}/mesos/NO-EXISTE` })).statusCode).toBe(
      404,
    );
  });
});

// La plantilla CSV vive solo en la máquina del coach (los CSV no se versionan): sin el archivo, esta prueba no aplica.
const PLANTILLA = new URL('../../../docs/piloto-real/plantilla-plan.csv', import.meta.url);
describe('Piloto real · plantilla y comandos de solo lectura', () => {
  it.skipIf(!existsSync(PLANTILLA))(
    'la plantilla de programación pasa el dry-run y no escribe nada',
    async () => {
      const { readFileSync } = await import('node:fs');
      const csv = readFileSync(PLANTILLA, 'utf8');
      const id = ids['A']!.id;
      const before = (await ctx.records.listActivePlanned(id)).length;
      const r = (await send('POST', `/api/athletes/${id}/imports/plan-csv`, { csv, mode: 'dry_run' })).json();
      expect(r.parse.ok).toBe(true);
      expect(r.applied).toBeNull();
      expect((await ctx.records.listActivePlanned(id)).length).toBe(before);
      // aplicar sin token coincidente se rechaza
      expect(
        (await send('POST', `/api/athletes/${id}/imports/plan-csv`, { csv, mode: 'apply' })).statusCode,
      ).toBe(422);
    },
  );
});

describe('Identificación de instancia y vigencia de la evaluación', () => {
  it('sin archivo ni variable el modo es "unspecified" (no se deduce); /api/instance y /api/health lo informan', async () => {
    const h = await get('/api/health');
    expect(h.instance).toMatchObject({ mode: 'unspecified', fictitious: null });
    expect((await get('/api/instance')).cases).toEqual([]);
  });
  it('el archivo de identificación del laboratorio y INSTANCE_MODE se leen sin migrar la BD', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { loadInstance } = await import('../src/instance.js');
    const dir = mkdtempSync(join(tmpdir(), 'inst-'));
    const db = join(dir, 'x.sqlite');
    writeFileSync(
      `${db}.instance.json`,
      JSON.stringify({
        mode: 'laboratory',
        datasetId: 'lab-1',
        label: 'L',
        cases: [
          {
            key: 'A',
            name: 'n',
            athleteId: 'i',
            summary: '',
            explores: '',
            objective: 'fuerza',
            cutoffs: [],
          },
        ],
      }),
    );
    expect(loadInstance(db)).toMatchObject({ mode: 'laboratory', fictitious: true, datasetId: 'lab-1' });
    expect(loadInstance(db).cases).toHaveLength(1);
    expect(
      loadInstance(join(dir, 'otra.sqlite'), { INSTANCE_MODE: 'personal' } as NodeJS.ProcessEnv),
    ).toMatchObject({ mode: 'personal', fictitious: null });
    expect(loadInstance(join(dir, 'otra.sqlite'), {} as NodeJS.ProcessEnv).mode).toBe('unspecified');
    writeFileSync(`${db}.instance.json`, '{no json');
    expect(loadInstance(db, {} as NodeJS.ProcessEnv).mode).toBe('unspecified');
  });
  it('la evaluación guarda una huella de entradas y /state avisa cuando cambian (incluso desde otro cliente) y se limpia al re-evaluar', async () => {
    const id = ids['C']!.id;
    const cutoff = wk(14); // el más reciente: el estado muestra la última evaluación por corte
    await evalAt('C', cutoff);
    const s1 = await get(`/api/athletes/${id}/state`);
    expect(s1.freshness).toMatchObject({ evaluatedCutoff: cutoff, inputsChangedSinceEvaluation: false });
    // un dato posterior al corte NO invalida la evaluación de ese corte
    await send('POST', `/api/athletes/${id}/checkins`, {
      date: wk(15),
      sleep: 2,
      energy: 2,
      motivation: 2,
      stress: 9,
      pain: 5,
    });
    expect((await get(`/api/athletes/${id}/state`)).freshness.inputsChangedSinceEvaluation).toBe(false);
    // un dato anterior al corte sí
    await send('POST', `/api/athletes/${id}/checkins`, {
      date: wk(13),
      sleep: 2,
      energy: 2,
      motivation: 2,
      stress: 9,
      pain: 5,
      reason: 'edición externa',
    });
    const s2 = await get(`/api/athletes/${id}/state`);
    expect(s2.freshness.inputsChangedSinceEvaluation).toBe(true);
    expect(s2.freshness.storedFingerprint).not.toBe(s2.freshness.currentFingerprint);
    await evalAt('C', cutoff);
    expect((await get(`/api/athletes/${id}/state`)).freshness.inputsChangedSinceEvaluation).toBe(false);
  });
});
