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
  async create(name: string, competitionExercises: Partial<Record<Lift, string>>): Promise<AthleteRow> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await this.db.run(
      'INSERT INTO athletes (id, name, competition_exercises, params, created_at) VALUES (?,?,?,?,?)',
      id,
      name,
      JSON.stringify(competitionExercises),
      '{}',
      createdAt,
    );
    return { id, name, competitionExercises, params: {}, createdAt };
  }
  async list(): Promise<AthleteRow[]> {
    return ((await this.db.all('SELECT * FROM athletes ORDER BY name')) as Raw[]).map(map);
  }
  async get(id: string): Promise<AthleteRow | null> {
    const r = (await this.db.get('SELECT * FROM athletes WHERE id = ?', id)) as Raw | undefined;
    return r ? map(r) : null;
  }
  async setParams(id: string, params: ParamsInput): Promise<void> {
    await this.db.run('UPDATE athletes SET params = ? WHERE id = ?', JSON.stringify(params), id);
  }
}
