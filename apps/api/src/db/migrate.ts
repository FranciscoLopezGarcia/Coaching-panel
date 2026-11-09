import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './connection.js';
import { EMBEDDED_MIGRATIONS } from './migrations.generated.js';

/** Migraciones del disco (dev/tests) o, si no hay carpeta (bundle de Vercel), las embebidas en el código. */
function migrationFiles(): { name: string; sql: string }[] {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const c of [
    join(here, 'migrations'),
    join(here, 'db', 'migrations'),
    join(here, '..', 'src', 'db', 'migrations'),
  ]) {
    if (existsSync(c))
      return readdirSync(c)
        .filter((f) => /^\d+_.+\.sql$/.test(f))
        .sort()
        .map((f) => ({ name: f, sql: readFileSync(join(c, f), 'utf8') }));
  }
  return EMBEDDED_MIGRATIONS;
}

/** Migraciones NNN_nombre.sql, aplicadas una sola vez y en orden. Nunca se editan las ya aplicadas. */
export async function runMigrations(db: Db): Promise<string[]> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const done = new Set(
    (await db.all<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name),
  );
  const applied: string[] = [];
  for (const { name: file, sql } of migrationFiles()) {
    if (done.has(file)) continue;
    try {
      // el script y su registro van en un solo bloque: o se aplica todo o nada
      const stamp = `INSERT INTO schema_migrations (name, applied_at) VALUES ('${file.replace(/'/g, "''")}', '${new Date().toISOString()}');`;
      await db.exec(`BEGIN;\n${sql}\n${stamp}\nCOMMIT;`);
      applied.push(file);
    } catch (e) {
      await db.exec('ROLLBACK').catch(() => undefined);
      throw new Error(`Migración ${file} falló: ${(e as Error).message}`);
    }
  }
  return applied;
}
