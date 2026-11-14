import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';

describe('DB · migraciones', () => {
  it('se aplican una sola vez y crean el esquema completo', async () => {
    const db = await openDb(':memory:');
    expect(await runMigrations(db)).toEqual([]); // ya aplicadas por openDb
    const tables = (
      (await db.all("SELECT name FROM sqlite_master WHERE type='table'")) as { name: string }[]
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
      (await db.all('SELECT name FROM schema_migrations ORDER BY name')) as { name: string }[]
    ).map((r) => r.name);
    expect(applied).toEqual([
      '001_init.sql',
      '002_stages_2_4.sql',
      '003_consolidacion.sql',
      '004_handoff.sql',
      '005_portal_atleta.sql',
      '006_notas_atleta.sql',
      '007_coach_y_tiempo_real.sql',
      '008_checkin_extras.sql',
      '009_perfil_competencias_biblioteca.sql',
    ]);
  });
  it('las restricciones impiden RPE/molestia fuera de rango y ejecución sin prescripción', async () => {
    const db = await openDb(':memory:');
    await db.run("INSERT INTO athletes (id,name,competition_exercises,created_at) VALUES ('a','n','{}','x')");
    await db.run(
      "INSERT INTO planned_sets (id,athlete_id,session_key,slot_key,exercise_name,planned_date,set_no,reps) VALUES ('p','a','s','l','e','2026-01-01',1,5)",
    );
    await expect(
      db.run(
        "INSERT INTO actual_sets (athlete_id,planned_set_id,status,rpe,updated_at) VALUES ('a','p','done',11,'x')",
      ),
    ).rejects.toThrow();
    await expect(
      db.run(
        "INSERT INTO actual_sets (athlete_id,planned_set_id,status,updated_at) VALUES ('a','no-existe','done','x')",
      ),
    ).rejects.toThrow();
    await expect(
      db.run("INSERT INTO session_feedback (athlete_id,session_key,end_fatigue) VALUES ('a','s',11)"),
    ).rejects.toThrow();
  });
  it('una referencia 1RM no positiva es inválida', async () => {
    const db = await openDb(':memory:');
    await db.run("INSERT INTO athletes (id,name,competition_exercises,created_at) VALUES ('a','n','{}','x')");
    await expect(
      db.run(
        "INSERT INTO planned_sets (id,athlete_id,session_key,slot_key,exercise_name,planned_date,set_no,reps,ref_kg) VALUES ('p','a','s','l','e','2026-01-01',1,5,0)",
      ),
    ).rejects.toThrow();
  });
});

describe('DB · migraciones embebidas', () => {
  it('el módulo generado para Vercel coincide con los .sql del disco (si falla: node apps/api/scripts/embed-migrations.mjs)', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { EMBEDDED_MIGRATIONS } = await import('../src/db/migrations.generated.js');
    const dir = new URL('../src/db/migrations/', import.meta.url).pathname;
    const disk = readdirSync(dir)
      .filter((f) => /^\d+_.+\.sql$/.test(f))
      .sort()
      .map((f) => ({ name: f, sql: readFileSync(dir + f, 'utf8') }));
    expect(EMBEDDED_MIGRATIONS).toEqual(disk);
  });
});
