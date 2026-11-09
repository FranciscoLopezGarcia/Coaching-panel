import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';

describe('DB · migraciones', () => {
  it('se aplican una sola vez y crean el esquema completo', () => {
    const db = openDb(':memory:');
    expect(runMigrations(db)).toEqual([]); // ya aplicadas por openDb
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((t) => t.name);
    for (const t of [
      'athletes',
      'planned_sets',
      'actual_sets',
      'checkins',
      'evaluations',
      'decisions',
      'plan_versions',
      'change_events',
      'session_feedback',
      'coach_reviews',
      'competitions',
      'exposure_links',
      'observed_sets',
      'import_batches',
      'strength_references',
      'interventions',
      'macros',
      'mesos',
      'microcycles',
      'plan_templates',
      'schema_migrations',
    ]) {
      expect(tables).toContain(t);
    }
    const applied = (
      db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as { name: string }[]
    ).map((r) => r.name);
    expect(applied).toEqual([
      '001_init.sql',
      '002_stages_2_4.sql',
      '003_consolidacion.sql',
      '004_handoff.sql',
      '005_portal_atleta.sql',
      '006_notas_atleta.sql',
    ]);
  });
  it('las restricciones impiden RPE/molestia fuera de rango y ejecución sin prescripción', () => {
    const db = openDb(':memory:');
    db.prepare(
      "INSERT INTO athletes (id,name,competition_exercises,created_at) VALUES ('a','n','{}','x')",
    ).run();
    db.prepare(
      "INSERT INTO planned_sets (id,athlete_id,session_key,slot_key,exercise_name,planned_date,set_no,reps) VALUES ('p','a','s','l','e','2026-01-01',1,5)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO actual_sets (athlete_id,planned_set_id,status,rpe,updated_at) VALUES ('a','p','done',11,'x')",
        )
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          "INSERT INTO actual_sets (athlete_id,planned_set_id,status,updated_at) VALUES ('a','no-existe','done','x')",
        )
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare("INSERT INTO session_feedback (athlete_id,session_key,end_fatigue) VALUES ('a','s',11)")
        .run(),
    ).toThrow();
  });
  it('una referencia 1RM no positiva es inválida', () => {
    const db = openDb(':memory:');
    db.prepare(
      "INSERT INTO athletes (id,name,competition_exercises,created_at) VALUES ('a','n','{}','x')",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO planned_sets (id,athlete_id,session_key,slot_key,exercise_name,planned_date,set_no,reps,ref_kg) VALUES ('p','a','s','l','e','2026-01-01',1,5,0)",
        )
        .run(),
    ).toThrow();
  });
});
