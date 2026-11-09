-- Login del coach (la API pasa a ser pública en la nube) y revisión por atleta para la sincronización en vivo sin memoria compartida.
CREATE TABLE coaches (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE coach_tokens (
  token_hash TEXT PRIMARY KEY,
  coach_id TEXT NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_coach_tokens_coach ON coach_tokens (coach_id);
-- Sube con cada escritura que afecta al atleta; los clientes comparan este número para saber si deben recargar.
CREATE TABLE athlete_rev (
  athlete_id TEXT PRIMARY KEY,
  rev INTEGER NOT NULL
);
