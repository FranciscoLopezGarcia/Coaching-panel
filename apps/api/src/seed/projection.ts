import type { ActualSet, PlannedSet } from '@coaching/engine';
import type { AppContext } from '../app.js';
import { addDays } from './demo.js';

export const PROJECTION_DEMO_NAME = 'DEMO H · serie larga (sintético)';

/**
 * Atleta SINTÉTICO con 30 semanas de historia para probar `/performance-projection` (opcional: `seed:synthetic -- <ruta> --with-projection`).
 * Crece con ruido determinista las primeras 18 semanas y luego se estabiliza; las primeras 6 semanas no tienen RPE real (el método por curva aparece después).
 * No es un resultado real ni un caso de validación: sirve para ver todos los estados del contrato.
 */
export function seedProjectionDemo(ctx: AppContext, log: (m: string) => void = () => {}): string | null {
  if (ctx.athletes.list().some((a) => a.name === PROJECTION_DEMO_NAME)) {
    log(`= ya existe: ${PROJECTION_DEMO_NAME}`);
    return null;
  }
  const today = ctx.today();
  const a = ctx.athletes.create(PROJECTION_DEMO_NAME, {
    SQ: 'Squat comp',
    BP: 'Bench comp',
    DL: 'Deadlift comp',
  });
  const weeks = 30;
  const planned: PlannedSet[] = [];
  const actual: ActualSet[] = [];
  for (let i = 0; i < weeks; i++) {
    const date = addDays(today, -3 - 7 * (weeks - 1 - i));
    const noise = [0, 2.5, -2.5, 0, 2.5, -2.5, 5, 0][i % 8] as number;
    const kg = Math.round((100 + Math.min(i, 18) * 1.25 + noise) / 2.5) * 2.5;
    for (let k = 1; k <= 3; k++) {
      const id = `h-sq-${i + 1}-${k}`;
      planned.push({
        id,
        sessionKey: `h-sq-${i + 1}`,
        slotKey: 'squat-comp|D1',
        exerciseName: 'Squat comp',
        lift: 'SQ',
        plannedDate: date,
        setNo: k,
        reps: 5,
        targetRpe: 8,
        plannedKg: kg,
        isWarmup: false,
        blockKey: i < 15 ? 'LARGA-1' : 'LARGA-2',
        weekNo: (i % 15) + 1,
        dayNo: 1,
        familyKey: 'larga',
        refKg: 160,
        exposureId: 'sq-primaria',
        exposureRole: 'primaria',
        priority: 1,
        variantKey: 'Squat comp',
        copiedFrom: null,
        plannedKgSource: 'fixed',
        protocol: null,
      });
      actual.push({
        plannedSetId: id,
        status: 'done',
        kg,
        reps: 5,
        rpe: i < 6 ? null : 8,
        performedOn: date,
        pain: null,
      });
    }
  }
  ctx.plans.importPlan(a.id, {
    sets: planned.map((s) => ({ ...s })),
    status: 'aplicado',
    replace: true,
    label: 'Plan sintético largo',
  });
  ctx.records.upsertActual(a.id, actual, `${today}T12:00:00.000Z`);
  const macro = ctx.programmingRepo.createMacro(a.id, {
    name: 'Macro serie larga',
    startDate: addDays(today, -3 - 7 * (weeks - 1)),
    endDate: null,
    objective: 'demostración',
    status: 'activo',
  });
  for (const [bk, from, to] of [
    ['LARGA-1', 0, 14],
    ['LARGA-2', 15, 29],
  ] as const)
    ctx.programmingRepo.upsertMeso(a.id, {
      blockKey: bk,
      macroId: macro.id,
      name: `Meso ${bk}`,
      startDate: addDays(today, -3 - 7 * (weeks - 1 - from)),
      endDate: addDays(today, -3 - 7 * (weeks - 1 - to)),
      objective: null,
    });
  ctx.evaluation.evaluate(a.id, today);
  log(`+ ${PROJECTION_DEMO_NAME} (${a.id})`);
  return a.id;
}
