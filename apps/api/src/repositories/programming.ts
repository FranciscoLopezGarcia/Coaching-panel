import { randomUUID } from 'node:crypto';
import type { MacroMeta, MesoMeta, MicroMeta, PlanTemplate } from '@coaching/engine';
import type { Db } from '../db/connection.js';

/** Macro → meso → microciclo con fechas explícitas y duración variable, plantillas y vínculos explícitos entre identidades de exposición. */
export class ProgrammingRepo {
  constructor(private db: Db) {}

  async createMacro(athleteId: string, m: Omit<MacroMeta, 'id'>): Promise<MacroMeta> {
    const id = randomUUID();
    await this.db.run(
      'INSERT INTO macros (id, athlete_id, name, start_date, end_date, objective, status) VALUES (?,?,?,?,?,?,?)',
      id,
      athleteId,
      m.name,
      m.startDate,
      m.endDate,
      m.objective,
      m.status,
    );
    return { id, ...m };
  }
  async listMacros(athleteId: string): Promise<MacroMeta[]> {
    return (
      (await this.db.all(
        'SELECT * FROM macros WHERE athlete_id = ? ORDER BY start_date DESC',
        athleteId,
      )) as {
        id: string;
        name: string;
        start_date: string;
        end_date: string | null;
        objective: string | null;
        status: MacroMeta['status'];
      }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
      objective: r.objective,
      status: r.status,
    }));
  }
  async getMacro(athleteId: string, id: string): Promise<MacroMeta | null> {
    return (await this.listMacros(athleteId)).find((m) => m.id === id) ?? null;
  }
  async upsertMeso(athleteId: string, m: MesoMeta): Promise<void> {
    await this.db.run(
      `INSERT INTO mesos (athlete_id, block_key, macro_id, name, start_date, end_date, objective) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (athlete_id, block_key) DO UPDATE SET macro_id=excluded.macro_id, name=excluded.name, start_date=excluded.start_date, end_date=excluded.end_date, objective=excluded.objective`,
      athleteId,
      m.blockKey,
      m.macroId,
      m.name,
      m.startDate,
      m.endDate,
      m.objective,
    );
  }
  async listMesos(athleteId: string): Promise<MesoMeta[]> {
    return (
      (await this.db.all('SELECT * FROM mesos WHERE athlete_id = ? ORDER BY block_key', athleteId)) as {
        block_key: string;
        macro_id: string | null;
        name: string;
        start_date: string | null;
        end_date: string | null;
        objective: string | null;
      }[]
    ).map((r) => ({
      blockKey: r.block_key,
      macroId: r.macro_id,
      name: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
      objective: r.objective,
    }));
  }
  /** Quita la ficha del bloque (meso) y de sus microciclos. Las series del bloque se tratan aparte (ver BlockAdmin). */
  async deleteBlockMeta(athleteId: string, blockKey: string): Promise<void> {
    await this.db.run('DELETE FROM microcycles WHERE athlete_id = ? AND block_key = ?', athleteId, blockKey);
    await this.db.run('DELETE FROM mesos WHERE athlete_id = ? AND block_key = ?', athleteId, blockKey);
  }
  async upsertMicro(athleteId: string, m: MicroMeta): Promise<void> {
    await this.db.run(
      `INSERT INTO microcycles (athlete_id, block_key, week_no, start_date, end_date) VALUES (?,?,?,?,?)
      ON CONFLICT (athlete_id, block_key, week_no) DO UPDATE SET start_date=excluded.start_date, end_date=excluded.end_date`,
      athleteId,
      m.blockKey,
      m.weekNo,
      m.startDate,
      m.endDate,
    );
  }
  async listMicros(athleteId: string): Promise<MicroMeta[]> {
    return (
      (await this.db.all(
        'SELECT * FROM microcycles WHERE athlete_id = ? ORDER BY block_key, week_no',
        athleteId,
      )) as { block_key: string; week_no: number; start_date: string; end_date: string }[]
    ).map((r) => ({
      blockKey: r.block_key,
      weekNo: r.week_no,
      startDate: r.start_date,
      endDate: r.end_date,
    }));
  }

  async saveTemplate(athleteId: string, t: PlanTemplate, nowIso: string): Promise<string> {
    const id = randomUUID();
    await this.db.run(
      'INSERT INTO plan_templates (id, athlete_id, name, payload, created_at) VALUES (?,?,?,?,?)',
      id,
      athleteId,
      t.name,
      JSON.stringify(t),
      nowIso,
    );
    return id;
  }
  async getTemplate(athleteId: string, id: string): Promise<PlanTemplate | null> {
    const r = (await this.db.get(
      'SELECT payload FROM plan_templates WHERE athlete_id = ? AND id = ?',
      athleteId,
      id,
    )) as { payload: string } | undefined;
    return r ? (JSON.parse(r.payload) as PlanTemplate) : null;
  }
  async listTemplates(athleteId: string): Promise<{ id: string; name: string; createdAt: string }[]> {
    return (
      (await this.db.all(
        'SELECT id, name, created_at FROM plan_templates WHERE athlete_id = ? ORDER BY created_at DESC',
        athleteId,
      )) as { id: string; name: string; created_at: string }[]
    ).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  }

  async link(athleteId: string, from: string, to: string, on: string, note: string): Promise<void> {
    await this.db.run(
      `INSERT INTO exposure_links (athlete_id, from_exposure_id, to_exposure_id, linked_on, note) VALUES (?,?,?,?,?)
      ON CONFLICT (athlete_id, from_exposure_id) DO UPDATE SET to_exposure_id=excluded.to_exposure_id, linked_on=excluded.linked_on, note=excluded.note`,
      athleteId,
      from,
      to,
      on,
      note,
    );
  }
  async unlink(athleteId: string, from: string): Promise<boolean> {
    return (
      Number(
        (
          await this.db.run(
            'DELETE FROM exposure_links WHERE athlete_id = ? AND from_exposure_id = ?',
            athleteId,
            from,
          )
        ).changes,
      ) > 0
    );
  }
  async links(athleteId: string): Promise<{ from: string; to: string; linkedOn: string; note: string }[]> {
    return (
      (await this.db.all(
        'SELECT * FROM exposure_links WHERE athlete_id = ? ORDER BY from_exposure_id',
        athleteId,
      )) as {
        from_exposure_id: string;
        to_exposure_id: string;
        linked_on: string;
        note: string;
      }[]
    ).map((r) => ({ from: r.from_exposure_id, to: r.to_exposure_id, linkedOn: r.linked_on, note: r.note }));
  }
}
