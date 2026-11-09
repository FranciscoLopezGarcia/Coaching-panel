import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildContext } from '../app.js';
import { loadConfig } from '../config.js';
import { seedDemoData } from './load.js';
import { seedProjectionDemo } from './projection.js';

/**
 * Demo SINTÉTICA AISLADA: crea una base NUEVA en la ruta indicada (por defecto ./data/demo-sintetica.sqlite) y se niega a tocar una existente.
 * Uso: npm run seed:synthetic -w @coaching/api -- [ruta.sqlite] [--with-projection]  (agrega un atleta sintético de 30 semanas para la proyección)
 * Luego: DB_PATH=<ruta> npm run dev:api
 */
const args = process.argv.slice(2);
const withProjection = args.includes('--with-projection');
const target = resolve(args.find((a) => !a.startsWith('--')) ?? './data/demo-sintetica.sqlite');
if (existsSync(target)) {
  console.error(`Ya existe ${target}. No se sobrescribe ni se modifica: elegí otra ruta o borrala vos.`);
  process.exit(1);
}
const config = { ...loadConfig(), dbPath: target };
const ctx = await buildContext(config);
const created = await seedDemoData(ctx, console.log);
if (withProjection) await seedProjectionDemo(ctx, console.log);
console.log(
  `\nBase sintética creada en ${target} (${Object.keys(created).length} atletas, sin datos reales).`,
);
console.log(`Para usarla: DB_PATH=${target} npm run dev:api`);
