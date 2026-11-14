import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig · qué base se usa', () => {
  const turso = { TURSO_DATABASE_URL: 'libsql://prod.example', TURSO_AUTH_TOKEN: 'x' };
  it('DB_PATH explícito gana sobre TURSO_* (no tocar producción por el .env local)', () => {
    expect(loadConfig({ ...turso, DB_PATH: './data/otra.sqlite' }).dbPath).toBe('./data/otra.sqlite');
  });
  it('COACHING_DB_URL (Vercel) tiene prioridad sobre todo', () => {
    expect(
      loadConfig({ ...turso, DB_PATH: './x.sqlite', COACHING_DB_URL: 'libsql://vercel.example' }).dbPath,
    ).toBe('libsql://vercel.example');
  });
  it('sin DB_PATH usa TURSO_* y sin nada el archivo por defecto', () => {
    expect(loadConfig(turso).dbPath).toBe('libsql://prod.example');
    expect(loadConfig({}).dbPath).toBe('./data/coaching.sqlite');
  });
});
