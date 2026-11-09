import { randomUUID } from 'node:crypto';
import type { Lift } from '@coaching/engine';
import type { ParamsInput } from '@coaching/contracts';
import type { Db } from '../db/connection.js';

export interface AthleteRow {
  id: string;
  name: string;
  competitionExercises: Partial<Record<Lift, string>>;
  params: ParamsInput;
  createdAt: string;
}
type Raw = { id: string; name: string; competition_exercises: string; params: string; created_at: string };
const map = (r: Raw): AthleteRow => ({
  id: r.id,
  name: r.name,
  competitionExercises: JSON.parse(r.competition_exercises),
  params: JSON.parse(r.params),
  createdAt: r.created_at,
});

export class AthletesRepo {
  constructor(private db: Db) {}
  create(name: string, competitionExercises: Partial<Record<Lift, string>>): AthleteRow {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO athletes (id, name, competition_exercises, params, created_at) VALUES (?,?,?,?,?)',
      )
      .run(id, name, JSON.stringify(competitionExercises), '{}', createdAt);
    return { id, name, competitionExercises, params: {}, createdAt };
  }
  list(): AthleteRow[] {
    return (this.db.prepare('SELECT * FROM athletes ORDER BY name').all() as Raw[]).map(map);
  }
  get(id: string): AthleteRow | null {
    const r = this.db.prepare('SELECT * FROM athletes WHERE id = ?').get(id) as Raw | undefined;
    return r ? map(r) : null;
  }
  setParams(id: string, params: ParamsInput): void {
    this.db.prepare('UPDATE athletes SET params = ? WHERE id = ?').run(JSON.stringify(params), id);
  }
}
