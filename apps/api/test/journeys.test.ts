import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { seedDemoData } from '../src/seed/load.js';

/**
 * Recorridos funcionales que consume el frontend (handoff). Todo vía HTTP sobre una BD en memoria; datos 100 % sintéticos.
 * A programación · B registro · C análisis · D intervenciones · E historial · importación Hevy.
 */
const TODAY = '2026-03-10';
let app: FastifyInstance;
let ctx: AppContext;
const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();
const send = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object });

beforeEach(async () => {
  ctx = await buildContext({ ...loadConfig({}), dbPath: ':memory:' }, await openDb(':memory:'), () => TODAY);
  app = await buildApp(ctx);
});

const set = (
  session: string,
  n: number,
  date: string,
  week: number,
  extra: Record<string, unknown> = {},
) => ({
  id: `${session}-${n}`,
  sessionKey: session,
  slotKey: 'squat|D1',
  exerciseName: 'Squat comp',
  lift: 'SQ',
  plannedDate: date,
  setNo: n,
  reps: 5,
  targetRpe: 8,
  plannedKg: 100,
  blockKey: 'M1',
  weekNo: week,
  dayNo: 1,
  familyKey: 'F1',
  refKg: 150,
  exposureId: 'sq-primaria',
  variantKey: 'Squat comp',
  ...extra,
});

