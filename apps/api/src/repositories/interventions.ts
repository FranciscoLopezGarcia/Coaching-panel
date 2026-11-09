import type { Intervention } from '@coaching/engine';
import type { Db } from '../db/connection.js';

export class InterventionsRepo {
  constructor(private db: Db) {}
  async save(athleteId: string, i: Intervention, nowIso: string): Promise<void> {
    await this.db.run(
      `INSERT INTO interventions (id, athlete_id, proposal_key, lift, state, payload, updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (id) DO UPDATE SET state=excluded.state, payload=excluded.payload, updated_at=excluded.updated_at`,
      i.id,
      athleteId,
      i.proposalKey,
      i.lift,
      i.state,
      JSON.stringify(i),
      nowIso,
    );
  }
  async get(athleteId: string, id: string): Promise<Intervention | null> {
    const r = (await this.db.get(
      'SELECT payload FROM interventions WHERE athlete_id = ? AND id = ?',
      athleteId,
      id,
    )) as { payload: string } | undefined;
    return r ? (JSON.parse(r.payload) as Intervention) : null;
  }
  async byProposal(athleteId: string, key: string): Promise<Intervention | null> {
    const r = (await this.db.get(
      'SELECT payload FROM interventions WHERE athlete_id = ? AND proposal_key = ?',
      athleteId,
      key,
    )) as { payload: string } | undefined;
    return r ? (JSON.parse(r.payload) as Intervention) : null;
  }
  async list(athleteId: string): Promise<Intervention[]> {
    return (
      (await this.db.all(
        'SELECT payload FROM interventions WHERE athlete_id = ? ORDER BY updated_at DESC, id',
        athleteId,
      )) as { payload: string }[]
    ).map((r) => JSON.parse(r.payload) as Intervention);
  }
}
