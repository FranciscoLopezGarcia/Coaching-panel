import { randomUUID } from 'node:crypto';
import type { AttemptInput, CustomExerciseInput, ProfileInput } from '@coaching/contracts';
import type { Db } from '../db/connection.js';

type ProfileRaw = {
  birth_date: string | null;
  sex: ProfileInput['sex'];
  bodyweight_kg: number | null;
  weight_class: string;
  federation: string;
  equipment: ProfileInput['equipment'];
  training_since: string | null;
  days_per_week: number | null;
  goals: string;
  history_notes: string;
  constraints_notes: string;
  updated_at: string;
};
export interface ProfileRow extends ProfileInput {
  updatedAt: string | null;
}
export interface CustomExerciseRow extends CustomExerciseInput {
  id: string;
  createdAt: string;
}

/** Perfil ampliado, intentos de competencia y biblioteca propia. Ausencia = NULL (nunca 0). */
export class ExtrasRepo {
  constructor(private db: Db) {}

  async getProfile(athleteId: string): Promise<ProfileRow | null> {
    const r = (await this.db.get('SELECT * FROM athlete_profile WHERE athlete_id = ?', athleteId)) as
      ProfileRaw | undefined;
    if (!r) return null;
    return {
      birthDate: r.birth_date,
      sex: r.sex,
      bodyweightKg: r.bodyweight_kg,
      weightClass: r.weight_class,
      federation: r.federation,
      equipment: r.equipment,
      trainingSince: r.training_since,
      daysPerWeek: r.days_per_week,
      goals: r.goals,
      historyNotes: r.history_notes,
      constraintsNotes: r.constraints_notes,
      updatedAt: r.updated_at,
    };
  }
  async putProfile(athleteId: string, p: ProfileInput, nowIso: string): Promise<void> {
    await this.db.run(
      `INSERT INTO athlete_profile (athlete_id, birth_date, sex, bodyweight_kg, weight_class, federation, equipment, training_since, days_per_week, goals, history_notes, constraints_notes, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(athlete_id) DO UPDATE SET birth_date=excluded.birth_date, sex=excluded.sex, bodyweight_kg=excluded.bodyweight_kg,
         weight_class=excluded.weight_class, federation=excluded.federation, equipment=excluded.equipment, training_since=excluded.training_since,
         days_per_week=excluded.days_per_week, goals=excluded.goals, history_notes=excluded.history_notes,
         constraints_notes=excluded.constraints_notes, updated_at=excluded.updated_at`,
      athleteId,
      p.birthDate,
      p.sex,
      p.bodyweightKg,
      p.weightClass,
      p.federation,
      p.equipment,
      p.trainingSince,
      p.daysPerWeek,
      p.goals,
      p.historyNotes,
      p.constraintsNotes,
      nowIso,
    );
  }

  async listAttempts(athleteId: string): Promise<(AttemptInput & { competitionId: string })[]> {
    const rows = (await this.db.all(
      `SELECT a.* FROM competition_attempts a JOIN competitions c ON c.id = a.competition_id
       WHERE c.athlete_id = ? ORDER BY a.competition_id, a.lift, a.attempt_no`,
      athleteId,
    )) as {
      competition_id: string;
      lift: AttemptInput['lift'];
      attempt_no: number;
      planned_kg: number | null;
      actual_kg: number | null;
      result: AttemptInput['result'];
      note: string;
    }[];
    return rows.map((r) => ({
      competitionId: r.competition_id,
      lift: r.lift,
      attemptNo: r.attempt_no,
      plannedKg: r.planned_kg,
      actualKg: r.actual_kg,
      result: r.result,
      note: r.note,
    }));
  }
  /** Reemplaza los intentos de UNA competencia (el coach edita la tabla completa). Los vacíos no se guardan. */
  async putAttempts(competitionId: string, attempts: AttemptInput[]): Promise<void> {
    const rows = attempts
      .filter((a) => !(a.plannedKg === null && a.actualKg === null && a.result === null && !a.note.trim()))
      .map((a) => [competitionId, a.lift, a.attemptNo, a.plannedKg, a.actualKg, a.result, a.note]);
    // Borrar e insertar en una sola unidad: si algo falla no se pierden los intentos que había.
    await this.db.transaction(async () => {
      await this.db.run('DELETE FROM competition_attempts WHERE competition_id = ?', competitionId);
      await this.db.runMany(
        'INSERT INTO competition_attempts (competition_id, lift, attempt_no, planned_kg, actual_kg, result, note) VALUES (?,?,?,?,?,?,?)',
        rows as never,
      );
    });
  }

  async listExercises(): Promise<CustomExerciseRow[]> {
    const rows = (await this.db.all('SELECT * FROM exercise_library ORDER BY name')) as {
      id: string;
      name: string;
      lift: CustomExerciseInput['lift'];
      pattern: string;
      equipment: string;
      muscles: string;
      notes: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      lift: r.lift,
      pattern: r.pattern,
      equipment: r.equipment,
      muscles: JSON.parse(r.muscles) as CustomExerciseInput['muscles'],
      notes: r.notes,
      createdAt: r.created_at,
    }));
  }
  async addExercise(e: CustomExerciseInput, nowIso: string): Promise<string> {
    const id = randomUUID();
    await this.db.run(
      'INSERT INTO exercise_library (id, name, lift, pattern, equipment, muscles, notes, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id,
      e.name,
      e.lift,
      e.pattern,
      e.equipment,
      JSON.stringify(e.muscles),
      e.notes,
      nowIso,
    );
    return id;
  }
  async updateExercise(id: string, e: CustomExerciseInput): Promise<boolean> {
    const r = await this.db.run(
      'UPDATE exercise_library SET name = ?, lift = ?, pattern = ?, equipment = ?, muscles = ?, notes = ? WHERE id = ?',
      e.name,
      e.lift,
      e.pattern,
      e.equipment,
      JSON.stringify(e.muscles),
      e.notes,
      id,
    );
    return r.changes > 0;
  }
  async deleteExercise(id: string): Promise<boolean> {
    return (await this.db.run('DELETE FROM exercise_library WHERE id = ?', id)).changes > 0;
  }
}
