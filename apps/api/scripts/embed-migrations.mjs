// Genera src/db/migrations.generated.ts con el SQL de las migraciones, para el bundle de Vercel (que no lleva archivos .sql sueltos).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = new URL('../src/db/migrations/', import.meta.url).pathname;
const files = readdirSync(dir)
  .filter((f) => /^\d+_.+\.sql$/.test(f))
  .sort();
const body = files
  .map((f) => `  { name: ${JSON.stringify(f)}, sql: ${JSON.stringify(readFileSync(join(dir, f), 'utf8'))} },`)
  .join('\n');
writeFileSync(
  new URL('../src/db/migrations.generated.ts', import.meta.url).pathname,
  `// GENERADO por scripts/embed-migrations.mjs — no editar a mano.\nexport const EMBEDDED_MIGRATIONS: { name: string; sql: string }[] = [\n${body}\n];\n`,
);
console.log(`${files.length} migraciones embebidas`);
