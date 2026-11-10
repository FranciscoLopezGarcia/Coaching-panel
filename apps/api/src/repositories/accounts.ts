import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/connection.js';

/** Qué ve el atleta de cada serie: carga (kg planificados o estimados), RPE objetivo y/o % del RM. */
export const VIEW_MODES = ['completo', 'solo_rpe', 'solo_carga', 'rpe_porcentaje'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
export const TOKEN_DAYS = 30;

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  return `s1:${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
}
export function checkPassword(pw: string, stored: string): boolean {
  const [v, salt, h] = stored.split(':');
  if (v !== 's1' || !salt || !h) return false;
  const a = Buffer.from(h, 'hex');
  const b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Modo efectivo a partir de los ajustes ya leídos: sesión, si no el del movimiento, si no el del atleta ('*'), si no «completo». */
export function modeFrom(s: Record<string, ViewMode>, sessionKey: string, lift?: string | null): ViewMode {
  return s[sessionKey] ?? (lift ? s[`*lift:${lift}`] : undefined) ?? s['*'] ?? 'completo';
}

/** Cuentas de atleta (email + contraseña con hash scrypt), sesiones de acceso (token aleatorio, se guarda solo su hash) y ajustes de vista. */
export class AccountsRepo {
  constructor(private db: Db) {}
  async setAccount(athleteId: string, email: string, password: string, now: string): Promise<void> {
    const taken = await this.db.get(
      'SELECT athlete_id FROM athlete_accounts WHERE email = ? AND athlete_id <> ?',
      email,
      athleteId,
    );
    if (taken) throw new Error('Ese email ya está asignado a otro atleta.');
    await this.db.run(
      `INSERT INTO athlete_accounts (athlete_id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT (athlete_id) DO UPDATE SET email=excluded.email, password_hash=excluded.password_hash, updated_at=excluded.updated_at`,
      athleteId,
      email,
      hashPassword(password),
      now,
      now,
    );
    // cambiar la contraseña cierra las sesiones abiertas
    await this.db.run('DELETE FROM athlete_tokens WHERE athlete_id = ?', athleteId);
  }
  async getAccount(athleteId: string): Promise<{ email: string; updatedAt: string } | null> {
    const r = (await this.db.get(
      'SELECT email, updated_at FROM athlete_accounts WHERE athlete_id = ?',
      athleteId,
    )) as { email: string; updated_at: string } | undefined;
    return r ? { email: r.email, updatedAt: r.updated_at } : null;
  }
  async deleteAccount(athleteId: string): Promise<boolean> {
    await this.db.run('DELETE FROM athlete_tokens WHERE athlete_id = ?', athleteId);
    return (
      Number((await this.db.run('DELETE FROM athlete_accounts WHERE athlete_id = ?', athleteId)).changes) > 0
    );
  }
  /** Devuelve el id del atleta si email y contraseña coinciden. */
  async verify(email: string, password: string): Promise<string | null> {
    const r = (await this.db.get(
      'SELECT athlete_id, password_hash FROM athlete_accounts WHERE email = ?',
      email,
    )) as { athlete_id: string; password_hash: string } | undefined;
    // se calcula el hash aunque no exista la cuenta, para no revelar por tiempo cuáles emails existen
    const ok = checkPassword(password, r?.password_hash ?? 's1:00:00');
    return r && ok ? r.athlete_id : null;
  }
  async createToken(athleteId: string, now: Date): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.run(
      'INSERT INTO athlete_tokens (token_hash, athlete_id, created_at, expires_at) VALUES (?,?,?,?)',
      sha(token),
      athleteId,
      now.toISOString(),
      new Date(now.getTime() + TOKEN_DAYS * 86400000).toISOString(),
    );
    return token;
  }
  async athleteOfToken(token: string, now: Date): Promise<string | null> {
    const r = (await this.db.get(
      'SELECT athlete_id, expires_at FROM athlete_tokens WHERE token_hash = ?',
      sha(token),
    )) as { athlete_id: string; expires_at: string } | undefined;
    if (!r) return null;
    if (r.expires_at < now.toISOString()) {
      await this.db.run('DELETE FROM athlete_tokens WHERE token_hash = ?', sha(token));
      return null;
    }
    return r.athlete_id;
  }
  /** Revisión en vivo de quien es dueño del token, en UNA sola consulta (el sondeo del atleta la usa cada pocos segundos). */
  async revOfToken(token: string, now: Date): Promise<number | null> {
    const r = await this.db.get<{ rev: number | null }>(
      `SELECT r.rev AS rev FROM athlete_tokens t LEFT JOIN athlete_rev r ON r.athlete_id = t.athlete_id
       WHERE t.token_hash = ? AND t.expires_at >= ?`,
      sha(token),
      now.toISOString(),
    );
    return r ? Number(r.rev ?? 0) : null;
  }
  async revoke(token: string): Promise<void> {
    await this.db.run('DELETE FROM athlete_tokens WHERE token_hash = ?', sha(token));
  }
  async setViewMode(athleteId: string, sessionKey: string, mode: ViewMode): Promise<void> {
    await this.db.run(
      `INSERT INTO athlete_view_settings (athlete_id, session_key, mode) VALUES (?,?,?)
         ON CONFLICT (athlete_id, session_key) DO UPDATE SET mode=excluded.mode`,
      athleteId,
      sessionKey,
      mode,
    );
  }
  async clearViewMode(athleteId: string, sessionKey: string): Promise<void> {
    await this.db.run(
      'DELETE FROM athlete_view_settings WHERE athlete_id = ? AND session_key = ?',
      athleteId,
      sessionKey,
    );
  }
  async viewSettings(athleteId: string): Promise<Record<string, ViewMode>> {
    return Object.fromEntries(
      (
        (await this.db.all(
          'SELECT session_key, mode FROM athlete_view_settings WHERE athlete_id = ?',
          athleteId,
        )) as {
          session_key: string;
          mode: ViewMode;
        }[]
      ).map((r) => [r.session_key, r.mode]),
    );
  }
  /** Nota del atleta en un ejercicio de un entreno. Vacía = se borra. */
  async setNote(
    athleteId: string,
    sessionKey: string,
    exercise: string,
    note: string,
    now: string,
  ): Promise<void> {
    const n = note.trim();
    if (!n) {
      await this.db.run(
        'DELETE FROM athlete_exercise_notes WHERE athlete_id = ? AND session_key = ? AND exercise_name = ?',
        athleteId,
        sessionKey,
        exercise,
      );
      return;
    }
    await this.db.run(
      `INSERT INTO athlete_exercise_notes (athlete_id, session_key, exercise_name, note, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT (athlete_id, session_key, exercise_name) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at`,
      athleteId,
      sessionKey,
      exercise,
      n,
      now,
    );
  }
  async notes(athleteId: string, sessionKey?: string) {
    const rows = (await this.db.all(
      `SELECT session_key AS sessionKey, exercise_name AS exerciseName, note, updated_at AS updatedAt
         FROM athlete_exercise_notes WHERE athlete_id = ? ${sessionKey ? 'AND session_key = ?' : ''} ORDER BY updated_at DESC`,
      ...(sessionKey ? [athleteId, sessionKey] : [athleteId]),
    )) as {
      sessionKey: string;
      exerciseName: string;
      note: string;
      updatedAt: string;
    }[];
    return rows;
  }
  /** Modo efectivo de una sesión: su ajuste, si no el del atleta ('*'), si no «completo». */
  async modeFor(athleteId: string, sessionKey: string, lift?: string | null): Promise<ViewMode> {
    return modeFrom(await this.viewSettings(athleteId), sessionKey, lift);
  }
}
