import type { BlockFeedbackAnswers, BlockFeedbackRow } from '@coaching/contracts';
import type { Db } from '../db/connection.js';

/** Cierre de bloque del atleta: uno por bloque; volver a enviarlo lo corrige. */
export class BlockFeedbackRepo {
  constructor(private db: Db) {}
  async list(athleteId: string): Promise<BlockFeedbackRow[]> {
    const rows = (await this.db.all(
      'SELECT block_key, payload, created_at, updated_at FROM block_feedback WHERE athlete_id = ? ORDER BY updated_at DESC',
      athleteId,
    )) as { block_key: string; payload: string; created_at: string; updated_at: string }[];
    return rows.map((r) => ({
      blockKey: r.block_key,
      answers: JSON.parse(r.payload) as BlockFeedbackAnswers,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }
  async upsert(
    athleteId: string,
    blockKey: string,
    answers: BlockFeedbackAnswers,
    now: string,
  ): Promise<void> {
    await this.db.run(
      `INSERT INTO block_feedback (athlete_id, block_key, payload, created_at, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT (athlete_id, block_key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`,
      athleteId,
      blockKey,
      JSON.stringify(answers),
      now,
      now,
    );
  }
}
