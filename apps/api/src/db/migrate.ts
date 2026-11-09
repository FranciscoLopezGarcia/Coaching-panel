import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

/** Carpeta de migraciones: junto al código (dev) o junto al bundle (dist/migrations). */
function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const c of [
    join(here, 'migrations'),
    join(here, 'db', 'migrations'),
    join(here, '..', 'src', 'db', 'migrations'),
  ]) {
    if (existsSync(c)) return c;
  }
  throw new Error('No se encontró la carpeta de migraciones');
}

/** Migraciones NNN_nombre.sql, aplicadas una sola vez y en orden. Nunca se editan las ya aplicadas. */
export function runMigrations(db: DatabaseSync): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name),
  );
  const dir = migrationsDir();
  const applied: string[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()) {
    if (done.has(file)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(join(dir, file), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
      applied.push(file);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migración ${file} falló: ${(e as Error).message}`);
    }
  }
  return applied;
}
