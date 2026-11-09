import { buildContext } from '../app.js';
import { loadConfig } from '../config.js';
import { parseArgs } from './args.js';

/**
 * Preparación de un piloto: informe de SOLO LECTURA sobre qué datos hay y cuáles faltan para un atleta. No escribe ni inventa nada.
 *   npm run pilot:check -w @coaching/api -- --athlete <id> [--cutoff AAAA-MM-DD]
 */
const { opts } = parseArgs(process.argv.slice(2));
const id = opts.get('athlete');
if (!id) {
  console.error('Uso: --athlete <id> [--cutoff AAAA-MM-DD]');
  process.exit(2);
}
const config = loadConfig();
const ctx = await buildContext(config);
const a = await ctx.athletes.get(id);
if (!a) {
  console.error(`No existe el atleta ${id}`);
  process.exit(2);
}
const cutoff = opts.get('cutoff') ?? ctx.today();
const planned = await ctx.records.listActivePlanned(id);
const actual = await ctx.records.listActual(id);
const done = actual.filter((x) => x.status === 'done' && x.performedOn && x.performedOn <= cutoff);
const checkins = (await ctx.records.listCheckIns(id)).filter((c) => c.date <= cutoff);
const refs = await ctx.references.list(id);
const state = await ctx.queries.state(id);
const versions = await ctx.history.listVersions(id);
const rpeDone = done.filter((x) => x.rpe !== null).length;
const gaps: string[] = [];
if (!planned.length) gaps.push('No hay programación cargada.');
if (!versions.length)
  gaps.push('No hay versiones del plan: no se puede reconstruir qué se conocía en cada fecha.');
if (!done.length) gaps.push('No hay series realizadas hasta el corte.');
else if (rpeDone < done.length)
  gaps.push(
    `${done.length - rpeDone} de ${done.length} series realizadas no tienen RPE real: no habrá e1RM por curva para ellas.`,
  );
if (!refs.length)
  gaps.push(
    'No hay referencias de fuerza fechadas: no hay intensidad relativa ni protocolos por porcentaje.',
  );
if (!checkins.length) gaps.push('No hay cuestionarios hasta el corte: no se infiere recuperación.');
else if (
  checkins.at(-1)!.date <
  new Date(Date.parse(`${cutoff}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10)
)
  gaps.push(`Último cuestionario: ${checkins.at(-1)!.date} (más de 14 días antes del corte).`);
if (!(await ctx.programmingRepo.listMacros(id)).length)
  gaps.push('No hay macro/meso cargados (la vista por período sigue funcionando).');
const exercises = [...new Set(planned.map((s) => `${s.exerciseName} [${s.variantKey}] → ${s.exposureId}`))];
console.log(
  JSON.stringify(
    {
      baseDeDatos: config.dbPath,
      atleta: a.name,
      corte: cutoff,
      programacion: {
        series: planned.length,
        versiones: versions.map((v) => ({ seq: v.seq, estado: v.status, detectadaEl: v.detectedOn })),
        ejerciciosYExposiciones: exercises,
      },
      ejecucion: {
        seriesRealizadas: done.length,
        conRpeReal: rpeDone,
        ultimaFecha:
          done
            .map((x) => x.performedOn)
            .sort()
            .at(-1) ?? null,
      },
      cuestionarios: { cantidad: checkins.length, ultimo: checkins.at(-1)?.date ?? null },
      referencias: refs.map((r) => ({
        ejercicio: r.exerciseName,
        kg: r.kg,
        desde: r.asOf,
        origen: r.source,
      })),
      configuracionFaltante: state.missingConfig.filter((m) => planned.some((x) => x.lift === m.lift)),
      faltantes: gaps,
    },
    null,
    2,
  ),
);
