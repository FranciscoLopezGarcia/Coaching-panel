import { randomUUID } from 'node:crypto';
import type { StrengthReference } from '@coaching/engine';
import type { Db } from '../db/connection.js';

type RRaw = {
  id: string;
  exercise_name: string;
  kg: number;
  source: StrengthReference['source'];
  as_of: string;
  version: string;
  note: string;
};

/** Referencias de fuerza fechadas. Nunca se editan en el lugar: una referencia nueva se agrega con su fecha y rige desde ahí. */
export class ReferencesRepo {
  constructor(private db: Db) {}
  async add(
    athleteId: string,
    r: Omit<StrengthReference, 'id' | 'version'> & { version?: string },
  ): Promise<StrengthReference> {
    const id = randomUUID();
    await this.db.run(
      'INSERT INTO strength_references (id, athlete_id, exercise_name, kg, source, as_of, version, note) VALUES (?,?,?,?,?,?,?,?)',
      id,
      athleteId,
      r.exerciseName,
      r.kg,
      r.source,
      r.asOf,
      r.version ?? 'v1',
      r.note,
    );
    return {
      id,
      exerciseName: r.exerciseName,
      kg: r.kg,
      source: r.source,
      asOf: r.asOf,
      version: r.version ?? 'v1',
      note: r.note,
    };
  }
  async list(athleteId: string): Promise<StrengthReference[]> {
    return (
      (await this.db.all(
        'SELECT * FROM strength_references WHERE athlete_id = ? ORDER BY exercise_name, as_of',
        athleteId,
      )) as RRaw[]
    ).map((r) => ({
      id: r.id,
      exerciseName: r.exercise_name,
      kg: r.kg,
      source: r.source,
      asOf: r.as_of,
      version: r.version,
      note: r.note,
    }));
  }
}
