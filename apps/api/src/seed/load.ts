import type { AppContext } from '../app.js';
import { addDays, buildDemoAthletes } from './demo.js';

/**
 * Carga los atletas SINTÉTICOS de demostración usando los mismos servicios que la API (idempotente por nombre) y los evalúa al día de hoy.
 * Devuelve nombre → id de los atletas creados en esta corrida.
 */
export function seedDemoData(ctx: AppContext, log: (m: string) => void = () => {}): Record<string, string> {
  const today = ctx.today();
  const existing = new Set(ctx.athletes.list().map((a) => a.name));
  const created: Record<string, string> = {};
  for (const d of buildDemoAthletes(today)) {
    if (existing.has(d.name)) {
      log(`= ya existe: ${d.name}`);
      continue;
    }
    const a = ctx.athletes.create(d.name, { SQ: 'Squat comp', BP: 'Bench comp', DL: 'Deadlift comp' });
    ctx.athletes.setParams(a.id, d.params);
    // Versión 1 y, si cambia, versión 2: así el historial automático muestra un cambio real detectado.
    ctx.plans.importPlan(a.id, {
      sets: d.planBase.map((s) => ({ ...s })),
      status: 'aplicado',
      replace: true,
      label: 'Plan inicial',
    });
    ctx.records.upsertActual(a.id, d.actual, new Date().toISOString());
    const changed = JSON.stringify(d.planBase) !== JSON.stringify(d.planned);
    if (changed)
      ctx.plans.importPlan(a.id, {
        sets: d.planned.map((s) => ({ ...s })),
        status: 'aplicado',
        replace: true,
        label: 'Ajuste de volumen',
      });
    // Macro → meso con fechas derivadas de las series previstas (sintético; solo para que el historial tenga estructura).
    const dates = d.planned.map((x) => x.plannedDate).sort();
    const macro = ctx.programmingRepo.createMacro(a.id, {
      name: `Macro de ${d.name.split(' · ')[0]}`,
      startDate: dates[0] as string,
      endDate: null,
      objective: 'demostración',
      status: 'activo',
    });
    for (const bk of new Set(d.planned.map((x) => x.blockKey))) {
      const ds = d.planned
        .filter((x) => x.blockKey === bk)
        .map((x) => x.plannedDate)
        .sort();
      ctx.programmingRepo.upsertMeso(a.id, {
        blockKey: bk as string,
        macroId: macro.id,
        name: `Meso ${bk}`,
        startDate: ds[0] as string,
        endDate: ds.at(-1) as string,
        objective: null,
      });
    }
    d.checkins.forEach((c) => ctx.records.upsertCheckIn(a.id, c));
    d.feedback.forEach((f) => ctx.history.upsertFeedback(a.id, f));
    d.reviews.forEach((r) => ctx.history.upsertReview(a.id, r));
    d.competitions.forEach((c) =>
      ctx.history.addCompetition(a.id, { name: c.name, date: addDays(today, c.daysAhead), phase: c.phase }),
    );
    ctx.evaluation.evaluate(a.id, today);
    created[d.name] = a.id;
    log(`+ ${d.name} (${a.id})${changed ? ' · 2 versiones de plan' : ''}`);
  }
  return created;
}
