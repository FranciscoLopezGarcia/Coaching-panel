import { logRevision } from './revisions.js';
import type { ActualSet, PlannedSet } from '@coaching/engine';
import type { CheckInInput } from '@coaching/contracts';
import type { Db } from '../db/connection.js';

type PRaw = {
  id: string;
  session_key: string;
  slot_key: string;
  exercise_name: string;
  lift: PlannedSet['lift'];
  planned_date: string;
  set_no: number;
  reps: number;
  target_rpe: number | null;
  planned_kg: number | null;
  is_warmup: number;
  block_key: string;
  week_no: number;
  day_no: number;
  family_key: string;
  ref_kg: number | null;
  retired: number;
  exposure_id: string;
  exposure_role: PlannedSet['exposureRole'];
  priority: number | null;
  variant_key: string;
  copied_from: string | null;
  planned_kg_source: PlannedSet['plannedKgSource'];
  protocol: string | null;
  identity_source: string;
};
type ARaw = {
  planned_set_id: string;
  status: ActualSet['status'];
  kg: number | null;
  reps: number | null;
  rpe: number | null;
  performed_on: string | null;
  pain: number | null;
};

const mapPlanned = (r: PRaw): PlannedSet => ({
  id: r.id,
  sessionKey: r.session_key,
  slotKey: r.slot_key,
  exerciseName: r.exercise_name,
  lift: r.lift,
  plannedDate: r.planned_date,
  setNo: r.set_no,
  reps: r.reps,
  targetRpe: r.target_rpe,
  plannedKg: r.planned_kg,
  isWarmup: r.is_warmup === 1,
  blockKey: r.block_key,
  weekNo: r.week_no,
  dayNo: r.day_no,
  familyKey: r.family_key,
  refKg: r.ref_kg,
  exposureId: r.exposure_id || r.slot_key,
  exposureRole: r.exposure_role,
  priority: r.priority,
  variantKey: r.variant_key || r.exercise_name,
  copiedFrom: r.copied_from,
  plannedKgSource: r.planned_kg_source,
  protocol: r.protocol ? (JSON.parse(r.protocol) as PlannedSet['protocol']) : null,
});

/** Prescripción (planned) y ejecución (actual) en tablas separadas. Upserts idempotentes por id. */
export class RecordsRepo {
  constructor(private db: Db) {}

