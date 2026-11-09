import type { Db } from '../db/connection.js';

export type RevisionEntity = 'actual_set' | 'checkin' | 'session_feedback';
export interface RevisionRow {
  id: number;
  entity: RevisionEntity;
  key: string;
  at: string;
  action: 'create' | 'update';
  before: unknown;
  after: unknown;
  reason: string | null;
}

/** Registra una revisión SOLO si el valor cambia (reenviar lo mismo no ensucia el historial). */
export function logRevision(
  db: Db,
  athleteId: string,
  entity: RevisionEntity,
  key: string,
  before: object | null,
  after: object,
  at: string,
  reason?: string | null,
): void {
  const a = JSON.stringify(after);
  if (before && JSON.stringify(before) === a) return;
  db.prepare(
    'INSERT INTO record_revisions (athlete_id, entity, entity_key, at, action, before_json, after_json, reason) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    athleteId,
    entity,
    key,
    at,
    before ? 'update' : 'create',
    before ? JSON.stringify(before) : null,
    a,
    reason ?? null,
  );
}

export class RevisionsRepo {
  constructor(private db: Db) {}
  list(
    athleteId: string,
    f: { entity?: RevisionEntity; key?: string; limit: number; offset: number },
  ): { total: number; items: RevisionRow[] } {
    const where = ['athlete_id = ?'];
    const args: (string | number)[] = [athleteId];
    if (f.entity) {
      where.push('entity = ?');
      args.push(f.entity);
    }
    if (f.key) {
      where.push('entity_key = ?');
      args.push(f.key);
    }
    const w = where.join(' AND ');
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM record_revisions WHERE ${w}`).get(...args) as { n: number }
    ).n;
    const rows = this.db
      .prepare(`SELECT * FROM record_revisions WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...args, f.limit, f.offset) as {
      id: number;
      entity: RevisionEntity;
      entity_key: string;
      at: string;
      action: 'create' | 'update';
      before_json: string | null;
      after_json: string;
      reason: string | null;
    }[];
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        entity: r.entity,
        key: r.entity_key,
        at: r.at,
        action: r.action,
        before: r.before_json ? JSON.parse(r.before_json) : null,
        after: JSON.parse(r.after_json),
        reason: r.reason,
      })),
    };
  }
}

export class ExerciseMapRepo {
  constructor(private db: Db) {}
  list(
    athleteId: string,
  ): Record<string, { lift?: 'SQ' | 'BP' | 'DL' | null; variantKey?: string; loadKind?: string }> {
    const out: Record<string, { lift?: 'SQ' | 'BP' | 'DL' | null; variantKey?: string; loadKind?: string }> =
      {};
    for (const r of this.db
      .prepare('SELECT * FROM hevy_exercise_map WHERE athlete_id = ?')
      .all(athleteId) as {
      title: string;
      lift: 'SQ' | 'BP' | 'DL' | null;
      variant_key: string | null;
      load_kind: string | null;
    }[])
      out[r.title] = {
        lift: r.lift,
        ...(r.variant_key ? { variantKey: r.variant_key } : {}),
        ...(r.load_kind ? { loadKind: r.load_kind } : {}),
      };
    return out;
  }
  put(
    athleteId: string,
    title: string,
    m: { lift?: 'SQ' | 'BP' | 'DL' | null; variantKey?: string; loadKind?: string },
    at: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO hevy_exercise_map (athlete_id, title, lift, variant_key, load_kind, updated_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT (athlete_id, title) DO UPDATE SET lift=excluded.lift, variant_key=excluded.variant_key, load_kind=excluded.load_kind, updated_at=excluded.updated_at`,
      )
      .run(athleteId, title, m.lift ?? null, m.variantKey ?? null, m.loadKind ?? null, at);
  }
  remove(athleteId: string, title: string): boolean {
    return (
      this.db
        .prepare('DELETE FROM hevy_exercise_map WHERE athlete_id = ? AND title = ?')
        .run(athleteId, title).changes > 0
    );
  }
}
