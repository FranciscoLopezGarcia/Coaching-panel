import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, buildContext, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';

/** Sesiones/protocolos completos y proyección de rendimiento por HTTP. Datos 100 % sintéticos, BD en memoria. */
const TODAY = '2026-06-30';
let app: FastifyInstance;
let ctx: AppContext;
const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();
const send = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object });
beforeEach(async () => {
  ctx = await buildContext({ ...loadConfig({}), dbPath: ':memory:' }, await openDb(':memory:'), () => TODAY);
  app = await buildApp(ctx);
});
const newAthlete = async (name = 'Sintético') =>
  (await send('POST', '/api/athletes', { name })).json().id as string;
const day = (n: number) => new Date(Date.UTC(2026, 2, 2 + n)).toISOString().slice(0, 10);

const mk = (session: string, n: number, date: string, o: Record<string, unknown> = {}) => ({
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
  weekNo: 1,
  dayNo: 1,
  familyKey: 'F1',
  refKg: 150,
  exposureId: 'sq-primaria',
  variantKey: 'Squat comp',
  ...o,
});

/** Sesión con aproximación, top set, back-offs y un segundo ejercicio. */
const richSession = () => [
  mk('s1', 1, day(0), { isWarmup: true, plannedKg: 60, targetRpe: null }),
  mk('s1', 2, day(0), {
    plannedKg: null,
    protocol: { loadMode: 'rpe_cap', capKg: 120, segment: 'top' },
    priority: 1,
  }),
  mk('s1', 3, day(0), {
    plannedKg: null,
    protocol: { loadMode: 'pct', pct: 80, segment: 'backoff', tempo: '3-1-0' },
  }),
  mk('s1', 4, day(0), { plannedKg: null, protocol: { loadMode: 'pct', pct: 80, segment: 'backoff' } }),
  mk('s1', 5, day(0), {
    exerciseName: 'Fondos',
    lift: null,
    exposureId: 'fondos',
    variantKey: 'Fondos',
    plannedKg: 20,
    refKg: null,
    priority: 3,
  }),
];

