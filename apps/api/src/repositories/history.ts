import { logRevision } from './revisions.js';
import { randomUUID } from 'node:crypto';
import {
  fingerprint,
  type ChangeEvent,
  type CoachReview,
  type Lift,
  type PlanSnapshot,
  type SessionFeedback,
} from '@coaching/engine';
import type { Db } from '../db/connection.js';
import { upgradePlannedSet } from './legacy.js';

type VRaw = {
  id: string;
  seq: number;
  status: PlanSnapshot['status'];
  detected_on: string;
  effective_on: string | null;
  label: string;
  content: string;
};
const mapV = (r: VRaw): PlanSnapshot => ({
  id: r.id,
  seq: r.seq,
  status: r.status,
  detectedOn: r.detected_on,
  effectiveOn: r.effective_on,
  label: r.label,
  sets: (JSON.parse(r.content) as Record<string, unknown>[]).map(upgradePlannedSet),
});

/** Versiones del plan, eventos de cambio detectados, feedback de sesión, revisiones técnicas y competencias. */
export class HistoryRepo {
  constructor(private db: Db) {}

  async listVersions(athleteId: string): Promise<PlanSnapshot[]> {
    return (
      (await this.db.all(
        'SELECT * FROM plan_versions WHERE athlete_id = ? ORDER BY seq',
        athleteId,
      )) as VRaw[]
    ).map(mapV);
  }
  async latestApplied(athleteId: string): Promise<PlanSnapshot | null> {
    const r = (await this.db.get(
      "SELECT * FROM plan_versions WHERE athlete_id = ? AND status = 'aplicado' ORDER BY seq DESC LIMIT 1",
      athleteId,
    )) as VRaw | undefined;
    return r ? mapV(r) : null;
  }
  async latestDraft(athleteId: string): Promise<PlanSnapshot | null> {
    const r = (await this.db.get(
      "SELECT * FROM plan_versions WHERE athlete_id = ? AND status = 'borrador' ORDER BY seq DESC LIMIT 1",
      athleteId,
    )) as VRaw | undefined;
    return r ? mapV(r) : null;
  }
  async nextSeq(athleteId: string): Promise<number> {
    const r = (await this.db.get(
      'SELECT COALESCE(MAX(seq), 0) AS m FROM plan_versions WHERE athlete_id = ?',
      athleteId,
    )) as { m: number };
    return r.m + 1;
  }
  async addVersion(athleteId: string, v: Omit<PlanSnapshot, 'id' | 'seq'>): Promise<PlanSnapshot> {
    const id = randomUUID().slice(0, 8);
    const seq = await this.nextSeq(athleteId);
    await this.db.run(
      'INSERT INTO plan_versions (id, athlete_id, seq, status, detected_on, effective_on, label, fingerprint, content) VALUES (?,?,?,?,?,?,?,?,?)',
      id,
      athleteId,
      seq,
      v.status,
      v.detectedOn,
      v.effectiveOn,
      v.label,
      fingerprint(v.sets),
      JSON.stringify(v.sets),
    );
    return { ...v, id, seq };
  }
  /** Los borradores se reemplazan: el autoguardado no crea una decisión por cada cambio. */
  async dropDrafts(athleteId: string): Promise<void> {
    await this.db.run("DELETE FROM plan_versions WHERE athlete_id = ? AND status = 'borrador'", athleteId);
  }

  async saveEvent(athleteId: string, e: ChangeEvent): Promise<void> {
    await this.db.run(
      `INSERT INTO change_events (id, athlete_id, version_a, version_b, status, detected_on, effective_on, payload, coach_comment) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT (athlete_id, id) DO NOTHING`,
      e.id,
      athleteId,
      e.versionA,
      e.versionB,
      e.status,
      e.detectedOn,
      e.effectiveOn,
      JSON.stringify(e),
      e.coachComment,
    );
  }
  async listEvents(athleteId: string): Promise<ChangeEvent[]> {
    return (
      (await this.db.all(
        'SELECT payload, coach_comment FROM change_events WHERE athlete_id = ? ORDER BY detected_on, id',
        athleteId,
      )) as { payload: string; coach_comment: string }[]
    ).map((r) => ({ ...(JSON.parse(r.payload) as ChangeEvent), coachComment: r.coach_comment }));
  }
  async setEventComment(athleteId: string, id: string, comment: string): Promise<boolean> {
    return (
      Number(
        (
          await this.db.run(
            'UPDATE change_events SET coach_comment = ? WHERE athlete_id = ? AND id = ?',
            comment,
            athleteId,
            id,
          )
        ).changes,
      ) > 0
    );
  }

