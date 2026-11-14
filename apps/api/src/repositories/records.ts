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

  async upsertPlanned(
    athleteId: string,
    sets: PlannedSet[],
    identitySource: 'declarada' | 'derivada_del_nombre' = 'declarada',
  ): Promise<number> {
    const sql = `INSERT INTO planned_sets (id, athlete_id, session_key, slot_key, exercise_name, lift, planned_date, set_no, reps, target_rpe, planned_kg, is_warmup,
        block_key, week_no, day_no, family_key, ref_kg, retired, exposure_id, exposure_role, priority, variant_key, copied_from, planned_kg_source, protocol, identity_source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?)
      ON CONFLICT (athlete_id, id) DO UPDATE SET session_key=excluded.session_key, slot_key=excluded.slot_key, exercise_name=excluded.exercise_name, lift=excluded.lift,
        planned_date=excluded.planned_date, set_no=excluded.set_no, reps=excluded.reps, target_rpe=excluded.target_rpe, planned_kg=excluded.planned_kg, is_warmup=excluded.is_warmup,
        block_key=excluded.block_key, week_no=excluded.week_no, day_no=excluded.day_no, family_key=excluded.family_key, ref_kg=excluded.ref_kg, retired=0,
        exposure_id=excluded.exposure_id, exposure_role=excluded.exposure_role, priority=excluded.priority, variant_key=excluded.variant_key, copied_from=excluded.copied_from,
        planned_kg_source=excluded.planned_kg_source, protocol=excluded.protocol,
        identity_source=CASE WHEN planned_sets.identity_source = 'legacy_slot' AND excluded.exposure_id = planned_sets.exposure_id THEN 'legacy_slot' ELSE excluded.identity_source END`;
    const rows = sets.map((s) => [
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
    ]);
    await this.db.runMany(sql, rows);
    return sets.length;
  }
  /** Origen de la identidad de una exposición: 'declarada', 'derivada_del_nombre' o 'legacy_slot' (migrada del esquema anterior). */
  async identitySource(athleteId: string, exposureId: string): Promise<string> {
    const r = (await this.db.get(
      'SELECT identity_source FROM planned_sets WHERE athlete_id = ? AND exposure_id = ? LIMIT 1',
      athleteId,
      exposureId,
    )) as { identity_source: string } | undefined;
    return r?.identity_source ?? 'declarada';
  }
  /** Plan VIGENTE (sin series retiradas): es lo que se versiona. */
  async listActivePlanned(athleteId: string): Promise<PlannedSet[]> {
    return (
      (await this.db.all(
        'SELECT * FROM planned_sets WHERE athlete_id = ? AND retired = 0 ORDER BY planned_date, session_key, set_no',
        athleteId,
      )) as PRaw[]
    ).map(mapPlanned);
  }
  /** Solo los ids del plan vigente (liviano: evita releer todas las series). */
  async listActivePlannedIds(athleteId: string): Promise<string[]> {
    return (
      (await this.db.all('SELECT id FROM planned_sets WHERE athlete_id = ? AND retired = 0', athleteId)) as {
        id: string;
      }[]
    ).map((r) => r.id);
  }
  /** Plan vigente de un solo bloque (liviano: para guardar plantillas sin leer todo el plan). */
  async listActivePlannedByBlock(athleteId: string, blockKey: string): Promise<PlannedSet[]> {
    return (
      (await this.db.all(
        'SELECT * FROM planned_sets WHERE athlete_id = ? AND retired = 0 AND block_key = ? ORDER BY planned_date, session_key, set_no',
        athleteId,
        blockKey,
      )) as PRaw[]
    ).map(mapPlanned);
  }
  /** Plan vigente de un rango de fechas (liviano: para el panel «hoy / semana»). */
  async listActivePlannedBetween(athleteId: string, from: string, to: string): Promise<PlannedSet[]> {
    return (
      (await this.db.all(
        'SELECT * FROM planned_sets WHERE athlete_id = ? AND retired = 0 AND planned_date >= ? AND planned_date <= ? ORDER BY planned_date, session_key, set_no',
        athleteId,
        from,
        to,
      )) as PRaw[]
    ).map(mapPlanned);
  }
  /** Ejecución de las series previstas en un rango de fechas. */
  async listActualBetween(athleteId: string, from: string, to: string): Promise<ActualSet[]> {
    return (
      (await this.db.all(
        `SELECT a.* FROM actual_sets a JOIN planned_sets p ON p.athlete_id = a.athlete_id AND p.id = a.planned_set_id
         WHERE a.athlete_id = ? AND p.retired = 0 AND p.planned_date >= ? AND p.planned_date <= ?`,
        athleteId,
        from,
        to,
      )) as ARaw[]
    ).map((r) => ({
      plannedSetId: r.planned_set_id,
      status: r.status,
      kg: r.kg,
      reps: r.reps,
      rpe: r.rpe,
      performedOn: r.performed_on,
      pain: r.pain,
    }));
  }
  /** Series de trabajo hechas con carga de los movimientos de competencia (para marcas de entrenamiento). */
  async listDoneLiftSets(athleteId: string): Promise<
    {
      exerciseName: string;
      lift: 'SQ' | 'BP' | 'DL';
      kg: number;
      reps: number;
      rpe: number | null;
      date: string;
    }[]
  > {
    return (
      (await this.db.all(
        `SELECT p.exercise_name, p.lift, a.kg, a.reps, a.rpe, a.performed_on FROM actual_sets a
         JOIN planned_sets p ON p.athlete_id = a.athlete_id AND p.id = a.planned_set_id
         WHERE a.athlete_id = ? AND a.status = 'done' AND a.kg IS NOT NULL AND a.reps IS NOT NULL
           AND a.performed_on IS NOT NULL AND p.lift IS NOT NULL AND p.is_warmup = 0`,
        athleteId,
      )) as {
        exercise_name: string;
        lift: 'SQ' | 'BP' | 'DL';
        kg: number;
        reps: number;
        rpe: number | null;
        performed_on: string;
      }[]
    ).map((r) => ({
      exerciseName: r.exercise_name,
      lift: r.lift,
      kg: r.kg,
      reps: r.reps,
      rpe: r.rpe,
      date: r.performed_on,
    }));
  }
  /** Para el motor: el plan vigente MÁS las series retiradas que tienen ejecución (historial). */
  async listPlanned(athleteId: string): Promise<PlannedSet[]> {
    return (
      (await this.db.all(
        `SELECT p.* FROM planned_sets p WHERE p.athlete_id = ? AND (p.retired = 0 OR EXISTS (SELECT 1 FROM actual_sets a WHERE a.athlete_id = p.athlete_id AND a.planned_set_id = p.id))
           ORDER BY p.planned_date, p.session_key, p.set_no`,
        athleteId,
      )) as PRaw[]
    ).map(mapPlanned);
  }
  /** Retira del plan vigente lo que no está en `keepIds`: con ejecución queda como historial; sin ejecución se borra. */
  async retireMissing(
    athleteId: string,
    keepIds: Set<string>,
  ): Promise<{ retired: number; deleted: number }> {
    let retired = 0;
    let deleted = 0;
    const rows = (await this.db.all(
      'SELECT id FROM planned_sets WHERE athlete_id = ? AND retired = 0',
      athleteId,
    )) as { id: string }[];
    for (const { id } of rows) {
      if (keepIds.has(id)) continue;
      if (
        await this.db.get(
          'SELECT 1 FROM actual_sets WHERE athlete_id = ? AND planned_set_id = ?',
          athleteId,
          id,
        )
      ) {
        await this.db.run(
          'UPDATE planned_sets SET retired = 1 WHERE athlete_id = ? AND id = ?',
          athleteId,
          id,
        );
        retired++;
      } else {
        await this.db.run('DELETE FROM planned_sets WHERE athlete_id = ? AND id = ?', athleteId, id);
        deleted++;
      }
    }
    return { retired, deleted };
  }
  /** Devuelve los ids que no existen como series previstas (la ejecución siempre cuelga de una prescripción). */
  async missingPlanned(athleteId: string, ids: string[]): Promise<string[]> {
    const have = new Set(
      (await this.db.all<{ id: string }>('SELECT id FROM planned_sets WHERE athlete_id = ?', athleteId)).map(
        (r) => r.id,
      ),
    );
    return ids.filter((id) => !have.has(id));
  }
  async upsertActual(athleteId: string, sets: ActualSet[], nowIso: string, reason?: string): Promise<number> {
    const upsert = `INSERT INTO actual_sets (athlete_id, planned_set_id, status, kg, reps, rpe, performed_on, pain, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT (athlete_id, planned_set_id) DO UPDATE SET status=excluded.status, kg=excluded.kg, reps=excluded.reps, rpe=excluded.rpe, performed_on=excluded.performed_on, pain=excluded.pain, updated_at=excluded.updated_at`;
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
      const before = pick(
        (await this.db.get(
          'SELECT * FROM actual_sets WHERE athlete_id = ? AND planned_set_id = ?',
          athleteId,
          s.plannedSetId,
        )) as ARaw | undefined,
      );
      await this.db.run(
        upsert,
        athleteId,
        s.plannedSetId,
        s.status,
        s.kg,
        s.reps,
        s.rpe,
        s.performedOn,
        s.pain,
        nowIso,
      );
      await logRevision(this.db, athleteId, 'actual_set', s.plannedSetId, before, s, nowIso, reason);
    }
    return sets.length;
  }
  async listActual(athleteId: string): Promise<ActualSet[]> {
    return ((await this.db.all('SELECT * FROM actual_sets WHERE athlete_id = ?', athleteId)) as ARaw[]).map(
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
  async lastRecordDate(athleteId: string): Promise<string | null> {
    const r = (await this.db.get(
      "SELECT MAX(performed_on) AS d FROM actual_sets WHERE athlete_id = ? AND status = 'done'",
      athleteId,
    )) as { d: string | null };
    return r.d;
  }
  async upsertCheckIn(athleteId: string, input: CheckInInput, reason?: string): Promise<void> {
    const { soreness, confidence, sleepHours, bodyweightKg, note, ...c } = input;
    const hasExtras =
      [soreness, confidence, sleepHours, bodyweightKg].some((x) => x != null) || !!note?.trim();
    if (hasExtras)
      await this.db.run(
        `INSERT INTO checkin_extras (athlete_id, date, soreness, confidence, sleep_hours, bodyweight_kg, note) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT (athlete_id, date) DO UPDATE SET soreness=excluded.soreness, confidence=excluded.confidence, sleep_hours=excluded.sleep_hours, bodyweight_kg=excluded.bodyweight_kg, note=excluded.note`,
        athleteId,
        c.date,
        soreness ?? null,
        confidence ?? null,
        sleepHours ?? null,
        bodyweightKg ?? null,
        note?.trim() ?? '',
      );
    const before = (await this.db.get(
      'SELECT date, sleep, energy, motivation, stress, pain FROM checkins WHERE athlete_id = ? AND date = ?',
      athleteId,
      c.date,
    )) as CheckInInput | undefined;
    await logRevision(
      this.db,
      athleteId,
      'checkin',
      c.date,
      before ? { ...before } : null,
      c,
      new Date().toISOString(),
      reason,
    );
    await this.db.run(
      `INSERT INTO checkins (athlete_id, date, sleep, energy, motivation, stress, pain) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (athlete_id, date) DO UPDATE SET sleep=excluded.sleep, energy=excluded.energy, motivation=excluded.motivation, stress=excluded.stress, pain=excluded.pain`,
      athleteId,
      c.date,
      c.sleep,
      c.energy,
      c.motivation,
      c.stress,
      c.pain,
    );
  }
  /** Datos opcionales del TRAC ampliado por fecha (no entran en la predisposición). */
  async listCheckInExtras(athleteId: string) {
    return (await this.db.all(
      'SELECT date, soreness, confidence, sleep_hours AS sleepHours, bodyweight_kg AS bodyweightKg, note FROM checkin_extras WHERE athlete_id = ? ORDER BY date',
      athleteId,
    )) as unknown as {
      date: string;
      soreness: number | null;
      confidence: number | null;
      sleepHours: number | null;
      bodyweightKg: number | null;
      note: string;
    }[];
  }
  async listCheckIns(athleteId: string): Promise<CheckInInput[]> {
    return (await this.db.all(
      'SELECT date, sleep, energy, motivation, stress, pain FROM checkins WHERE athlete_id = ? ORDER BY date',
      athleteId,
    )) as unknown as CheckInInput[];
  }
  /** Check-ins desde una fecha (liviano). */
  async listCheckInsSince(athleteId: string, from: string): Promise<CheckInInput[]> {
    return (await this.db.all(
      'SELECT date, sleep, energy, motivation, stress, pain FROM checkins WHERE athlete_id = ? AND date >= ? ORDER BY date',
      athleteId,
      from,
    )) as unknown as CheckInInput[];
  }
}
