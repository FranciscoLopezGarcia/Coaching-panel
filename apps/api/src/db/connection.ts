import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { runMigrations } from './migrate.js';

export type Db = DatabaseSyncType;

// `node:sqlite` se carga con require: vite-node (tests) no reconoce ese builtin y le quita el prefijo.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/** Abre SQLite (archivo local o ":memory:"), activa claves foráneas y aplica migraciones pendientes. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  runMigrations(db);
  return db;
}

/** Ejecuta `fn` dentro de una transacción (rollback ante error). */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