describe('Sesiones y protocolos completos', () => {
  it('GET /sessions: ids estables, ejercicios, segmentos, aproximaciones y protocolo por serie', async () => {
    const id = await newAthlete();
    await send('POST', `/api/athletes/${id}/plan`, { sets: richSession(), status: 'aplicado' });
    const [s] = await get(`/api/athletes/${id}/sessions`);
    expect(s.sets).toHaveLength(5); // incluye la aproximación
    expect(s.sets.map((x: { plannedSetId: string }) => x.plannedSetId)).toEqual([
      's1-1',
      's1-2',
      's1-3',
      's1-4',
      's1-5',
    ]);
    expect(s.sets[0]).toMatchObject({ isWarmup: true, exposureId: 'sq-primaria', retired: false });
    expect(s.sets[1]).toMatchObject({
      protocol: { loadMode: 'rpe_cap', segment: 'top', capKg: 120 },
      priority: 1,
    });
    expect(s.sets[2].protocol).toMatchObject({ segment: 'backoff', tempo: '3-1-0' });
    expect(s.sets[2].planned.kg).toBe(120); // resuelto por el motor
    expect(s.exercises.map((e: { exposureId: string }) => e.exposureId)).toEqual(['sq-primaria', 'fondos']);
    expect(s.segments.map((g: { segment: string }) => g.segment)).toEqual(['work', 'top', 'backoff', 'work']);
    expect(s.segments.find((g: { segment: string }) => g.segment === 'backoff').setIds).toEqual([
      's1-3',
      's1-4',
    ]);
  });

  it('GET /plan: prescripción íntegra con filtros, protocolo resuelto y ejecución vinculada; permite registrar una serie copiada por el servidor', async () => {
    const id = await newAthlete();
    await send('POST', `/api/athletes/${id}/plan`, { sets: richSession(), status: 'aplicado' });
    await send('POST', `/api/athletes/${id}/program`, {
      mode: 'apply',
      op: { type: 'duplicate_session', sessionKey: 's1', newSessionKey: 's2', plannedDate: day(3), dayNo: 4 },
    });
    const all = await get(`/api/athletes/${id}/plan`);
    expect(all.count).toBe(10);
    expect(all.baseVersionId).toBeTruthy();
    const copy = (await get(`/api/athletes/${id}/plan?sessionKey=s2`)).sets;
    expect(copy).toHaveLength(5);
    expect(
      copy.every(
        (x: { copiedFrom: string; exposureId: string }) =>
          x.copiedFrom && ['sq-primaria', 'fondos'].includes(x.exposureId),
      ),
    ).toBe(true); // linaje + identidad
    expect(copy[2].resolved).toMatchObject({ kg: 120, source: 'derived' });
    expect(copy.every((x: { actual: unknown }) => x.actual === null)).toBe(true);
    expect((await get(`/api/athletes/${id}/plan?exposureId=fondos`)).count).toBe(2);
    // registro universal: el id viene de la lectura del plan, no de memoria del navegador
    const target = copy[1].id as string;
    const r = await send('POST', `/api/athletes/${id}/sets`, {
      sets: [
        { plannedSetId: target, status: 'done', kg: 118, reps: 5, rpe: 8, performedOn: day(3), pain: null },
      ],
    });
    expect(r.statusCode).toBe(200);
    expect((await get(`/api/athletes/${id}/plan?sessionKey=s2`)).sets[1].actual).toMatchObject({
      kg: 118,
      rpe: 8,
    });
    expect(
      (await get(`/api/athletes/${id}/plan?sessionKey=s1`)).sets.every(
        (x: { actual: unknown }) => x.actual === null,
      ),
    ).toBe(true);
  });

  it('editar un segmento (top) por segmentKeys o por setIds sin tocar el resto', async () => {
    const id = await newAthlete();
    await send('POST', `/api/athletes/${id}/plan`, { sets: richSession(), status: 'aplicado' });
    const [s] = await get(`/api/athletes/${id}/sessions`);
    const top = s.segments.find((g: { segment: string }) => g.segment === 'top').segmentKey as string;
    const prev = (
      await send('POST', `/api/athletes/${id}/program`, {
        mode: 'preview',
        op: { type: 'change_protocol', selection: { segmentKeys: [top] }, change: { targetRpe: 9 } },
      })
    ).json();
    expect(prev.saved).toBeNull();
    expect(prev.preview.event.setChanges.modified).toBe(1);
    await send('POST', `/api/athletes/${id}/program`, {
      mode: 'apply',
      baseVersionId: prev.baseVersionId,
      op: { type: 'change_protocol', selection: { segmentKeys: [top] }, change: { targetRpe: 9 } },
    });
    let sets = (await get(`/api/athletes/${id}/sessions`))[0].sets;
    expect(sets.map((x: { planned: { targetRpe: number } }) => x.planned.targetRpe)).toEqual([
      null,
      9,
      8,
      8,
      8,
    ]);
    await send('POST', `/api/athletes/${id}/program`, {
      mode: 'apply',
      op: { type: 'change_protocol', selection: { setIds: ['s1-4'] }, change: { reps: 3 } },
    });
    sets = (await get(`/api/athletes/${id}/sessions`))[0].sets;
    expect(sets.map((x: { planned: { reps: number } }) => x.planned.reps)).toEqual([5, 5, 5, 3, 5]);
    // compatibilidad: las claves desconocidas siguen siendo 400 y una selección vacía 422
    expect(
      (
        await send('POST', `/api/athletes/${id}/program`, {
          mode: 'apply',
          op: { type: 'change_protocol', selection: { setId: ['s1-4'] }, change: { reps: 1 } },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await send('POST', `/api/athletes/${id}/program`, {
          mode: 'apply',
          op: { type: 'change_protocol', selection: { setIds: ['no-existe'] }, change: { reps: 1 } },
        })
      ).statusCode,
    ).toBe(422);
  });

  it('quitar series: la vista previa avisa si tienen ejecución; la ejecución y la historia se conservan (retired)', async () => {
    const id = await newAthlete();
    await send('POST', `/api/athletes/${id}/plan`, { sets: richSession(), status: 'aplicado' });
    await send('POST', `/api/athletes/${id}/sets`, {
      sets: [
        { plannedSetId: 's1-4', status: 'done', kg: 120, reps: 5, rpe: 8, performedOn: day(0), pain: null },
      ],
    });
    const op = { type: 'remove_sets', selection: { setIds: ['s1-3', 's1-4'] } };
    const prev = (await send('POST', `/api/athletes/${id}/program`, { mode: 'preview', op })).json();
    expect(prev.warnings.join(' ')).toMatch(/1 serie\(s\) tienen ejecución/);
    expect((await get(`/api/athletes/${id}/plan`)).count).toBe(5); // la vista previa no escribe
    await send('POST', `/api/athletes/${id}/program`, { mode: 'apply', op });
    expect((await get(`/api/athletes/${id}/plan`)).count).toBe(3);
    const sets = (await get(`/api/athletes/${id}/sessions`))[0].sets;
    expect(sets.find((x: { plannedSetId: string }) => x.plannedSetId === 's1-4')).toMatchObject({
      retired: true,
      actual: { kg: 120 },
    });
    expect(sets.find((x: { plannedSetId: string }) => x.plannedSetId === 's1-3')).toBeUndefined(); // sin ejecución: se borra
    expect(await ctx.records.listActual(id)).toHaveLength(1);
  });

  it('agregar series con vista previa; un id repetido nunca pisa lo existente', async () => {
    const id = await newAthlete();
    await send('POST', `/api/athletes/${id}/plan`, { sets: richSession(), status: 'aplicado' });
    const fresh = [mk('s9', 1, day(2), { weekNo: 1, dayNo: 3 })];
    const prev = (
      await send('POST', `/api/athletes/${id}/program`, {
        mode: 'preview',
        op: { type: 'add_sets', sets: fresh },
      })
    ).json();
    expect(prev.preview.addedSets).toBe(1);
    expect((await get(`/api/athletes/${id}/plan`)).count).toBe(5);
    await send('POST', `/api/athletes/${id}/program`, {
      mode: 'apply',
      op: { type: 'add_sets', sets: fresh },
    });
    expect((await get(`/api/athletes/${id}/plan`)).count).toBe(6);
    const dup = await send('POST', `/api/athletes/${id}/program`, {
      mode: 'apply',
      op: { type: 'add_sets', sets: [mk('s1', 1, day(0), { plannedKg: 999 })] },
    });
    expect(dup.statusCode).toBe(422);
    expect(dup.json().error).toMatch(/no se sobrescribe/);
  });

  it('control de concurrencia: aplicar con una versión base vieja da 409 y no escribe', async () => {
    const id = await newAthlete();
    await send('POST', `/api/athletes/${id}/plan`, { sets: richSession(), status: 'aplicado' });
    const op = { type: 'change_protocol', selection: { setIds: ['s1-2'] }, change: { targetRpe: 9 } };
    const prev = (await send('POST', `/api/athletes/${id}/program`, { mode: 'preview', op })).json();
    await send('POST', `/api/athletes/${id}/program`, {
      mode: 'apply',
      op: { type: 'change_protocol', selection: { setIds: ['s1-5'] }, change: { reps: 8 } },
    }); // cambio concurrente
    const r = await send('POST', `/api/athletes/${id}/program`, {
      mode: 'apply',
      baseVersionId: prev.baseVersionId,
      op,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().details.received).toBe(prev.baseVersionId);
    expect((await get(`/api/athletes/${id}/plan?exposureId=sq-primaria`)).sets[1].targetRpe).toBe(8);
    // sin baseVersionId (compatibilidad) sigue aplicando
    expect((await send('POST', `/api/athletes/${id}/program`, { mode: 'apply', op })).statusCode).toBe(200);
  });

  it('historial de publicación: borrador reabrible y versiones con foto completa; copiar conserva linaje', async () => {
    const id = await newAthlete();
    await send('POST', `/api/athletes/${id}/plan`, { sets: richSession(), status: 'aplicado', label: 'v1' });
    const dr = (
      await send('POST', `/api/athletes/${id}/program`, {
        mode: 'draft',
        label: 'borrador',
        op: { type: 'duplicate_session', sessionKey: 's1', newSessionKey: 's2', plannedDate: day(3) },
      })
    ).json();
    expect(dr.saved.status).toBe('borrador');
    const snap = await get(`/api/athletes/${id}/plan-versions/${dr.saved.version.id}`);
    expect(snap).toMatchObject({ status: 'borrador', count: 10, label: 'borrador' });
    expect(snap.sets[7].segmentKey).toMatch(/^s2\|/);
    expect(snap.sets.filter((x: { copiedFrom: string | null }) => x.copiedFrom).length).toBe(5);
    expect((await send('GET', `/api/athletes/${id}/plan-versions/nope`)).statusCode).toBe(404);
    expect((await get(`/api/athletes/${id}/plan`)).count).toBe(5); // el borrador no toca el plan vigente
  });
});

/* ---------------- Proyección ---------------- */
async function weeklyAthlete(
  n: number,
  kgOf: (i: number) => number,
  opts: { rpe?: number | null; exercise?: string; variant?: string; start?: number } = {},
) {
  const id = await newAthlete('Proyección sintética');
  const sets = [];
  const done = [];
  for (let i = 0; i < n; i++) {
    const date = day((opts.start ?? 0) + i * 7);
    for (let k = 1; k <= 3; k++) {
      const sid = `w${i}-${k}`;
      sets.push(
        mk(`w${i}`, k, date, {
          exerciseName: opts.exercise ?? 'Squat comp',
          variantKey: opts.variant ?? 'Squat comp',
          plannedKg: kgOf(i),
          blockKey: i < 8 ? 'M1' : 'M2',
          weekNo: (i % 8) + 1,
          exposureId: 'sq-primaria',
        }),
      );
      done.push({
        plannedSetId: sid,
        status: 'done',
        kg: kgOf(i),
        reps: 5,
        rpe: opts.rpe === undefined ? 8 : opts.rpe,
        performedOn: date,
        pain: null,
      });
    }
  }
  await send('POST', `/api/athletes/${id}/plan`, { sets, status: 'aplicado' });
  await send('POST', `/api/athletes/${id}/sets`, { sets: done });
  return id;
}

describe('GET /performance-projection', () => {
  it('serie creciente: available, con observados, ajustados, futuro, validación y resumen', async () => {
    const id = await weeklyAthlete(16, (i) => 100 + 2 * i);
    const r = await get(`/api/athletes/${id}/performance-projection?lift=SQ&cutoff=${day(15 * 7 + 3)}`);
    expect(r).toMatchObject({
      contractVersion: 'performance-projection-v1',
      status: 'available',
      target: { variable: 'e1rm_table_rpe', unit: 'kg', variantKey: 'Squat comp' },
    });
    expect(r.observedPoints).toHaveLength(16);
    expect(r.observedPoints[0].setIds).toHaveLength(3);
    expect(r.fittedPoints).toHaveLength(16);
    expect(r.forecastPoints.at(-1).horizonDays).toBe(28);
    expect(r.baselineForecastPoints.length).toBe(r.forecastPoints.length);
    expect(r.validation.evaluations).toBeGreaterThan(0);
    expect(r.summary.lines.length).toBeLessThanOrEqual(3);
    expect(r.limitations.join(' ')).toMatch(/no equivale/);
    // disponibilidad del registro conocida (creada vía API): fecha de la revisión de creación
    expect(r.observedPoints[0].availableOn).toBe(TODAY);
  });

  it('sin fuga: el corte excluye lo posterior aunque exista en la BD', async () => {
    const id = await weeklyAthlete(16, (i) => 100 + 2 * i);
    const cut = day(9 * 7 + 1);
    const r = await get(`/api/athletes/${id}/performance-projection?lift=SQ&cutoff=${cut}`);
    expect(r.observedPoints).toHaveLength(10);
    expect(r.observedPoints.every((p: { date: string }) => p.date <= cut)).toBe(true);
    expect(r.cutoff).toBe(cut);
  });

  it('vista por meso/macro/período no cambia el ajuste salvo scope=view, e identifica el período de entrenamiento', async () => {
    const id = await weeklyAthlete(16, (i) => 100 + 2 * i);
    const macro = (
      await send('POST', `/api/athletes/${id}/macros`, { name: 'Macro', startDate: day(0) })
    ).json();
    await send('PUT', `/api/athletes/${id}/mesos`, {
      blockKey: 'M2',
      macroId: macro.id,
      name: 'Meso 2',
      startDate: day(56),
      endDate: day(112),
    });
    const q = `lift=SQ&cutoff=${day(15 * 7 + 3)}`;
    const full = await get(`/api/athletes/${id}/performance-projection?${q}`);
    const meso = await get(`/api/athletes/${id}/performance-projection?${q}&blockKey=M2`);
    expect(meso.periods.view).toMatchObject({ kind: 'meso', label: 'Meso 2' });
    expect(meso.periods.training).toMatchObject({ scope: 'history', from: day(0) });
    expect(meso.fittedPoints).toEqual(full.fittedPoints);
    expect(meso.observedPoints.filter((p: { inView: boolean }) => p.inView)).toHaveLength(8);
    const only = await get(`/api/athletes/${id}/performance-projection?${q}&blockKey=M2&scope=view`);
    expect(only.periods.training).toMatchObject({ scope: 'view', from: day(56) });
    expect(only.observedPoints).toHaveLength(8);
    const mac = await get(`/api/athletes/${id}/performance-projection?${q}&macroId=${macro.id}`);
    expect(mac.periods.view.kind).toBe('macro');
    const free = await get(`/api/athletes/${id}/performance-projection?${q}&from=${day(14)}&to=${day(500)}`);
    expect(free.periods.view.to).toBe(day(15 * 7 + 3)); // la vista nunca supera el corte
  });

  it('filtros por exposureId y variante; varias variantes ⇒ variant_required sin mezclar', async () => {
    const id = await weeklyAthlete(10, (i) => 100 + i);
    const byExp = await get(
      `/api/athletes/${id}/performance-projection?exposureId=sq-primaria&cutoff=${day(70)}`,
    );
    expect(byExp.target.exercise).toBe('Squat comp');
    expect(byExp.observedPoints.length).toBe(10);
    // segunda variante del mismo lift
    await send('POST', `/api/athletes/${id}/plan`, {
      sets: [
        mk('p1', 1, day(2), {
          exerciseName: 'Squat pausa',
          variantKey: 'Pausa',
          exposureId: 'sq-pausa',
          id: 'p1-1',
        }),
      ],
      status: 'aplicado',
    });
    await send('POST', `/api/athletes/${id}/sets`, {
      sets: [
        { plannedSetId: 'p1-1', status: 'done', kg: 90, reps: 5, rpe: 8, performedOn: day(2), pain: null },
      ],
    });
    const amb = await get(`/api/athletes/${id}/performance-projection?lift=SQ&cutoff=${day(70)}`);
    expect(amb).toMatchObject({ status: 'unavailable', reasons: [{ code: 'variant_required' }] });
    expect(amb.selection.availableVariants).toHaveLength(2);
    const ok = await get(
      `/api/athletes/${id}/performance-projection?lift=SQ&exercise=${encodeURIComponent('Squat pausa')}&variantKey=Pausa&cutoff=${day(70)}`,
    );
    expect(ok.observedPoints).toHaveLength(1);
    expect(ok.status).toBe('descriptive_only');
  });

  it('RPE faltante: e1RM por curva no disponible (motivo); fórmulas es otro método pedido explícitamente', async () => {
    const id = await weeklyAthlete(10, (i) => 100 + i, { rpe: null });
    const curve = await get(`/api/athletes/${id}/performance-projection?lift=SQ&cutoff=${day(70)}`);
    expect(curve).toMatchObject({ status: 'unavailable', reasons: [{ code: 'no_rpe' }] });
    const prg = await get(
      `/api/athletes/${id}/performance-projection?lift=SQ&variable=e1rm_prg_formulas&cutoff=${day(70)}`,
    );
    expect(prg.target.method.id).toBe('prg-6-formulas');
    expect(prg.observedPoints).toHaveLength(10);
  });

  it('descriptive_only con pocas exposiciones y horizonte excesivo; rango no disponible sin muestra', async () => {
    const few = await weeklyAthlete(4, (i) => 100 + i);
    const r = await get(`/api/athletes/${few}/performance-projection?lift=SQ&cutoff=${day(30)}`);
    expect(r.status).toBe('descriptive_only');
    expect(r.forecastPoints).toEqual([]);
    expect(r.forecastRange.status).toBe('unavailable');
    const mid = await weeklyAthlete(9, (i) => 100 + i);
    const far = await get(
      `/api/athletes/${mid}/performance-projection?lift=SQ&horizonDays=80&cutoff=${day(63)}`,
    );
    expect(far.reasons.some((x: { code: string }) => x.code === 'horizon_exceeds_history')).toBe(true);
  });

  it('validaciones: 400 sin filtro, con dos vistas o scope=view sin vista; 422 exposureId inexistente; 404 atleta', async () => {
    const id = await weeklyAthlete(6, () => 100);
    const base = `/api/athletes/${id}/performance-projection`;
    expect((await send('GET', base)).statusCode).toBe(400);
    expect((await send('GET', `${base}?lift=SQ&blockKey=M1&from=${day(1)}`)).statusCode).toBe(400);
    expect((await send('GET', `${base}?lift=SQ&scope=view`)).statusCode).toBe(400);
    expect((await send('GET', `${base}?lift=SQ&horizonDays=0`)).statusCode).toBe(400);
    expect((await send('GET', `${base}?exposureId=zzz`)).statusCode).toBe(422);
    expect((await send('GET', `${base}?lift=SQ&blockKey=NOPE`)).statusCode).toBe(404);
    expect((await send('GET', '/api/athletes/nope/performance-projection?lift=SQ')).statusCode).toBe(404);
    expect(await ctx.records.listActual(id)).toHaveLength(18); // solo lectura: no escribió nada
  });
});