  upsertPlanned(
    athleteId: string,
    sets: PlannedSet[],
    identitySource: 'declarada' | 'derivada_del_nombre' = 'declarada',
  ): number {
    const st = this.db
      .prepare(`INSERT INTO planned_sets (id, athlete_id, session_key, slot_key, exercise_name, lift, planned_date, set_no, reps, target_rpe, planned_kg, is_warmup,
        block_key, week_no, day_no, family_key, ref_kg, retired, exposure_id, exposure_role, priority, variant_key, copied_from, planned_kg_source, protocol, identity_source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?)
      ON CONFLICT (athlete_id, id) DO UPDATE SET session_key=excluded.session_key, slot_key=excluded.slot_key, exercise_name=excluded.exercise_name, lift=excluded.lift,
        planned_date=excluded.planned_date, set_no=excluded.set_no, reps=excluded.reps, target_rpe=excluded.target_rpe, planned_kg=excluded.planned_kg, is_warmup=excluded.is_warmup,
        block_key=excluded.block_key, week_no=excluded.week_no, day_no=excluded.day_no, family_key=excluded.family_key, ref_kg=excluded.ref_kg, retired=0,
        exposure_id=excluded.exposure_id, exposure_role=excluded.exposure_role, priority=excluded.priority, variant_key=excluded.variant_key, copied_from=excluded.copied_from,
        planned_kg_source=excluded.planned_kg_source, protocol=excluded.protocol,
        identity_source=CASE WHEN planned_sets.identity_source = 'legacy_slot' AND excluded.exposure_id = planned_sets.exposure_id THEN 'legacy_slot' ELSE excluded.identity_source END`);
    for (const s of sets) {
      st.run(
        s.id,
        athleteId,
        s.sessionKey,
        s.slotKey,
        s.exerciseName,
        s.lift,
        s.plannedDate,
        s.setNo,
        s.reps,
        s.targetRpe,
        s.plannedKg,
        s.isWarmup ? 1 : 0,
        s.blockKey,
        s.weekNo,
        s.dayNo,
        s.familyKey,
        s.refKg,
        s.exposureId,
        s.exposureRole,
        s.priority,
        s.variantKey,
        s.copiedFrom,
        s.plannedKgSource,
        s.protocol ? JSON.stringify(s.protocol) : null,
        identitySource,
      );
    }
    return sets.length;
  }
  /** Origen de la identidad de una exposición: 'declarada', 'derivada_del_nombre' o 'legacy_slot' (migrada del esquema anterior). */
  identitySource(athleteId: string, exposureId: string): string {
    const r = this.db
      .prepare('SELECT identity_source FROM planned_sets WHERE athlete_id = ? AND exposure_id = ? LIMIT 1')
      .get(athleteId, exposureId) as { identity_source: string } | undefined;
    return r?.identity_source ?? 'declarada';
  }
  /** Plan VIGENTE (sin series retiradas): es lo que se versiona. */
  listActivePlanned(athleteId: string): PlannedSet[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM planned_sets WHERE athlete_id = ? AND retired = 0 ORDER BY planned_date, session_key, set_no',
        )
        .all(athleteId) as PRaw[]
    ).map(mapPlanned);
  }
  /** Para el motor: el plan vigente MÁS las series retiradas que tienen ejecución (historial). */
  listPlanned(athleteId: string): PlannedSet[] {
    return (
      this.db
        .prepare(
          `SELECT p.* FROM planned_sets p WHERE p.athlete_id = ? AND (p.retired = 0 OR EXISTS (SELECT 1 FROM actual_sets a WHERE a.athlete_id = p.athlete_id AND a.planned_set_id = p.id))
           ORDER BY p.planned_date, p.session_key, p.set_no`,
        )
        .all(athleteId) as PRaw[]
    ).map(mapPlanned);
  }
  /** Retira del plan vigente lo que no está en `keepIds`: con ejecución queda como historial; sin ejecución se borra. */
  retireMissing(athleteId: string, keepIds: Set<string>): { retired: number; deleted: number } {
    let retired = 0;
    let deleted = 0;
    const rows = this.db
      .prepare('SELECT id FROM planned_sets WHERE athlete_id = ? AND retired = 0')
      .all(athleteId) as { id: string }[];
    const hasActual = this.db.prepare(
      'SELECT 1 FROM actual_sets WHERE athlete_id = ? AND planned_set_id = ?',
    );
    for (const { id } of rows) {
      if (keepIds.has(id)) continue;
      if (hasActual.get(athleteId, id)) {
        this.db
          .prepare('UPDATE planned_sets SET retired = 1 WHERE athlete_id = ? AND id = ?')
          .run(athleteId, id);
        retired++;
      } else {
        this.db.prepare('DELETE FROM planned_sets WHERE athlete_id = ? AND id = ?').run(athleteId, id);
        deleted++;
      }
    }
    return { retired, deleted };
  }
  /** Devuelve los ids que no existen como series previstas (la ejecución siempre cuelga de una prescripción). */
  missingPlanned(athleteId: string, ids: string[]): string[] {
    const st = this.db.prepare('SELECT 1 FROM planned_sets WHERE athlete_id = ? AND id = ?');
    return ids.filter((id) => !st.get(athleteId, id));
  }
  upsertActual(athleteId: string, sets: ActualSet[], nowIso: string, reason?: string): number {
    const st = this.db
      .prepare(`INSERT INTO actual_sets (athlete_id, planned_set_id, status, kg, reps, rpe, performed_on, pain, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT (athlete_id, planned_set_id) DO UPDATE SET status=excluded.status, kg=excluded.kg, reps=excluded.reps, rpe=excluded.rpe, performed_on=excluded.performed_on, pain=excluded.pain, updated_at=excluded.updated_at`);
    const cur = this.db.prepare('SELECT * FROM actual_sets WHERE athlete_id = ? AND planned_set_id = ?');
    const pick = (r: ARaw | undefined): ActualSet | null =>
      r
        ? {
            plannedSetId: r.planned_set_id,
            status: r.status,
            kg: r.kg,
            reps: r.reps,
            rpe: r.rpe,
            performedOn: r.performed_on,
            pain: r.pain,
          }
        : null;
    for (const s of sets) {
      const before = pick(cur.get(athleteId, s.plannedSetId) as ARaw | undefined);
      st.run(athleteId, s.plannedSetId, s.status, s.kg, s.reps, s.rpe, s.performedOn, s.pain, nowIso);
      logRevision(this.db, athleteId, 'actual_set', s.plannedSetId, before, s, nowIso, reason);
    }
    return sets.length;
  }
  listActual(athleteId: string): ActualSet[] {
    return (this.db.prepare('SELECT * FROM actual_sets WHERE athlete_id = ?').all(athleteId) as ARaw[]).map(
      (r) => ({
        plannedSetId: r.planned_set_id,
        status: r.status,
        kg: r.kg,
        reps: r.reps,
        rpe: r.rpe,
        performedOn: r.performed_on,
        pain: r.pain,
      }),
    );
  }
  lastRecordDate(athleteId: string): string | null {
    const r = this.db
      .prepare("SELECT MAX(performed_on) AS d FROM actual_sets WHERE athlete_id = ? AND status = 'done'")
      .get(athleteId) as { d: string | null };
    return r.d;
  }
  upsertCheckIn(athleteId: string, c: CheckInInput, reason?: string): void {
    const before = this.db
      .prepare(
        'SELECT date, sleep, energy, motivation, stress, pain FROM checkins WHERE athlete_id = ? AND date = ?',
      )
      .get(athleteId, c.date) as CheckInInput | undefined;
    logRevision(
      this.db,
      athleteId,
      'checkin',
      c.date,
      before ? { ...before } : null,
      c,
      new Date().toISOString(),
      reason,
    );
    this.db
      .prepare(
        `INSERT INTO checkins (athlete_id, date, sleep, energy, motivation, stress, pain) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (athlete_id, date) DO UPDATE SET sleep=excluded.sleep, energy=excluded.energy, motivation=excluded.motivation, stress=excluded.stress, pain=excluded.pain`,
      )
      .run(athleteId, c.date, c.sleep, c.energy, c.motivation, c.stress, c.pain);
  }
  listCheckIns(athleteId: string): CheckInInput[] {
    return this.db
      .prepare(
        'SELECT date, sleep, energy, motivation, stress, pain FROM checkins WHERE athlete_id = ? ORDER BY date',
      )
      .all(athleteId) as unknown as CheckInInput[];
  }
}
