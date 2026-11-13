/**
 * Respaldo completo (solo lectura) de la base a un JSON local: una entrada por tabla. Sirve antes de cualquier deploy con migraciones.
 *   npm run db:backup -w @coaching/api            → usa COACHING_DB_URL / TURSO_DATABASE_URL / DB_PATH
 * Escribe en apps/api/backups/ (ignorado por git: contiene datos personales). Nunca modifica la base.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/connection.js';

const cfg = loadConfig();
const db = await openDb(cfg.dbPath, { authToken: cfg.tursoToken, migrate: false });
const tables = (
  await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
).map((t) => t.name);
const dump: Record<string, unknown[]> = {};
for (const t of tables) dump[t] = await db.all(`SELECT * FROM ${t}`);
const dir = join(import.meta.dirname, '..', 'backups');
mkdirSync(dir, { recursive: true });
const file = join(dir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(
  file,
  JSON.stringify(dump, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)),
  { mode: 0o600 },
);
const counts = Object.entries(dump).map(([t, r]) => `${t}=${r.length}`);
console.log(`Respaldo: ${file}\n${counts.join(' ')}`);
await db.close();
