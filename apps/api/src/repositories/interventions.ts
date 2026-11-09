import type { Intervention } from '@coaching/engine';
import type { Db } from '../db/connection.js';

export class InterventionsRepo {
  constructor(private db: Db) {}
  save(athleteId: string, i: Intervention, nowIso: string): void {
    this.db
      .prepare(
        `INSERT INTO interventions (id, athlete_id, proposal_key, lift, state, payload, updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (id) DO UPDATE SET state=excluded.state, payload=excluded.payload, updated_at=excluded.updated_at`,
      )
      .run(i.id, athleteId, i.proposalKey, i.lift, i.state, JSON.stringify(i), nowIso);
  }
  get(athleteId: string, id: string): Intervention | null {
    const r = this.db
      .prepare('SELECT payload FROM interventions WHERE athlete_id = ? AND id = ?')
      .get(athleteId, id) as { payload: string } | undefined;
    return r ? (JSON.parse(r.payload) as Intervention) : null;
  }
  byProposal(athleteId: string, key: string): Intervention | null {
    const r = this.db
      .prepare('SELECT payload FROM interventions WHERE athlete_id = ? AND proposal_key = ?')
      .get(athleteId, key) as { payload: string } | undefined;
    return r ? (JSON.parse(r.payload) as Intervention) : null;
  }
  list(athleteId: string): Intervention[] {
    return (
      this.db
        .prepare('SELECT payload FROM interventions WHERE athlete_id = ? ORDER BY updated_at DESC, id')
        .all(athleteId) as { payload: string }[]
    ).map((r) => JSON.parse(r.payload) as Intervention);
  }
}
