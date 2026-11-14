import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readinessOf } from '@coaching/engine';
import type { AppContext } from '../app.js';
import { NotFoundError } from '../services/errors.js';
import { parse } from './http.js';

const idParam = z.object({ id: z.string().min(1) });
const q = z.object({
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  format: z.enum(['md', 'json']).default('md'),
});
const n = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? '—' : String(Math.round(v * 10 ** d) / 10 ** d);

/**
 * Resumen del atleta pensado para pegar en una IA o archivarlo: SOLO LECTURA, mismo corte (`asOf`) y mismos números que la app.
 * Lo que falta se escribe «—» (nunca 0). No incluye datos de acceso ni contraseñas.
 */
export function registerExportRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/athletes/:id/export', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const a = await ctx.athletes.get(id);
    if (!a) throw new NotFoundError('Atleta inexistente');
    const o = parse(q, req.query);
    const asOf = o.asOf ?? ctx.today();
    const [analysis, perf, comps, checkins, extras, profile, marks] = await Promise.all([
      ctx.blockAnalysis.build(id, { asOf, source: 'actual', lift: 'ALL' }),
      ctx.historyService.performance(id, asOf),
      ctx.coachExtras.competitions(id),
      ctx.records.listCheckIns(id),
      ctx.records.listCheckInExtras(id),
      ctx.coachExtras.profile(id),
      ctx.coachExtras.marks(id),
    ]);
    const e1rm = Object.fromEntries(
      (['SQ', 'BP', 'DL'] as const).map((l) => {
        const ex = (perf[l]?.exposures ?? []).filter((x) => x.e !== null && x.date <= asOf);
        const best = ex.reduce<(typeof ex)[number] | null>(
          (m, x) => (m === null || (x.e ?? 0) > (m.e ?? 0) ? x : m),
          null,
        );
        const last = ex.at(-1) ?? null;
        return [
          l,
          {
            last: last ? { kg: last.e, date: last.date } : null,
            best: best ? { kg: best.e, date: best.date } : null,
          },
        ];
      }),
    );
    const blocks = (analysis?.window.blocks ?? []).map((b, i) => ({
      block: b.blockKey,
      from: b.start,
      to: b.end,
      weeks: b.weeks,
      closed: b.closed,
      metrics: Object.fromEntries((analysis?.rows ?? []).map((r) => [r.metricId, r.values[i] ?? null])),
      coverage: analysis?.quality[i]?.coverage ?? null,
      compliance: analysis?.compliance[i]
        ? {
            sessions: `${analysis.compliance[i]!.total.sessionsWithWork}/${analysis.compliance[i]!.total.sessionsPlanned}`,
            setsDone: analysis.compliance[i]!.total.setsDone,
            setsPlanned: analysis.compliance[i]!.total.setsPlanned,
            setsSkipped: analysis.compliance[i]!.total.setsSkipped,
            setsUnknown: analysis.compliance[i]!.total.setsUnknown,
            loadPct: analysis.compliance[i]!.load.meanPct,
          }
        : null,
      zones:
        analysis?.zones.byBlock[i]?.zones.map((z) => ({
          zone: z.label,
          range: z.range,
          shareSets: z.shareSets,
        })) ?? [],
    }));
    const since = new Date(`${asOf}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 56);
    const sinceIso = since.toISOString().slice(0, 10);
    const exMap = new Map(extras.map((x) => [x.date, x]));
    const recent = checkins
      .filter((c) => c.date >= sinceIso && c.date <= asOf)
      .map((c) => ({ ...c, readiness: readinessOf(c), ...(exMap.get(c.date) ?? {}) }));
    const data = {
      version: 'export-v1',
      asOf,
      athlete: {
        name: a.name,
        competitionExercises: a.competitionExercises,
        intensityCuts: a.params.intensityCuts ?? [75, 90],
      },
      profile: { ...profile, updatedAt: undefined },
      competitions: comps.map((c) => ({
        name: c.name,
        date: c.date,
        phase: c.phase,
        location: c.location,
        weightClass: c.weightClass,
        best: c.best,
        total: c.total,
        attempts: c.attempts.map((x) => ({
          lift: x.lift,
          n: x.attemptNo,
          plannedKg: x.plannedKg,
          actualKg: x.actualKg,
          result: x.result,
        })),
      })),
      marks,
      e1rm,
      blocks,
      recentCheckins: recent,
      notes: [
        'e1RM por curva RPE con RPE real; es una estimación, no un máximo medido.',
        'Series sin referencia fechada no entran en las zonas de intensidad.',
        'Plan y ejecución no se mezclan: las métricas de bloque son de lo ejecutado.',
      ],
    };
    if (o.format === 'json') return data;
    const L: string[] = [];
    L.push(
      `# ${a.name} · resumen al ${asOf}`,
      '',
      '_Resumen de solo lectura generado por la app de coaching. Lo que falta aparece como «—», no como 0._',
      '',
    );
    const pf = data.profile;
    L.push('## Perfil');
    L.push(
      `- sexo ${pf.sex ?? '—'} · peso ${n(pf.bodyweightKg)} kg · categoría ${pf.weightClass || '—'} · federación ${pf.federation || '—'} · equipo ${pf.equipment ?? '—'} · días/sem ${pf.daysPerWeek ?? '—'}`,
      ...(pf.goals ? [`- objetivo: ${pf.goals}`] : []),
      ...(pf.constraintsNotes ? [`- limitaciones: ${pf.constraintsNotes}`] : []),
    );
    L.push('', '## e1RM (curva RPE)');
    for (const l of ['SQ', 'BP', 'DL'] as const) {
      const v = e1rm[l]!;
      L.push(
        `- ${l}: último ${n(v.last?.kg)} kg (${v.last?.date ?? '—'}) · mayor observado ${n(v.best?.kg)} kg (${v.best?.date ?? '—'})`,
      );
    }
    L.push('', '## Competencias');
    L.push(
      ...(data.competitions.length
        ? data.competitions.map(
            (c) =>
              `- ${c.date} · ${c.name}${c.phase ? ` (${c.phase})` : ''}${c.attempts.length ? ` · válidos SQ ${n(c.best.SQ)} / BP ${n(c.best.BP)} / DL ${n(c.best.DL)} · total ${n(c.total)}` : ''}`,
          )
        : ['- sin competencias cargadas']),
    );
    L.push('', '## Marcas: competencia vs entrenamiento (no se estima una desde la otra)');
    for (const m of data.marks)
      L.push(
        `- ${m.lift}: competencia ${n(m.competition?.kg)} kg · entrenamiento (variante de competencia) mayor carga ${n(m.trainingHeaviest?.kg)} kg×${m.trainingHeaviest?.reps ?? '—'} · mejor single ${n(m.trainingSingle?.kg)} kg · mejor e1RM ${n(m.trainingE1rm?.kg)} kg`,
      );
    L.push('', '## Bloques recientes (por semana, lo ejecutado)');
    for (const b of blocks) {
      const m = b.metrics as Record<string, number | null>;
      L.push(
        `- **${b.block}** ${b.from}→${b.to} (${b.weeks} sem, ${b.closed ? 'cerrado' : 'en curso'}): NL ${n(m.nl_per_week)} reps/sem · series ${n(m.sets_per_week)} · tonelaje ${n(m.tonnage_per_week, 0)} · frecuencia ${n(m.frequency_per_week)} · %1RM medio ${n(m.intensity_pct_sets)} · RPE medio ${n(m.rpe_mean)} · cobertura ${b.coverage === null ? '—' : n(100 * b.coverage, 0) + '%'}`,
      );
      if (b.compliance)
        L.push(
          `  - cumplimiento: sesiones con trabajo ${b.compliance.sessions} · series hechas ${b.compliance.setsDone}/${b.compliance.setsPlanned} (omitidas ${b.compliance.setsSkipped}, sin registro ${b.compliance.setsUnknown}) · carga real/prevista ${b.compliance.loadPct === null ? '—' : n(b.compliance.loadPct, 0) + '%'}`,
        );
      if (b.zones.length)
        L.push(
          `  - zonas: ${b.zones.map((z) => `${z.zone} (${z.range}) ${z.shareSets === null ? '—' : n(100 * z.shareSets, 0) + '%'}`).join(' · ')}`,
        );
    }
    L.push('', '## Check-ins (últimas 8 semanas)');
    L.push(
      ...(recent.length
        ? recent.map(
            (c) =>
              `- ${c.date}: sueño ${n(c.sleep)} · energía ${n(c.energy)} · ganas ${n(c.motivation)} · estrés ${n(c.stress)} · molestias ${n(c.pain)} · disposición ${n(c.readiness)}${'soreness' in c ? ` · dolor muscular ${n((c as { soreness: number | null }).soreness)}` : ''}${'note' in c && (c as { note: string }).note ? ` · nota: ${(c as { note: string }).note}` : ''}`,
          )
        : ['- sin check-ins en el período']),
    );
    L.push('', '## Notas', ...data.notes.map((x) => `- ${x}`), '');
    reply.header('content-type', 'text/markdown; charset=utf-8');
    return L.join('\n');
  });
}