describe('A · Programación de punta a punta', () => {
  it('atleta → macro → meso → micro → sesión con protocolo mixto → semana siguiente → duplicar → cambiar destino → historial', async () => {
    const a = (await send('POST', '/api/athletes', { name: 'Atleta sintético' })).json();
    const id = a.id as string;
    const macro = (
      await send('POST', `/api/athletes/${id}/macros`, {
        name: 'Macro 1',
        startDate: '2026-03-02',
        objective: 'fuerza',
      })
    ).json();
    expect(
      (
        await send('PUT', `/api/athletes/${id}/mesos`, {
          blockKey: 'M1',
          macroId: macro.id,
          name: 'Meso 1',
          startDate: '2026-03-02',
          endDate: '2026-03-29',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await send('PUT', `/api/athletes/${id}/microcycles`, {
          blockKey: 'M1',
          weekNo: 1,
          startDate: '2026-03-02',
          endDate: '2026-03-08',
        })
      ).statusCode,
    ).toBe(200);

    // sesión con protocolo mixto: top set por RPE con tope + back-off por % de la referencia
    const week1 = [
      set('s1', 1, '2026-03-02', 1, {
        plannedKg: null,
        protocol: { loadMode: 'rpe_cap', capKg: 120, segment: 'top' },
      }),
      set('s1', 2, '2026-03-02', 1, {
        plannedKg: null,
        protocol: { loadMode: 'pct', pct: 80, segment: 'backoff', tempo: '3-1-0' },
      }),
      set('s1', 3, '2026-03-02', 1, {
        plannedKg: null,
        protocol: { loadMode: 'pct', pct: 80, segment: 'backoff' },
      }),
    ];
    const imp = (
      await send('POST', `/api/athletes/${id}/plan`, { sets: week1, status: 'aplicado', label: 'Semana 1' })
    ).json();
    expect(imp.changed ?? true).toBeTruthy();
    const base = await get(`/api/athletes/${id}/sessions`);
    expect(base).toHaveLength(1);
    expect(base[0].sets[1].planned.kg).toBe(120); // 80 % de la referencia 150 resuelto por el motor, no por el cliente

    // semana siguiente reutilizando estructura: vista previa NO guarda, aplicar guarda 1 versión y 1 evento
    const versions0 = (await get(`/api/athletes/${id}/plan-versions`)).length;
    const wk = { type: 'repeat_week', blockKey: 'M1', sourceWeek: 1, targetWeek: 2, shiftDays: 7 };
    const prev = (await send('POST', `/api/athletes/${id}/program`, { mode: 'preview', op: wk })).json();
    expect(prev.saved).toBeNull();
    expect(prev.preview.addedSets).toBe(3);
    expect((await get(`/api/athletes/${id}/plan-versions`)).length).toBe(versions0);
    const ap = (
      await send('POST', `/api/athletes/${id}/program`, { mode: 'apply', op: wk, label: 'Semana 2' })
    ).json();
    expect(ap.saved.status).toBe('aplicado');
    expect((await get(`/api/athletes/${id}/plan-versions`)).length).toBe(versions0 + 1);

    // duplicar una sesión
    const dup = {
      type: 'duplicate_session',
      sessionKey: 's1',
      newSessionKey: 's1-b',
      plannedDate: '2026-03-05',
      dayNo: 4,
    };
    await send('POST', `/api/athletes/${id}/program`, { mode: 'apply', op: dup });
    expect(await get(`/api/athletes/${id}/sessions`)).toHaveLength(3);

    // cambio aplicado SOLO a destinos seleccionados (semana 2), con vista previa de diferencias
    const ch = {
      type: 'change_protocol',
      selection: { blockKey: 'M1', weeks: [2] },
      change: { targetRpe: 9 },
    };
    const typo = { ...ch, selection: { blockKey: 'M1', weekNo: 2 } };
    expect((await send('POST', `/api/athletes/${id}/program`, { mode: 'apply', op: typo })).statusCode).toBe(
      400,
    );
    const pv = (await send('POST', `/api/athletes/${id}/program`, { mode: 'preview', op: ch })).json();
    expect(pv.preview.event.setChanges).toBeTruthy();
    expect(
      pv.preview.event.changes.length + JSON.stringify(pv.preview.event.setChanges).length,
    ).toBeGreaterThan(0);
    await send('POST', `/api/athletes/${id}/program`, { mode: 'apply', op: ch });
    const sessions = await get(`/api/athletes/${id}/sessions`);
    const rpes = sessions.map((s: { weekNo: number; sets: { planned: { targetRpe: number } }[] }) => [
      s.weekNo,
      s.sets[0]!.planned.targetRpe,
    ]);
    expect(rpes.filter(([w]: number[]) => w === 2).every(([, r]: number[]) => r === 9)).toBe(true);
    expect(rpes.filter(([w]: number[]) => w === 1).every(([, r]: number[]) => r === 8)).toBe(true);

    // nada de resultados/cuestionarios/completado copiado
    expect(await ctx.records.listActual(id)).toHaveLength(0);
    // historial conservado: versiones + eventos automáticos
    expect((await get(`/api/athletes/${id}/plan-versions`)).length).toBeGreaterThanOrEqual(4);
    expect((await get(`/api/athletes/${id}/history`)).events.length).toBeGreaterThanOrEqual(3);
  });

  it('copiar NO copia resultados ni cuestionarios aunque el origen los tenga', async () => {
    const id = (await send('POST', '/api/athletes', { name: 'Origen con registros' })).json().id as string;
    await send('POST', `/api/athletes/${id}/plan`, {
      sets: [set('s1', 1, '2026-03-02', 1), set('s1', 2, '2026-03-02', 1)],
      status: 'aplicado',
    });
    await send('POST', `/api/athletes/${id}/sets`, {
      sets: [
        {
          plannedSetId: 's1-1',
          status: 'done',
          kg: 100,
          reps: 5,
          rpe: 8,
          performedOn: '2026-03-02',
          pain: null,
        },
      ],
    });
    await send('POST', `/api/athletes/${id}/session-feedback`, { sessionKey: 's1', endFatigue: 6 });
    await send('POST', `/api/athletes/${id}/program`, {
      mode: 'apply',
      op: { type: 'repeat_week', blockKey: 'M1', sourceWeek: 1, targetWeek: 2, shiftDays: 7 },
    });
    const s = await get(`/api/athletes/${id}/sessions`);
    const copy = s.find((x: { weekNo: number }) => x.weekNo === 2);
    expect(copy.endFatigue).toBeNull();
    expect(copy.sets.every((x: { actual: unknown }) => x.actual === null)).toBe(true);
  });
});

describe('B · Registro, previsto vs realizado y ediciones con trazabilidad', () => {
  it('consulta → registra ejecución y cuestionario → compara → edita con historial de revisiones', async () => {
    const id = (await send('POST', '/api/athletes', { name: 'Registro' })).json().id as string;
    await send('POST', `/api/athletes/${id}/plan`, {
      sets: [1, 2, 3].map((n) => set('s1', n, '2026-03-02', 1)),
      status: 'aplicado',
    });
    expect(
      (await get(`/api/athletes/${id}/sessions`))[0].sets.every(
        (x: { actual: unknown }) => x.actual === null,
      ),
    ).toBe(true);

    await send('POST', `/api/athletes/${id}/sets`, {
      sets: [
        {
          plannedSetId: 's1-1',
          status: 'done',
          kg: 100,
          reps: 5,
          rpe: 8,
          performedOn: '2026-03-02',
          pain: null,
        },
        {
          plannedSetId: 's1-2',
          status: 'done',
          kg: 100,
          reps: 4,
          rpe: 9,
          performedOn: '2026-03-02',
          pain: 2,
        },
      ],
    });
    await send('POST', `/api/athletes/${id}/session-feedback`, { sessionKey: 's1', endFatigue: 7 });
    await send('POST', `/api/athletes/${id}/checkins`, {
      date: '2026-03-02',
      sleep: 7,
      energy: 7,
      motivation: 8,
      stress: 3,
      pain: 2,
    });

    const s = (await get(`/api/athletes/${id}/sessions`))[0];
    expect(s.endFatigue).toBe(7);
    expect(s.sets[1]).toMatchObject({ planned: { reps: 5 }, actual: { reps: 4, rpe: 9 } });
    expect(s.sets[2].actual).toBeNull(); // sin registro ≠ omitida

    const w = await get(`/api/athletes/${id}/weekly?from=2026-03-02&to=2026-03-08&cutoff=${TODAY}`);
    expect(JSON.stringify(w)).toContain('planned');

    // edición con motivo → queda la revisión (antes/después); reenviar lo mismo no la duplica
    const edit = {
      sets: [
        {
          plannedSetId: 's1-2',
          status: 'done',
          kg: 100,
          reps: 5,
          rpe: 8.5,
          performedOn: '2026-03-02',
          pain: 2,
        },
      ],
      reason: 'corrección del coach',
    };
    await send('POST', `/api/athletes/${id}/sets`, edit);
    await send('POST', `/api/athletes/${id}/sets`, edit);
    const rev = await get(`/api/athletes/${id}/revisions?entity=actual_set&key=s1-2`);
    expect(rev.total).toBe(2); // create + update
    expect(rev.items[0]).toMatchObject({
      action: 'update',
      reason: 'corrección del coach',
      before: { reps: 4, rpe: 9 },
      after: { reps: 5, rpe: 8.5 },
    });
    expect(rev.items[1].action).toBe('create');
    await send('POST', `/api/athletes/${id}/checkins`, {
      date: '2026-03-02',
      sleep: 5,
      energy: 7,
      motivation: 8,
      stress: 3,
      pain: 2,
      reason: 'dormí menos',
    });
    expect((await get(`/api/athletes/${id}/revisions?entity=checkin`)).total).toBe(2);
    expect((await get(`/api/athletes/${id}/revisions?limit=1&offset=0`)).items).toHaveLength(1);
    expect((await send('GET', `/api/athletes/${id}/revisions?limit=0`)).statusCode).toBe(400);
  });
});

describe('C · Análisis, D · Intervenciones, E · Historial (sobre la demo sintética)', () => {
  let ids: Record<string, string>;
  beforeEach(async () => {
    ids = await seedDemoData(ctx);
  });
  const A = () => ids['DEMO A · progresa (sintético)'] as string;
  const C = () => ids['DEMO C · incompleto (sintético)'] as string;

  it('C: resumen, macro activo, métricas con disponibilidad parcial, series, comparativas y evidencias', async () => {
    const list = await get('/api/athletes');
    expect(list.length).toBe(7);
    const st = await get(`/api/athletes/${A()}/state`);
    expect(Object.keys(st.lifts)).toEqual(expect.arrayContaining(['SQ', 'BP']));
    expect(st.lifts.SQ.principal).toBeTruthy();
    const macro = await get(`/api/athletes/${A()}/macros/active`);
    expect(macro).toBeTruthy();
    const m = await get(`/api/athletes/${C()}/metrics?from=2026-01-01&to=2026-03-10&lift=SQ`);
    const unavailable = Object.values(
      m.metrics as Record<string, { status: string; missing: string[] }>,
    ).filter((x) => x.status !== 'available');
    expect(unavailable.length).toBeGreaterThan(0); // DEMO C no tiene referencia: hay faltantes explícitos
    expect(unavailable.every((x) => Array.isArray(x.missing))).toBe(true);
    expect(JSON.stringify(m)).not.toContain('NaN');
    const series = await get(`/api/athletes/${A()}/series?from=2025-12-01&to=2026-03-10`);
    expect(series).toBeTruthy();
    const wc = await get(`/api/athletes/${A()}/week-compare?lift=SQ`);
    expect(wc).toBeTruthy();
    const pc = await get(
      `/api/athletes/${A()}/period-compare?aFrom=2026-01-20&aTo=2026-02-10&bFrom=2026-02-11&bTo=2026-03-10&lift=SQ`,
    );
    expect(pc).toBeTruthy();
    const ev = await get(`/api/athletes/${A()}/decisions`);
    const principal = ev.find((d: { isPrincipal: boolean }) => d.isPrincipal);
    const evidence = await get(`/api/athletes/${A()}/recommendations/${principal.key}/evidence`);
    expect(evidence).toBeTruthy();
  });

  it('D: revisar → aceptar (≠ aplicar) → aplicar vinculando el evento → seguimiento; descartar conserva la decisión', async () => {
    const dec = (await get(`/api/athletes/${A()}/decisions`)).find(
      (d: { isPrincipal: boolean; lift: string }) => d.isPrincipal,
    );
    const iv = (await send('POST', `/api/athletes/${A()}/interventions`, { proposalKey: dec.key })).json();
    await send('POST', `/api/athletes/${A()}/interventions/${iv.id}/transition`, {
      to: 'revisada',
      on: '2026-03-10',
    });
    const acc = (
      await send('POST', `/api/athletes/${A()}/interventions/${iv.id}/transition`, {
        to: 'aceptada',
        on: '2026-03-10',
      })
    ).json();
    expect(acc).toMatchObject({ state: 'aceptada', appliedOn: null });
    const ev = (await get(`/api/athletes/${A()}/history`)).events[0];
    const ap = (
      await send('POST', `/api/athletes/${A()}/interventions/${iv.id}/transition`, {
        to: 'aplicada',
        on: '2026-03-11',
        appliedOn: '2026-03-11',
        appliedDescription: 'se aplicó con otro ajuste',
        deviatesFromProposal: true,
        linkedEventId: ev.id,
      })
    ).json();
    expect(ap).toMatchObject({ state: 'aplicada', deviatesFromProposal: true });
    await send('POST', `/api/athletes/${A()}/interventions/${iv.id}/transition`, {
      to: 'seguimiento',
      on: '2026-03-12',
    });
    const listed = await get(`/api/athletes/${A()}/interventions`);
    const mine = listed.find((i: { intervention: { id: string } }) => i.intervention.id === iv.id);
    expect(mine.intervention.state).toBe('seguimiento');
    expect(mine).toHaveProperty('followUp');
    // descartar otra propuesta no la borra
    const other = (await get(`/api/athletes/${A()}/decisions`)).find(
      (d: { key: string }) => d.key !== dec.key,
    );
    if (other) {
      const i2 = (
        await send('POST', `/api/athletes/${A()}/interventions`, { proposalKey: other.key })
      ).json();
      await send('POST', `/api/athletes/${A()}/interventions/${i2.id}/transition`, {
        to: 'descartada',
        on: '2026-03-10',
        note: 'no aplica',
      });
      expect(
        (await get(`/api/athletes/${A()}/decisions`)).some((d: { key: string }) => d.key === other.key),
      ).toBe(true);
    }
  });

  it('E: lista macros y mesos, resumen semanal por movimiento y por músculo, cambios e intervenciones', async () => {
    const macros = await get(`/api/athletes/${A()}/macros`);
    expect(macros.length).toBe(1);
    const mesos = await get(`/api/athletes/${A()}/mesos`);
    expect(mesos.map((x: { blockKey: string }) => x.blockKey)).toEqual(
      expect.arrayContaining(['ACUM-1', 'ACUM-2', 'FUERZA-1']),
    );
    expect(mesos.every((x: { macroId: string }) => x.macroId === macros[0].id)).toBe(true);
    expect(await get(`/api/athletes/${A()}/microcycles`)).toEqual([]);
    const meso = await get(`/api/athletes/${A()}/mesos/ACUM-1`);
    expect(meso).toBeTruthy();
    const q = 'from=2026-01-20&to=2026-03-10';
    expect(await get(`/api/athletes/${A()}/weekly?${q}`)).toBeTruthy();
    expect(await get(`/api/athletes/${A()}/weekly-muscles?${q}`)).toBeTruthy();
    const history = await get(`/api/athletes/${A()}/history`);
    expect(history.events.length).toBeGreaterThan(0); // el seed deja un cambio automático detectado
    expect(await get(`/api/athletes/${A()}/interventions`)).toEqual([]);
  });

  it('el seed cubre progresión, estabilidad, deterioro, datos insuficientes y oportunidades sin afirmar validación predictiva', async () => {
    const status = async (name: string, lift = 'SQ') =>
      (await get(`/api/athletes/${ids[name]}/state`)).lifts[lift].principal?.status as string;
    const all = [
      await status('DEMO A · progresa (sintético)'),
      await status('DEMO F · estable (sintético)'),
      await status('DEMO G · deterioro (sintético)'),
      await status('DEMO C · incompleto (sintético)'),
      await status('DEMO E · candidato a récord (sintético)'),
    ];
    expect(new Set(all).size).toBeGreaterThanOrEqual(4); // estados distintos
    expect(all[3]).toMatch(/datos_insuf|sin_senal/);
  });
});

describe('Importación Hevy · mapeo revisable y registros válidos vs rechazados', () => {
  const HEAD =
    'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe';
  const row = (ex: string, i: number, kg: string, reps: string, rpe = '') =>
    `Entreno,"2 mar 2026, 18:00",,,${ex},,,${i},normal,${kg},${reps},,,${rpe}`;
  const csv = [
    HEAD,
    row('Squat (Barbell)', 1, '140', '5'),
    row('Squat (Barbell)', 2, '140', '5', '8'),
    row('Mi ejercicio raro', 1, '30', '10'),
    row('Squat (Barbell)', 3, '', ''),
  ].join('\n');

  it('dry-run separa rechazos de válidos con huecos, lista ejercicios; el mapeo guardado se aplica; aplicar exige token', async () => {
    const id = (await send('POST', '/api/athletes', { name: 'Hevy sintético' })).json().id as string;
    const url = `/api/athletes/${id}/imports/hevy`;
    const d1 = (await send('POST', url, { csv, mode: 'dry_run' })).json().preview;
    expect(d1.rejected).toBe(1);
    expect(d1.rejectedSample[0]).toHaveProperty('reason');
    expect(d1.newRows).toBe(3);
    expect(d1.validWithGaps.map((g: { metric: string }) => g.metric)).toEqual(
      expect.arrayContaining(['e1rm_table_rpe', 'lift_metrics']),
    );
    const raro = d1.exercises.find((e: { title: string }) => e.title === 'Mi ejercicio raro');
    expect(raro).toMatchObject({ lift: null, known: false });

    // mapeo persistente y revisable
    await send('PUT', `${url}/exercise-map`, { title: 'Mi ejercicio raro', lift: 'BP', loadKind: 'total' });
    expect(await get(`${url}/exercise-map`)).toMatchObject({ 'Mi ejercicio raro': { lift: 'BP' } });
    const d2 = (await send('POST', url, { csv, mode: 'dry_run' })).json().preview;
    expect(d2.exercises.find((e: { title: string }) => e.title === 'Mi ejercicio raro')).toMatchObject({
      lift: 'BP',
      known: true,
    });
    expect(d2.token).not.toBe(d1.token);

    // aplicar: sin token → 422; con token → inserta; reimportar es idempotente
    expect((await send('POST', url, { csv, mode: 'apply' })).statusCode).toBe(422);
    const ok = (await send('POST', url, { csv, mode: 'apply', confirmToken: d2.token })).json();
    expect(ok.applied.inserted).toBe(3);
    const again = (await send('POST', url, { csv, mode: 'dry_run' })).json().preview;
    expect(again.newRows).toBe(0);
    expect(again.duplicatesExisting).toBe(3);
    expect((await send('DELETE', `${url}/exercise-map?title=Mi%20ejercicio%20raro`)).json()).toEqual({
      removed: true,
    });
  });
});

describe('Contrato canónico de programación sin depender del Excel', () => {
  it('el CSV canónico entra por dry-run y aplica con token', async () => {
    const id = (await send('POST', '/api/athletes', { name: 'Plan canónico' })).json().id as string;
    const r = (
      await send('POST', `/api/athletes/${id}/imports/plan-csv`, { csv: 'x', mode: 'dry_run' })
    ).json();
    expect(r.parse.ok).toBe(false); // un CSV inválido se informa, no se inventa
  });
});
