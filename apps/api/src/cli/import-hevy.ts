import { readFileSync } from 'node:fs';
import { buildContext } from '../app.js';
import { loadConfig } from '../config.js';
import { parseArgs } from './args.js';

/**
 * Importa el CSV de Hevy de un atleta. Por defecto es un DRY-RUN: lee, valida y muestra qué se importaría; no escribe nada.
 * Para aplicar: --apply --token <confirmToken del dry-run>. El archivo se lee de tu disco y no se copia ni se versiona.
 *
 *   npm run import:hevy -w @coaching/api -- --athlete <id> --file /ruta/workouts.csv
 *   npm run import:hevy -w @coaching/api -- --athlete <id> --file /ruta/workouts.csv --apply --token <token>
 */
const { flags, opts } = parseArgs(process.argv.slice(2));
const athleteId = opts.get('athlete');
const file = opts.get('file');
if (!athleteId || !file) {
  console.error(
    'Uso: --athlete <id> --file <workouts.csv> [--tz America/Argentina/Mendoza] [--apply --token <t>]',
  );
  process.exit(2);
}
const ctx = await buildContext(loadConfig());
if (!(await ctx.athletes.get(athleteId))) {
  console.error(`No existe el atleta ${athleteId}`);
  process.exit(2);
}
const apply = flags.has('apply');
const r = await ctx.imports.hevy(athleteId, {
  csv: readFileSync(file, 'utf8'),
  mode: apply ? 'apply' : 'dry_run',
  timeZone: opts.get('tz'),
  confirmToken: opts.get('token'),
});
const p = r.preview as {
  newRows: number;
  duplicatesExisting: number;
  duplicatesInFile: number;
  rejected: number;
  rejectedByReason: unknown[];
  sessions: number;
  dateRange: unknown;
  unmappedExercises: unknown[];
  warnings: string[];
  token: string;
  dateInterpretation: string;
  withRpe: number;
  withoutRpe: number;
  fatal: string[];
};
console.log(
  JSON.stringify(
    {
      modo: r.mode,
      nuevas: p.newRows,
      yaExistentes: p.duplicatesExisting,
      duplicadasEnArchivo: p.duplicatesInFile,
      rechazadas: p.rejected,
      motivosDeRechazo: p.rejectedByReason,
      sesiones: p.sessions,
      rangoDeFechas: p.dateRange,
      conRpe: p.withRpe,
      sinRpe: p.withoutRpe,
      ejerciciosSinMapeo: p.unmappedExercises,
      advertencias: p.warnings,
      fechas: p.dateInterpretation,
      errores: p.fatal,
    },
    null,
    2,
  ),
);
if (!apply) console.log(`\nDRY-RUN: no se escribió nada. Para aplicar:  --apply --token ${p.token}`);
else
  console.log(
    `\nAplicado: ${r.applied?.inserted} filas nuevas, ${r.applied?.ignored} ya existían (lote ${r.applied?.batchId}).`,
  );
