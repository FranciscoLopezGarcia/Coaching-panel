import { randomUUID } from 'node:crypto';
import type { MacroMeta, MesoMeta, MicroMeta, PlanTemplate } from '@coaching/engine';
import type { Db } from '../db/connection.js';

/** Macro → meso → microciclo con fechas explícitas y duración variable, plantillas y vínculos explícitos entre identidades de exposición. */
export class ProgrammingRepo {
  constructor(private db: Db) {}

  createMacro(athleteId: string, m: Omit<MacroMeta, 'id'>): MacroMeta {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO macros (id, athlete_id, name, start_date, end_date, objective, status) VALUES (?,?,?,?,?,?,?)',
      )
      .run(id, athleteId, m.name, m.startDate, m.endDate, m.objective, m.status);
    return { id, ...m };
  }
  listMacros(athleteId: string): MacroMeta[] {
    return (
      this.db
        .prepare('SELECT * FROM macros WHERE athlete_id = ? ORDER BY start_date DESC')
        .all(athleteId) as {
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
  getMacro(athleteId: string, id: string): MacroMeta | null {
    return this.listMacros(athleteId).find((m) => m.id === id) ?? null;
  }
  upsertMeso(athleteId: string, m: MesoMeta): void {
    this.db
      .prepare(
        `INSERT INTO mesos (athlete_id, block_key, macro_id, name, start_date, end_date, objective) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (athlete_id, block_key) DO UPDATE SET macro_id=excluded.macro_id, name=excluded.name, start_date=excluded.start_date, end_date=excluded.end_date, objective=excluded.objective`,
      )
      .run(athleteId, m.blockKey, m.macroId, m.name, m.startDate, m.endDate, m.objective);
  }
  listMesos(athleteId: string): MesoMeta[] {
    return (
      this.db.prepare('SELECT * FROM mesos WHERE athlete_id = ? ORDER BY block_key').all(athleteId) as {
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
  upsertMicro(athleteId: string, m: MicroMeta): void {
    this.db
      .prepare(
        `INSERT INTO microcycles (athlete_id, block_key, week_no, start_date, end_date) VALUES (?,?,?,?,?)
      ON CONFLICT (athlete_id, block_key, week_no) DO UPDATE SET start_date=excluded.start_date, end_date=excluded.end_date`,
      )
      .run(athleteId, m.blockKey, m.weekNo, m.startDate, m.endDate);
  }
  listMicros(athleteId: string): MicroMeta[] {
    return (
      this.db
        .prepare('SELECT * FROM microcycles WHERE athlete_id = ? ORDER BY block_key, week_no')
        .all(athleteId) as { block_key: string; week_no: number; start_date: string; end_date: string }[]
    ).map((r) => ({
      blockKey: r.block_key,
      weekNo: r.week_no,
      startDate: r.start_date,
      endDate: r.end_date,
    }));
  }

  saveTemplate(athleteId: string, t: PlanTemplate, nowIso: string): string {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO plan_templates (id, athlete_id, name, payload, created_at) VALUES (?,?,?,?,?)')
      .run(id, athleteId, t.name, JSON.stringify(t), nowIso);
    return id;
  }
  getTemplate(athleteId: string, id: string): PlanTemplate | null {
    const r = this.db
      .prepare('SELECT payload FROM plan_templates WHERE athlete_id = ? AND id = ?')
      .get(athleteId, id) as { payload: string } | undefined;
    return r ? (JSON.parse(r.payload) as PlanTemplate) : null;
  }
  listTemplates(athleteId: string): { id: string; name: string; createdAt: string }[] {
    return (
      this.db
        .prepare(
          'SELECT id, name, created_at FROM plan_templates WHERE athlete_id = ? ORDER BY created_at DESC',
        )
        .all(athleteId) as { id: string; name: string; created_at: string }[]
    ).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  }

  link(athleteId: string, from: string, to: string, on: string, note: string): void {
    this.db
      .prepare(
        `INSERT INTO exposure_links (athlete_id, from_exposure_id, to_exposure_id, linked_on, note) VALUES (?,?,?,?,?)
      ON CONFLICT (athlete_id, from_exposure_id) DO UPDATE SET to_exposure_id=excluded.to_exposure_id, linked_on=excluded.linked_on, note=excluded.note`,
      )
      .run(athleteId, from, to, on, note);
  }
  unlink(athleteId: string, from: string): boolean {
    return (
      Number(
        this.db
          .prepare('DELETE FROM exposure_links WHERE athlete_id = ? AND from_exposure_id = ?')
          .run(athleteId, from).changes,
      ) > 0
    );
  }
  links(athleteId: string): { from: string; to: string; linkedOn: string; note: string }[] {
    return (
      this.db
        .prepare('SELECT * FROM exposure_links WHERE athlete_id = ? ORDER BY from_exposure_id')
        .all(athleteId) as {
        from_exposure_id: string;
        to_exposure_id: string;
        linked_on: string;
        note: string;
      }[]
    ).map((r) => ({ from: r.from_exposure_id, to: r.to_exposure_id, linkedOn: r.linked_on, note: r.note }));
  }
}
