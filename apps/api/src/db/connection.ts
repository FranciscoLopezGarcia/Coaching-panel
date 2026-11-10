import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Client, Transaction } from '@libsql/client';
import { runMigrations } from './migrate.js';

/**
 * Acceso a datos ASÍNCRONO con dos motores intercambiables:
 *  · SQLite local (node:sqlite): desarrollo y tests.
 *  · Turso/libSQL (remoto o archivo): producción en Vercel.
 * Una transacción vale para TODO lo que se ejecute dentro de `transaction(fn)`, aunque pase por otros repositorios
 * (se propaga con AsyncLocalStorage), igual que cuando el acceso era síncrono.
 */
export type Param = string | number | bigint | null | Uint8Array;
export interface Db {
  all<T = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<T | undefined>;
  run(sql: string, ...params: Param[]): Promise<{ changes: number }>;
  /** Una misma sentencia con muchas filas de parámetros (en una sola ida al motor). Devuelve las filas afectadas. */
  runMany(sql: string, rows: Param[][]): Promise<number>;
  /** Script con varias sentencias (migraciones). */
  exec(script: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** Cantidad de consultas enviadas al motor desde que arrancó (para medir cuántas hace cada pedido). */
  queries: number;
}

type DatabaseSyncCtor = typeof import('node:sqlite').DatabaseSync;
// `node:sqlite` se carga con require y solo cuando se usa: vite-node (tests) no reconoce ese builtin y Vercel no lo necesita.
const loadSqlite = (): DatabaseSyncCtor =>
  (createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')).DatabaseSync;

class SqliteDb implements Db {
  queries = 0;
  private readonly in = new AsyncLocalStorage<true>();
  private active: Promise<void> | null = null;
  constructor(private readonly db: InstanceType<DatabaseSyncCtor>) {}
  /** Fuera de una transacción propia, espera a que termine la que esté abierta (una sola conexión). */
  private async gate() {
    if (this.in.getStore()) return;
    while (this.active) await this.active;
  }
  async all<T>(sql: string, ...p: Param[]): Promise<T[]> {
    await this.gate();
    this.queries++;
    return this.db.prepare(sql).all(...p) as T[];
  }
  async get<T>(sql: string, ...p: Param[]): Promise<T | undefined> {
    await this.gate();
    this.queries++;
    return this.db.prepare(sql).get(...p) as T | undefined;
  }
  async run(sql: string, ...p: Param[]) {
    await this.gate();
    this.queries++;
    return { changes: Number(this.db.prepare(sql).run(...p).changes) };
  }
  async runMany(sql: string, rows: Param[][]) {
    await this.gate();
    const st = this.db.prepare(sql);
    let n = 0;
    for (const r of rows) n += Number(st.run(...r).changes);
    return n;
  }
  async exec(script: string) {
    await this.gate();
    this.db.exec(script);
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.in.getStore()) return fn(); // anidada: se une a la transacción abierta
    while (this.active) await this.active;
    let release!: () => void;
    this.active = new Promise<void>((r) => (release = r));
    try {
      this.db.exec('BEGIN');
      try {
        const r = await this.in.run(true, fn);
        this.db.exec('COMMIT');
        return r;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    } finally {
      this.active = null;
      release();
    }
  }
  async close() {
    this.db.close();
  }
}

type Row = Record<string, unknown>;
const plain = (columns: string[], rows: ArrayLike<unknown>[]): Row[] =>
  rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));

class LibsqlDb implements Db {
  queries = 0;
  private readonly tx = new AsyncLocalStorage<Transaction>();
  constructor(private readonly client: Client) {}
  private exe() {
    return this.tx.getStore() ?? this.client;
  }
  private async query(sql: string, p: Param[]) {
    this.queries++;
    const r = await this.exe().execute({ sql, args: p as never });
    return { rows: plain(r.columns, r.rows as ArrayLike<unknown>[]), changes: r.rowsAffected };
  }
  async all<T>(sql: string, ...p: Param[]) {
    return (await this.query(sql, p)).rows as T[];
  }
  async get<T>(sql: string, ...p: Param[]) {
    return (await this.query(sql, p)).rows[0] as T | undefined;
  }
  async run(sql: string, ...p: Param[]) {
    return { changes: (await this.query(sql, p)).changes };
  }
  async runMany(sql: string, rows: Param[][]) {
    if (!rows.length) return 0;
    const stmts = rows.map((args) => ({ sql, args: args as never }));
    const t = this.tx.getStore();
    const rs = t ? await t.batch(stmts) : await this.client.batch(stmts, 'write');
    return rs.reduce((a, r) => a + r.rowsAffected, 0);
  }
  async exec(script: string) {
    const t = this.tx.getStore();
    if (t) throw new Error('exec de varios comandos no se usa dentro de una transacción');
    await this.client.executeMultiple(script);
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.tx.getStore()) return fn();
    const t = await this.client.transaction('write');
    try {
      const r = await this.tx.run(t, fn);
      await t.commit();
      return r;
    } catch (e) {
      await t.rollback().catch(() => undefined);
      throw e;
    } finally {
      t.close();
    }
  }
  async close() {
    this.client.close();
  }
}

export interface OpenOptions {
  /** 'sqlite' (node:sqlite, por defecto) o 'libsql' (Turso o archivo libSQL). */
  driver?: 'sqlite' | 'libsql';
  authToken?: string;
  /** false = no aplica migraciones (tests de compatibilidad con esquemas viejos). */
  migrate?: boolean;
}

/** Abre la base y aplica las migraciones pendientes. `path`: archivo/":memory:" (sqlite) o URL libsql:// / file: (libsql). */
export async function openDb(path: string, opts: OpenOptions = {}): Promise<Db> {
  // Para probar todo contra libSQL sin red: DB_DRIVER=libsql convierte ":memory:" en un archivo temporal.
  if (process.env.DB_DRIVER === 'libsql' && path === ':memory:')
    path = `file:${join(tmpdir(), `coaching-${randomUUID()}.db`)}`;
  const driver = opts.driver ?? (/^(libsql|https?|wss?):/.test(path) ? 'libsql' : 'sqlite');
  let db: Db;
  if (driver === 'libsql') {
    // remoto (Turso): build «web» por HTTP, sin dependencias nativas (corre en Vercel). Archivo local: build nativo.
    const remote = !path.startsWith('file:');
    // el build nativo se importa con un nombre en variable: así el empaquetado de Vercel no lo arrastra (no lo necesita)
    const nativeName = '@libsql/client';
    const { createClient } = remote
      ? await import('@libsql/client/web')
      : ((await import(/* @vite-ignore */ nativeName)) as typeof import('@libsql/client'));
    db = new LibsqlDb(createClient({ url: path, authToken: opts.authToken }));
    if (path.startsWith('file:')) await db.exec('PRAGMA foreign_keys = ON;');
  } else {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const raw = new (loadSqlite())(path);
    raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    db = new SqliteDb(raw);
  }
  if (opts.migrate !== false) await runMigrations(db);
  return db;
}
