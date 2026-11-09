import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildContext } from '../app.js';
import { loadConfig } from '../config.js';
import { LAB_CASES, LAB_DEFAULT_START, createLab } from './lab.js';

/**
 * Laboratorio FICTICIO aislado: crea una BD NUEVA (nunca toca una existente ni la BD por defecto) con 6 casos reproducibles.
 * Uso: npm run lab:create -w @coaching/api -- <ruta.sqlite> [--start AAAA-MM-DD(lunes)] [--only A,B]
 * Luego: DB_PATH=<ruta> PORT=3200 npm run dev -w @coaching/api
 */
const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const path = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!path) {
  console.error('Indicá la ruta de la BD NUEVA del laboratorio, p. ej. ./data/laboratorio.sqlite');
  process.exit(2);
}
const target = resolve(path);
const protectedDefault = resolve(loadConfig().dbPath);
if (target === protectedDefault || /coaching\.sqlite/.test(target)) {
  console.error(`Ruta protegida: ${target} parece la BD de trabajo. Elegí otra para el laboratorio.`);
  process.exit(1);
}
if (existsSync(target)) {
  console.error(`Ya existe ${target}. No se sobrescribe ni se modifica: elegí otra ruta o borrala vos.`);
  process.exit(1);
}
const start = flag('--start') ?? LAB_DEFAULT_START;
if (new Date(`${start}T00:00:00Z`).getUTCDay() !== 1) {
  console.error('--start debe ser un lunes (AAAA-MM-DD).');
  process.exit(2);
}
mkdirSync(dirname(target), { recursive: true });
const clock = { value: start };
const ctx = await buildContext({ ...loadConfig(), dbPath: target }, undefined, () => clock.value);
const only = flag('--only')?.split(',');
const made = await createLab(ctx, clock, start, console.log, only);
// identificación de la instancia (no requiere migración): la API la expone en /api/health y /api/instance
const datasetId = `lab-${start}-${createHash('sha1')
  .update(made.map((m) => m.key).join(''))
  .digest('hex')
  .slice(0, 8)}`;
writeFileSync(
  `${target}.instance.json`,
  JSON.stringify(
    {
      mode: 'laboratory',
      fictitious: true,
      datasetId,
      label: 'Laboratorio de pruebas (ficticio)',
      createdAt: new Date().toISOString(),
      cases: made.map((m) => {
        const c = LAB_CASES.find((x) => x.key === m.key)!;
        return {
          key: m.key,
          name: m.name,
          athleteId: m.id,
          summary: c.summary,
          explores: c.explores,
          objective: c.objective,
          cutoffs: m.cutoffs,
        };
      }),
    },
    null,
    2,
  ),
);
console.log(`\nLaboratorio FICTICIO creado en ${target} (${made.length} casos, inicio ${start}).`);
console.log(
  `Levantar: DB_PATH=${target} PORT=3200 npm run dev -w @coaching/api   (y WEB_API_TARGET=http://127.0.0.1:3200 para el front)`,
);