  async upsertFeedback(
    athleteId: string,
    f: { sessionKey: string; endFatigue: number | null; note?: string },
  ): Promise<void> {
    const before = (await this.db.get(
      'SELECT end_fatigue, note FROM session_feedback WHERE athlete_id = ? AND session_key = ?',
      athleteId,
      f.sessionKey,
    )) as { end_fatigue: number | null; note: string } | undefined;
    await logRevision(
      this.db,
      athleteId,
      'session_feedback',
      f.sessionKey,
      before ? { endFatigue: before.end_fatigue, note: before.note } : null,
      { endFatigue: f.endFatigue, note: f.note ?? '' },
      new Date().toISOString(),
    );
    await this.db.run(
      `INSERT INTO session_feedback (athlete_id, session_key, end_fatigue, note) VALUES (?,?,?,?)
      ON CONFLICT (athlete_id, session_key) DO UPDATE SET end_fatigue=excluded.end_fatigue, note=excluded.note`,
      athleteId,
      f.sessionKey,
      f.endFatigue,
      f.note ?? '',
    );
  }
  async listFeedback(athleteId: string): Promise<SessionFeedback[]> {
    return (
      (await this.db.all(
        'SELECT session_key, end_fatigue FROM session_feedback WHERE athlete_id = ?',
        athleteId,
      )) as { session_key: string; end_fatigue: number | null }[]
    ).map((r) => ({ sessionKey: r.session_key, endFatigue: r.end_fatigue }));
  }

  /** Cierre de cada entreno que dejó el atleta (fatiga y comentario). */
  async listFinishes(
    athleteId: string,
  ): Promise<{ sessionKey: string; endFatigue: number | null; note: string }[]> {
    return (
      (await this.db.all(
        'SELECT session_key, end_fatigue, note FROM session_feedback WHERE athlete_id = ?',
        athleteId,
      )) as { session_key: string; end_fatigue: number | null; note: string | null }[]
    ).map((r) => ({ sessionKey: r.session_key, endFatigue: r.end_fatigue, note: r.note ?? '' }));
  }

  async upsertReview(athleteId: string, r: CoachReview): Promise<void> {
    await this.db.run(
      `INSERT INTO coach_reviews (athlete_id, lift, date, verdict, note) VALUES (?,?,?,?,?)
      ON CONFLICT (athlete_id, lift, date) DO UPDATE SET verdict=excluded.verdict, note=excluded.note`,
      athleteId,
      r.lift,
      r.date,
      r.verdict,
      r.note,
    );
  }
  async listReviews(athleteId: string): Promise<CoachReview[]> {
    return (await this.db.all(
      'SELECT lift, date, verdict, note FROM coach_reviews WHERE athlete_id = ? ORDER BY date',
      athleteId,
    )) as unknown as CoachReview[];
  }

  async addCompetition(athleteId: string, c: { name: string; date: string; phase: string }): Promise<string> {
    const id = randomUUID();
    await this.db.run(
      'INSERT INTO competitions (id, athlete_id, name, date, phase) VALUES (?,?,?,?,?)',
      id,
      athleteId,
      c.name,
      c.date,
      c.phase,
    );
    return id;
  }
  async listCompetitions(
    athleteId?: string,
  ): Promise<{ id: string; athleteId: string; name: string; date: string; phase: string }[]> {
    const rows = (
      athleteId
        ? await this.db.all('SELECT * FROM competitions WHERE athlete_id = ? ORDER BY date', athleteId)
        : await this.db.all('SELECT * FROM competitions ORDER BY date')
    ) as { id: string; athlete_id: string; name: string; date: string; phase: string }[];
    return rows.map((r) => ({
      id: r.id,
      athleteId: r.athlete_id,
      name: r.name,
      date: r.date,
      phase: r.phase,
    }));
  }
}

export type { Lift };
