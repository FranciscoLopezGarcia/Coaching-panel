import type { AppContext } from '../app.js';
import { addDays, buildDemoAthletes } from './demo.js';

/**
 * Carga los atletas SINTÉTICOS de demostración usando los mismos servicios que la API (idempotente por nombre) y los evalúa al día de hoy.
 * Devuelve nombre → id de los atletas creados en esta corrida.
 */
export async function seedDemoData(
  ctx: AppContext,
  log: (m: string) => void = () => {},
): Promise<Record<string, string>> {
  const today = ctx.today();
  const existing = new Set((await ctx.athletes.list()).map((a) => a.name));
  const created: Record<string, string> = {};
  for (const d of buildDemoAthletes(today)) {
    if (existing.has(d.name)) {
      log(`= ya existe: ${d.name}`);
      continue;
    }
    const a = await ctx.athletes.create(d.name, { SQ: 'Squat comp', BP: 'Bench comp', DL: 'Deadlift comp' });
    await ctx.athletes.setParams(a.id, d.params);
    // Versión 1 y, si cambia, versión 2: así el historial automático muestra un cambio real detectado.
    await ctx.plans.importPlan(a.id, {
      sets: d.planBase.map((s) => ({ ...s })),
      status: 'aplicado',
      replace: true,
      label: 'Plan inicial',
    });
    await ctx.records.upsertActual(a.id, d.actual, new Date().toISOString());
    const changed = JSON.stringify(d.planBase) !== JSON.stringify(d.planned);
    if (changed)
      await ctx.plans.importPlan(a.id, {
        sets: d.planned.map((s) => ({ ...s })),
        status: 'aplicado',
        replace: true,
        label: 'Ajuste de volumen',
      });
    // Macro → meso con fechas derivadas de las series previstas (sintético; solo para que el historial tenga estructura).
    const dates = d.planned.map((x) => x.plannedDate).sort();
    const macro = await ctx.programmingRepo.createMacro(a.id, {
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
      await ctx.programmingRepo.upsertMeso(a.id, {
        blockKey: bk as string,
        macroId: macro.id,
        name: `Meso ${bk}`,
        startDate: ds[0] as string,
        endDate: ds.at(-1) as string,
        objective: null,
      });
    }
    for (const c of d.checkins) await ctx.records.upsertCheckIn(a.id, c);
    for (const f of d.feedback) await ctx.history.upsertFeedback(a.id, f);
    for (const r of d.reviews) await ctx.history.upsertReview(a.id, r);
    for (const c of d.competitions)
      await ctx.history.addCompetition(a.id, {
        name: c.name,
        date: addDays(today, c.daysAhead),
        phase: c.phase,
      });
    await ctx.evaluation.evaluate(a.id, today);
    created[d.name] = a.id;
    log(`+ ${d.name} (${a.id})${changed ? ' · 2 versiones de plan' : ''}`);
  }
  return created;
}
