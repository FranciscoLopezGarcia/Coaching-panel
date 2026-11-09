import { randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../db/connection.js';
import { TOKEN_DAYS, checkPassword, hashPassword, sha } from './accounts.js';

/** Cuentas del coach (email + contraseña con hash) y sus sesiones de acceso (se guarda solo el hash del token). */
export class CoachesRepo {
  constructor(private db: Db) {}
  async count(): Promise<number> {
    return Number((await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM coaches'))?.n ?? 0);
  }
  /** Crea el coach si no existe (no pisa la contraseña de uno existente). */
  async ensure(email: string, password: string, now: string): Promise<boolean> {
    const e = await this.db.get('SELECT id FROM coaches WHERE email = ?', email);
    if (e) return false;
    await this.db.run(
      'INSERT INTO coaches (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)',
      randomUUID(),
      email,
      hashPassword(password),
      now,
      now,
    );
    return true;
  }
  async setPassword(email: string, password: string, now: string): Promise<boolean> {
    const r = await this.db.run(
      'UPDATE coaches SET password_hash = ?, updated_at = ? WHERE email = ?',
      hashPassword(password),
      now,
      email,
    );
    return r.changes > 0;
  }
  async verify(email: string, password: string): Promise<string | null> {
    const r = await this.db.get<{ id: string; password_hash: string }>(
      'SELECT id, password_hash FROM coaches WHERE email = ?',
      email,
    );
    return r && checkPassword(password, r.password_hash) ? r.id : null;
  }
  async createToken(coachId: string, now: Date): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.run(
      'INSERT INTO coach_tokens (token_hash, coach_id, created_at, expires_at) VALUES (?,?,?,?)',
      sha(token),
      coachId,
      now.toISOString(),
      new Date(now.getTime() + TOKEN_DAYS * 86400000).toISOString(),
    );
    return token;
  }
  /** Email del coach dueño del token, o null si no existe o venció. */
  async emailOfToken(token: string, now: Date): Promise<string | null> {
    const r = await this.db.get<{ email: string; expires_at: string }>(
      'SELECT c.email AS email, t.expires_at AS expires_at FROM coach_tokens t JOIN coaches c ON c.id = t.coach_id WHERE t.token_hash = ?',
      sha(token),
    );
    if (!r) return null;
    if (r.expires_at < now.toISOString()) {
      await this.db.run('DELETE FROM coach_tokens WHERE token_hash = ?', sha(token));
      return null;
    }
    return r.email;
  }
  async revoke(token: string): Promise<void> {
    await this.db.run('DELETE FROM coach_tokens WHERE token_hash = ?', sha(token));
  }
}
