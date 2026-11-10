/**
 * Crea o cambia el acceso de un atleta al portal directamente en la base (útil para el alta inicial).
 *   ATHLETE_NAME="Lueto" ACCOUNT_EMAIL=a@b.com ACCOUNT_PASSWORD=... npm run db:account -w @coaching/api
 */
import { openDb } from '../src/db/connection.js';
import { AccountsRepo } from '../src/repositories/accounts.js';

const url = process.env.TURSO_DATABASE_URL ?? process.env.DB_PATH;
const { ATHLETE_NAME: name, ACCOUNT_EMAIL: email, ACCOUNT_PASSWORD: password } = process.env;
if (!url || !name || !email || !password) {
  console.error('Faltan TURSO_DATABASE_URL (o DB_PATH), ATHLETE_NAME, ACCOUNT_EMAIL y ACCOUNT_PASSWORD.');
  process.exit(2);
}
if (password.length < 6) {
  console.error('La contraseña debe tener al menos 6 caracteres.');
  process.exit(2);
}
const db = await openDb(url, { authToken: process.env.TURSO_AUTH_TOKEN });
const rows = await db.all<{ id: string; name: string }>('SELECT id, name FROM athletes WHERE name = ?', name);
if (rows.length !== 1) {
  console.error(`Se esperaba 1 atleta llamado «${name}» y hay ${rows.length}.`);
  process.exit(3);
}
await new AccountsRepo(db).setAccount(
  rows[0]!.id,
  email.trim().toLowerCase(),
  password,
  new Date().toISOString(),
);
console.log(`Acceso listo: ${rows[0]!.name} → ${email.trim().toLowerCase()}`);
await db.close();
