/**
 * Copia una base SQLite local a otra base (Turso). Aplica las migraciones en el destino y carga las filas respetando las claves foráneas.
 *   SOURCE_DB=./data/base.sqlite TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:copy -w @coaching/api
 * Es repetible: con --replace vacía antes las tablas de datos del destino; sin eso, falla si ya hay datos.
 * No copia sesiones de acceso (tokens) ni cuentas de coach: esas se crean en el destino.
 */
import { openDb } from '../src/db/connection.js';

const src = process.env.SOURCE_DB;
const dst = process.env.TURSO_DATABASE_URL;
if (!src || !dst) {
  console.error('Indicá SOURCE_DB (archivo .sqlite) y TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN).');
  process.exit(2);
}
const replace = process.argv.includes('--replace');
const SKIP = new Set(['schema_migrations', 'athlete_tokens', 'coaches', 'coach_tokens', 'athlete_rev']);

const from = await openDb(src, { migrate: false });
const to = await openDb(dst, { authToken: process.env.TURSO_AUTH_TOKEN });

const tables = (
  await from.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
)
  .map((t) => t.name)
  .filter((t) => !SKIP.has(t));
// orden: primero las tablas de las que otras dependen
const deps = new Map<string, Set<string>>();
for (const t of tables)
  deps.set(
    t,
    new Set(
      (await from.all<{ table: string }>(`PRAGMA foreign_key_list(${t})`))
        .map((r) => r.table)
        .filter((x) => x !== t && tables.includes(x)),
    ),
  );
const order: string[] = [];
while (order.length < tables.length) {
  const next = tables.filter(
    (t) => !order.includes(t) && [...(deps.get(t) ?? [])].every((d) => order.includes(d)),
  );
  if (!next.length) throw new Error('Dependencias circulares entre tablas');
  order.push(...next);
}

if (replace) {
  for (const t of [...order].reverse()) await to.run(`DELETE FROM ${t}`);
  console.log('Destino vaciado.');
} else {
  for (const t of order) {
    const n = Number((await to.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))?.n ?? 0);
    if (n > 0) {
      console.error(`El destino ya tiene datos (${t}: ${n} filas). Usá --replace para reemplazarlos.`);
      process.exit(3);
    }
  }
}

let total = 0;
for (const t of order) {
  const cols = (await from.all<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name);
  const rows = await from.all<Record<string, never>>(`SELECT * FROM ${t}`);
  const sql = `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  for (let i = 0; i < rows.length; i += 400)
    await to.runMany(
      sql,
      rows.slice(i, i + 400).map((r) => cols.map((c) => r[c] ?? null)),
    );
  // verificación por tabla
  const n = Number((await to.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))?.n ?? 0);
  if (n !== rows.length) throw new Error(`${t}: origen ${rows.length} filas, destino ${n}`);
  total += rows.length;
  console.log(`${t.padEnd(28)} ${String(rows.length).padStart(7)} filas ✓`);
}
console.log(`Listo: ${order.length} tablas, ${total} filas copiadas y verificadas.`);
await from.close();
await to.close();
