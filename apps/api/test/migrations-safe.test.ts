import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Cada deploy aplica migraciones sobre la base de producción con datos reales: solo se admiten cambios ADITIVOS
 * (CREATE TABLE/INDEX, ADD COLUMN, INSERT de catálogos). Todo lo destructivo exige un cambio de este test, o sea una decisión explícita.
 */
const dir = join(import.meta.dirname, '..', 'src', 'db', 'migrations');
const FORBIDDEN: [RegExp, string][] = [
  [/\bDROP\s+(TABLE|COLUMN|INDEX|VIEW)\b/i, 'DROP'],
  [/\bTRUNCATE\b/i, 'TRUNCATE'],
  [/\bDELETE\s+FROM\b/i, 'DELETE FROM'],
  [/\bALTER\s+TABLE\s+\S+\s+(DROP|RENAME)\b/i, 'ALTER ... DROP/RENAME'],
  [/\bUPDATE\s+\w+\s+SET\b(?![^;]*\bWHERE\b)/i, 'UPDATE sin WHERE'],
];
/** Migraciones YA aplicadas en producción con un relleno (backfill) de columnas nuevas; no se editan. Las nuevas no entran acá. */
const LEGACY_UPDATE_OK = new Set(['003_consolidacion.sql']);
const strip = (sql: string) => sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('migraciones seguras para producción', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  it('existen migraciones', () => expect(files.length).toBeGreaterThan(0));
  for (const f of files)
    it(`${f} es aditiva`, () => {
      const sql = strip(readFileSync(join(dir, f), 'utf8'));
      for (const [re, name] of FORBIDDEN) {
        if (name === 'UPDATE sin WHERE' && LEGACY_UPDATE_OK.has(f)) continue;
        expect(re.test(sql), `${f} contiene ${name}`).toBe(false);
      }
    });
  it('numeración sin huecos ni repetidos (no se reescribe historia)', () => {
    const n = files.map((f) => Number(f.split('_')[0]));
    expect(n).toEqual(n.map((_, i) => i + 1));
  });
});
