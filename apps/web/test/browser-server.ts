/** API real en memoria para pruebas del frontend. No usa seeds ni archivos SQLite. */
import { buildApp, buildContext } from '../../api/src/app.js';
const ctx = buildContext({
  port: Number(process.env.BASE_UI_TEST_PORT ?? 3117),
  host: '127.0.0.1',
  dbPath: ':memory:',
  webOrigin: process.env.BASE_UI_TEST_ORIGIN ?? 'http://127.0.0.1:5197',
  timeZone: 'America/Argentina/Mendoza',
});
const app = await buildApp(ctx);
const a = ctx.athletes.create('Atleta UI · SINTÉTICO', {
  SQ: 'Squat comp',
  BP: 'Bench comp',
  DL: 'Deadlift comp',
});
const cutoff = ctx.today();
const shift = (n: number) =>
  new Date(Date.parse(cutoff + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const sets = Array.from({ length: 24 }, (_, i) => ({
  id: `ui-${i}`,
  sessionKey: `ui-session-${i}`,
  slotKey: 'sq-a',
  exerciseName: 'Squat comp',
  lift: 'SQ',
  plannedDate: shift((i - 23) * 4),
  setNo: 1,
  reps: 5,
  targetRpe: 8,
  plannedKg: 100 + i,
  isWarmup: false,
  blockKey: 'UI-1',
  weekNo: Math.floor(i / 2) + 1,
  dayNo: i % 2 ? 4 : 1,
  familyKey: 'UI',
  refKg: 180,
  exposureId: 'sq-primary',
  variantKey: 'comp',
  protocol: {
    loadMode: 'kg',
    pct: null,
    capKg: null,
    segment: 'work',
    tempo: null,
    pauseSec: null,
    instructions: null,
  },
}));
await app.inject({ method: 'POST', url: `/api/athletes/${a.id}/plan`, payload: { sets } });
await app.inject({
  method: 'POST',
  url: `/api/athletes/${a.id}/sets`,
  payload: {
    sets: sets.map((s, i) => ({
      plannedSetId: s.id,
      status: 'done',
      kg: 100 + i,
      reps: 5,
      rpe: 8,
      performedOn: s.plannedDate,
      pain: null,
    })),
  },
});
const macro = ctx.programmingRepo.createMacro(a.id, {
  name: 'Macro UI · sintético',
  startDate: shift(-100),
  endDate: null,
  objective: 'Prueba de interfaz',
  status: 'activo',
});
ctx.programmingRepo.upsertMeso(a.id, {
  macroId: macro.id,
  blockKey: 'UI-1',
  name: 'Fuerza · UI',
  startDate: shift(-100),
  endDate: shift(14),
  objective: 'Prueba',
});
await app.inject({ method: 'POST', url: `/api/athletes/${a.id}/evaluate`, payload: {} });
await app.listen({ host: '127.0.0.1', port: Number(process.env.BASE_UI_TEST_PORT ?? 3117) });
console.log('UI_SYNTHETIC_READY', a.id);
