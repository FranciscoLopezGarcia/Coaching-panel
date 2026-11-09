import { randomUUID } from 'node:crypto';
import type { ObservedSet } from '@coaching/engine';
import type { Db } from '../db/connection.js';
import { transaction } from '../db/connection.js';

type ORaw = {
  id: string;
  source: string;
  session_key: string;
  date: string;
  exercise_name: string;
  exercise_id: string;
  lift: ObservedSet['lift'];
  variant_key: string;
  set_type: ObservedSet['setType'];
  kg: number | null;
  reps: number | null;
  rpe: number | null;
  load_kind: ObservedSet['loadKind'];
  external_key: string;
};

/** El índice de serie de Hevy viaja en la clave externa (`inicio|ejercicio|set_index|tipo|kg|reps|rpe`): se lee desde el final para tolerar `|` en el título. */
function setNoOf(source: string, key: string): number | null {
  if (source !== 'hevy') return null;
  const parts = key.split('|');
  const v = Number(parts[parts.length - 5]);
  return Number.isInteger(v) && v >= 0 ? v + 1 : null;
}

export interface BatchInfo {
  id: string;
  source: string;
  kind: 'observaciones' | 'plan';
  parserVersion: string;
  timeZone: string;
  token: string;
  summary: unknown;
  createdAt: string;
}

/** Lo ejecutado SIN prescripción vinculada (p. ej. Hevy). La reimportación es idempotente por (atleta, fuente, clave externa). */
export class ObservedRepo {
  constructor(private db: Db) {}

  existingKeys(athleteId: string, source: string): Set<string> {
    return new Set(
      (
        this.db
          .prepare('SELECT external_key FROM observed_sets WHERE athlete_id = ? AND source = ?')
          .all(athleteId, source) as { external_key: string }[]
      ).map((r) => r.external_key),
    );
  }

  /** Inserta en una transacción; las filas ya existentes se ignoran (no se duplican ni se pisan). */
  insertBatch(
    athleteId: string,
    batch: Omit<BatchInfo, 'id' | 'createdAt'>,
    rows: (ObservedSet & { externalKey: string })[],
    nowIso: string,
  ): { batchId: string; inserted: number; ignored: number } {
    const batchId = randomUUID();
    return transaction(this.db, () => {
      this.db
        .prepare(
          'INSERT INTO import_batches (id, athlete_id, source, kind, parser_version, time_zone, token, summary, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          batchId,
          athleteId,
          batch.source,
          batch.kind,
          batch.parserVersion,
          batch.timeZone,
          batch.token,
          JSON.stringify(batch.summary),
          nowIso,
        );
      const st = this.db
        .prepare(`INSERT OR IGNORE INTO observed_sets (athlete_id, id, source, batch_id, external_key, session_key, date, exercise_name, exercise_id, lift, variant_key, set_type, kg, reps, rpe, load_kind)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      let inserted = 0;
      for (const r of rows)
        inserted += Number(
          st.run(
            athleteId,
            r.id,
            r.source,
            batchId,
            r.externalKey,
            r.sessionKey,
            r.date,
            r.exerciseName,
            r.exerciseId,
            r.lift,
            r.variantKey,
            r.setType,
            r.kg,
            r.reps,
            r.rpe,
            r.loadKind,
          ).changes,
        );
      return { batchId, inserted, ignored: rows.length - inserted };
    });
  }

  list(athleteId: string, o: { source?: string; to?: string } = {}): ObservedSet[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM observed_sets WHERE athlete_id = ? AND (? IS NULL OR source = ?) AND (? IS NULL OR date <= ?) ORDER BY date, session_key, id',
      )
      .all(athleteId, o.source ?? null, o.source ?? null, o.to ?? null, o.to ?? null) as ORaw[];
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      sessionKey: r.session_key,
      date: r.date,
      exerciseName: r.exercise_name,
      exerciseId: r.exercise_id,
      lift: r.lift,
      variantKey: r.variant_key,
      setType: r.set_type,
      kg: r.kg,
      reps: r.reps,
      rpe: r.rpe,
      loadKind: r.load_kind,
      plannedSetId: null,
      setNo: setNoOf(r.source, r.external_key),
      refKg: null,
      refSource: null,
      refAsOf: null,
    }));
  }

  batches(athleteId: string): BatchInfo[] {
    return (
      this.db
        .prepare('SELECT * FROM import_batches WHERE athlete_id = ? ORDER BY created_at DESC')
        .all(athleteId) as {
        id: string;
        source: string;
        kind: BatchInfo['kind'];
        parser_version: string;
        time_zone: string;
        token: string;
        summary: string;
        created_at: string;
      }[]
    ).map((b) => ({
      id: b.id,
      source: b.source,
      kind: b.kind,
      parserVersion: b.parser_version,
      timeZone: b.time_zone,
      token: b.token,
      summary: JSON.parse(b.summary) as unknown,
      createdAt: b.created_at,
    }));
  }
}
