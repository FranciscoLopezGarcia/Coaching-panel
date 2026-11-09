import { readFileSync } from 'node:fs';
import { buildContext } from '../app.js';
import { loadConfig } from '../config.js';
import { parseArgs } from './args.js';
import { stepFor, type Lift } from '@coaching/engine';
import { toEngineParams } from '../services/params.js';

/**
 * Programación en el CSV canónico (plan-canonical-v1). Por defecto es un DRY-RUN: valida y muestra qué se cargaría; no escribe nada.
 * Para aplicar: --apply --token <token del dry-run>. Muestra siempre la BD de destino. El archivo se lee de tu disco y no se copia.
 *
 *   npm run import:plan -w @coaching/api -- --athlete <id> --file /ruta/plan.csv
 *   npm run import:plan -w @coaching/api -- --athlete <id> --file /ruta/plan.csv --apply --token <token>
 * Opciones: --status aplicado|borrador (default aplicado) · --replace (el CSV es el plan completo) · --label "texto"
 */
const { flags, opts } = parseArgs(process.argv.slice(2));
const athleteId = opts.get('athlete');
const file = opts.get('file');
if (!athleteId || !file) {
  console.error(
    'Uso: --athlete <id> --file <plan.csv> [--status aplicado|borrador] [--replace] [--label t] [--apply --token <t>]',
  );
  process.exit(2);
}
const config = loadConfig();
const ctx = await buildContext(config);
const a = await ctx.athletes.get(athleteId);
if (!a) {
  console.error(`No existe el atleta ${athleteId}`);
  process.exit(2);
}
const apply = flags.has('apply');
const status = (opts.get('status') ?? 'aplicado') as 'aplicado' | 'borrador';
const step = stepFor(toEngineParams(a.params), 'SQ' as Lift);
const r = await ctx.imports.planCsv(
  athleteId,
  {
    csv: readFileSync(file, 'utf8'),
    mode: apply ? 'apply' : 'dry_run',
    status,
    replace: flags.has('replace'),
    label: opts.get('label'),
    confirmToken: opts.get('token'),
  },
  step,
);
console.log(
  JSON.stringify({ baseDeDatos: config.dbPath, atleta: a.name, modo: r.mode, resultado: r.parse }, null, 2),
);
if (!apply)
  console.log(
    `\nDRY-RUN: no se escribió nada en ${config.dbPath}. Para aplicar:  --apply --token ${r.token}`,
  );
else console.log(`\nAplicado en ${config.dbPath}:`, JSON.stringify(r.applied));
