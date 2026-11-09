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

  listVersions(athleteId: string): PlanSnapshot[] {
    return (
      this.db
        .prepare('SELECT * FROM plan_versions WHERE athlete_id = ? ORDER BY seq')
        .all(athleteId) as VRaw[]
    ).map(mapV);
  }
  latestApplied(athleteId: string): PlanSnapshot | null {
    const r = this.db
      .prepare(
        "SELECT * FROM plan_versions WHERE athlete_id = ? AND status = 'aplicado' ORDER BY seq DESC LIMIT 1",
      )
      .get(athleteId) as VRaw | undefined;
    return r ? mapV(r) : null;
  }
  latestDraft(athleteId: string): PlanSnapshot | null {
    const r = this.db
      .prepare(
        "SELECT * FROM plan_versions WHERE athlete_id = ? AND status = 'borrador' ORDER BY seq DESC LIMIT 1",
      )
      .get(athleteId) as VRaw | undefined;
    return r ? mapV(r) : null;
  }
  nextSeq(athleteId: string): number {
    const r = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM plan_versions WHERE athlete_id = ?')
      .get(athleteId) as { m: number };
    return r.m + 1;
  }
  addVersion(athleteId: string, v: Omit<PlanSnapshot, 'id' | 'seq'>): PlanSnapshot {
    const id = randomUUID().slice(0, 8);
    const seq = this.nextSeq(athleteId);
    this.db
      .prepare(
        'INSERT INTO plan_versions (id, athlete_id, seq, status, detected_on, effective_on, label, fingerprint, content) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(
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
  dropDrafts(athleteId: string): void {
    this.db.prepare("DELETE FROM plan_versions WHERE athlete_id = ? AND status = 'borrador'").run(athleteId);
  }

  saveEvent(athleteId: string, e: ChangeEvent): void {
    this.db
      .prepare(
        `INSERT INTO change_events (id, athlete_id, version_a, version_b, status, detected_on, effective_on, payload, coach_comment) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT (athlete_id, id) DO NOTHING`,
      )
      .run(
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
  listEvents(athleteId: string): ChangeEvent[] {
    return (
      this.db
        .prepare(
          'SELECT payload, coach_comment FROM change_events WHERE athlete_id = ? ORDER BY detected_on, id',
        )
        .all(athleteId) as { payload: string; coach_comment: string }[]
    ).map((r) => ({ ...(JSON.parse(r.payload) as ChangeEvent), coachComment: r.coach_comment }));
  }
  setEventComment(athleteId: string, id: string, comment: string): boolean {
    return (
      Number(
        this.db
          .prepare('UPDATE change_events SET coach_comment = ? WHERE athlete_id = ? AND id = ?')
          .run(comment, athleteId, id).changes,
      ) > 0
    );
  }

  upsertFeedback(
    athleteId: string,
    f: { sessionKey: string; endFatigue: number | null; note?: string },
  ): void {
    const before = this.db
      .prepare('SELECT end_fatigue, note FROM session_feedback WHERE athlete_id = ? AND session_key = ?')
      .get(athleteId, f.sessionKey) as { end_fatigue: number | null; note: string } | undefined;
    logRevision(
      this.db,
      athleteId,
      'session_feedback',
      f.sessionKey,
      before ? { endFatigue: before.end_fatigue, note: before.note } : null,
      { endFatigue: f.endFatigue, note: f.note ?? '' },
      new Date().toISOString(),
    );
    this.db
      .prepare(
        `INSERT INTO session_feedback (athlete_id, session_key, end_fatigue, note) VALUES (?,?,?,?)
      ON CONFLICT (athlete_id, session_key) DO UPDATE SET end_fatigue=excluded.end_fatigue, note=excluded.note`,
      )
      .run(athleteId, f.sessionKey, f.endFatigue, f.note ?? '');
  }
  listFeedback(athleteId: string): SessionFeedback[] {
    return (
      this.db
        .prepare('SELECT session_key, end_fatigue FROM session_feedback WHERE athlete_id = ?')
        .all(athleteId) as { session_key: string; end_fatigue: number | null }[]
    ).map((r) => ({ sessionKey: r.session_key, endFatigue: r.end_fatigue }));
  }

  upsertReview(athleteId: string, r: CoachReview): void {
    this.db
      .prepare(
        `INSERT INTO coach_reviews (athlete_id, lift, date, verdict, note) VALUES (?,?,?,?,?)
      ON CONFLICT (athlete_id, lift, date) DO UPDATE SET verdict=excluded.verdict, note=excluded.note`,
      )
      .run(athleteId, r.lift, r.date, r.verdict, r.note);
  }
  listReviews(athleteId: string): CoachReview[] {
    return this.db
      .prepare('SELECT lift, date, verdict, note FROM coach_reviews WHERE athlete_id = ? ORDER BY date')
      .all(athleteId) as unknown as CoachReview[];
  }

  addCompetition(athleteId: string, c: { name: string; date: string; phase: string }): string {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO competitions (id, athlete_id, name, date, phase) VALUES (?,?,?,?,?)')
      .run(id, athleteId, c.name, c.date, c.phase);
    return id;
  }
  listCompetitions(
    athleteId?: string,
  ): { id: string; athleteId: string; name: string; date: string; phase: string }[] {
    const rows = (
      athleteId
        ? this.db.prepare('SELECT * FROM competitions WHERE athlete_id = ? ORDER BY date').all(athleteId)
        : this.db.prepare('SELECT * FROM competitions ORDER BY date').all()
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
