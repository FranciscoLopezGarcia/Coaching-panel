import { writeFileSync } from 'node:fs';
import { buildContext } from '../app.js';
import { loadConfig } from '../config.js';
import { parseArgs } from './args.js';

/**
 * Replay histórico de un atleta: reevalúa en cada corte usando solo lo conocido hasta esa fecha. No escribe en la base.
 *
 *   npm run replay -w @coaching/api -- --athlete <id> --from 2025-01-01 --to 2026-03-31 [--step weekly|sessions] [--out replay.json]
 */
const { opts } = parseArgs(process.argv.slice(2));
const athleteId = opts.get('athlete');
const from = opts.get('from');
const to = opts.get('to');
if (!athleteId || !from || !to) {
  console.error(
    'Uso: --athlete <id> --from yyyy-mm-dd --to yyyy-mm-dd [--step weekly|sessions] [--out archivo.json]',
  );
  process.exit(2);
}
const ctx = await buildContext(loadConfig());
const rep = await ctx.replay.run(athleteId, {
  from,
  to,
  step: opts.get('step') === 'sessions' ? 'sessions' : 'weekly',
});
const { points: _p, ...resumen } = rep;
void _p;
console.log(JSON.stringify(resumen, null, 2));
const out = opts.get('out');
if (out) {
  writeFileSync(out, JSON.stringify(rep, null, 2));
  console.log(`\nReporte completo (con cada corte) en ${out}`);
}
