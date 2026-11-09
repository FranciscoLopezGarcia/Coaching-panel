import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/connection.js';

/** Qué ve el atleta de cada serie: carga (kg planificados o estimados), RPE objetivo y/o % del RM. */
export const VIEW_MODES = ['completo', 'solo_rpe', 'solo_carga', 'rpe_porcentaje'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
const TOKEN_DAYS = 30;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
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

/** Cuentas de atleta (email + contraseña con hash scrypt), sesiones de acceso (token aleatorio, se guarda solo su hash) y ajustes de vista. */
export class AccountsRepo {
  constructor(private db: Db) {}
  setAccount(athleteId: string, email: string, password: string, now: string): void {
    const taken = this.db
      .prepare('SELECT athlete_id FROM athlete_accounts WHERE email = ? AND athlete_id <> ?')
      .get(email, athleteId);
    if (taken) throw new Error('Ese email ya está asignado a otro atleta.');
    this.db
      .prepare(
        `INSERT INTO athlete_accounts (athlete_id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT (athlete_id) DO UPDATE SET email=excluded.email, password_hash=excluded.password_hash, updated_at=excluded.updated_at`,
      )
      .run(athleteId, email, hashPassword(password), now, now);
    // cambiar la contraseña cierra las sesiones abiertas
    this.db.prepare('DELETE FROM athlete_tokens WHERE athlete_id = ?').run(athleteId);
  }
  getAccount(athleteId: string): { email: string; updatedAt: string } | null {
    const r = this.db
      .prepare('SELECT email, updated_at FROM athlete_accounts WHERE athlete_id = ?')
      .get(athleteId) as { email: string; updated_at: string } | undefined;
    return r ? { email: r.email, updatedAt: r.updated_at } : null;
  }
  deleteAccount(athleteId: string): boolean {
    this.db.prepare('DELETE FROM athlete_tokens WHERE athlete_id = ?').run(athleteId);
    return (
      Number(this.db.prepare('DELETE FROM athlete_accounts WHERE athlete_id = ?').run(athleteId).changes) > 0
    );
  }
  /** Devuelve el id del atleta si email y contraseña coinciden. */
  verify(email: string, password: string): string | null {
    const r = this.db
      .prepare('SELECT athlete_id, password_hash FROM athlete_accounts WHERE email = ?')
      .get(email) as { athlete_id: string; password_hash: string } | undefined;
    // se calcula el hash aunque no exista la cuenta, para no revelar por tiempo cuáles emails existen
    const ok = checkPassword(password, r?.password_hash ?? 's1:00:00');
    return r && ok ? r.athlete_id : null;
  }
  createToken(athleteId: string, now: Date): string {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO athlete_tokens (token_hash, athlete_id, created_at, expires_at) VALUES (?,?,?,?)')
      .run(
        sha(token),
        athleteId,
        now.toISOString(),
        new Date(now.getTime() + TOKEN_DAYS * 86400000).toISOString(),
      );
    return token;
  }
  athleteOfToken(token: string, now: Date): string | null {
    const r = this.db
      .prepare('SELECT athlete_id, expires_at FROM athlete_tokens WHERE token_hash = ?')
      .get(sha(token)) as { athlete_id: string; expires_at: string } | undefined;
    if (!r) return null;
    if (r.expires_at < now.toISOString()) {
      this.db.prepare('DELETE FROM athlete_tokens WHERE token_hash = ?').run(sha(token));
      return null;
    }
    return r.athlete_id;
  }
  revoke(token: string): void {
    this.db.prepare('DELETE FROM athlete_tokens WHERE token_hash = ?').run(sha(token));
  }
  setViewMode(athleteId: string, sessionKey: string, mode: ViewMode): void {
    this.db
      .prepare(
        `INSERT INTO athlete_view_settings (athlete_id, session_key, mode) VALUES (?,?,?)
         ON CONFLICT (athlete_id, session_key) DO UPDATE SET mode=excluded.mode`,
      )
      .run(athleteId, sessionKey, mode);
  }
  clearViewMode(athleteId: string, sessionKey: string): void {
    this.db
      .prepare('DELETE FROM athlete_view_settings WHERE athlete_id = ? AND session_key = ?')
      .run(athleteId, sessionKey);
  }
  viewSettings(athleteId: string): Record<string, ViewMode> {
    return Object.fromEntries(
      (
        this.db
          .prepare('SELECT session_key, mode FROM athlete_view_settings WHERE athlete_id = ?')
          .all(athleteId) as {
          session_key: string;
          mode: ViewMode;
        }[]
      ).map((r) => [r.session_key, r.mode]),
    );
  }
  /** Nota del atleta en un ejercicio de un entreno. Vacía = se borra. */
  setNote(athleteId: string, sessionKey: string, exercise: string, note: string, now: string): void {
    const n = note.trim();
    if (!n) {
      this.db
        .prepare(
          'DELETE FROM athlete_exercise_notes WHERE athlete_id = ? AND session_key = ? AND exercise_name = ?',
        )
        .run(athleteId, sessionKey, exercise);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO athlete_exercise_notes (athlete_id, session_key, exercise_name, note, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT (athlete_id, session_key, exercise_name) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at`,
      )
      .run(athleteId, sessionKey, exercise, n, now);
  }
  notes(athleteId: string, sessionKey?: string) {
    const rows = this.db
      .prepare(
        `SELECT session_key AS sessionKey, exercise_name AS exerciseName, note, updated_at AS updatedAt
         FROM athlete_exercise_notes WHERE athlete_id = ? ${sessionKey ? 'AND session_key = ?' : ''} ORDER BY updated_at DESC`,
      )
      .all(...(sessionKey ? [athleteId, sessionKey] : [athleteId])) as {
      sessionKey: string;
      exerciseName: string;
      note: string;
      updatedAt: string;
    }[];
    return rows;
  }
  /** Modo efectivo de una sesión: su ajuste, si no el del atleta ('*'), si no «completo». */
  modeFor(athleteId: string, sessionKey: string, lift?: string | null): ViewMode {
    const s = this.viewSettings(athleteId);
    return s[sessionKey] ?? (lift ? s[`*lift:${lift}`] : undefined) ?? s['*'] ?? 'completo';
  }
}
