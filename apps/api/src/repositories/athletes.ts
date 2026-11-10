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
  /** Cambia nombre y/o los ejercicios de competencia (parcial: lo que no se manda no se toca). */
  async update(
    id: string,
    patch: { name?: string; competitionExercises?: Partial<Record<Lift, string>> },
  ): Promise<void> {
    const cur = await this.get(id);
    if (!cur) return;
    await this.db.run(
      'UPDATE athletes SET name = ?, competition_exercises = ? WHERE id = ?',
      patch.name ?? cur.name,
      JSON.stringify({ ...cur.competitionExercises, ...(patch.competitionExercises ?? {}) }),
      id,
    );
  }
  /**
   * Elimina al atleta y TODO lo suyo (plan, ejecución, evaluaciones, cuentas, notas…), en una transacción. No depende de que el motor
   * aplique las cascadas: recorre las tablas con atleta en orden de dependencias (primero las hijas).
   */
  async deleteAll(id: string): Promise<{ tables: number; rows: number }> {
    const tables = (
      await this.db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
    ).map((t) => t.name);
    const withAthlete: string[] = [];
    for (const t of tables) {
      if (['athletes', 'schema_migrations', 'coaches', 'coach_tokens'].includes(t)) continue;
      const cols = await this.db.all<{ name: string }>(`PRAGMA table_info(${t})`);
      if (cols.some((c) => c.name === 'athlete_id')) withAthlete.push(t);
    }
    const deps = new Map<string, Set<string>>();
    for (const t of withAthlete)
      deps.set(
        t,
        new Set(
          (await this.db.all<{ table: string }>(`PRAGMA foreign_key_list(${t})`))
            .map((r) => r.table)
            .filter((x) => x !== t && withAthlete.includes(x)),
        ),
      );
    // orden de carga (padres primero); se borra al revés
    const order: string[] = [];
    while (order.length < withAthlete.length) {
      const next = withAthlete.filter(
        (t) => !order.includes(t) && [...(deps.get(t) ?? [])].every((d) => order.includes(d)),
      );
      if (!next.length) throw new Error('Dependencias circulares entre tablas');
      order.push(...next);
    }
    let rows = 0;
    await this.db.transaction(async () => {
      for (const t of [...order].reverse())
        rows += (await this.db.run(`DELETE FROM ${t} WHERE athlete_id = ?`, id)).changes;
      rows += (await this.db.run('DELETE FROM athletes WHERE id = ?', id)).changes;
    });
    return { tables: order.length + 1, rows };
  }
  async setParams(id: string, params: ParamsInput): Promise<void> {
    await this.db.run('UPDATE athletes SET params = ? WHERE id = ?', JSON.stringify(params), id);
  }
}
