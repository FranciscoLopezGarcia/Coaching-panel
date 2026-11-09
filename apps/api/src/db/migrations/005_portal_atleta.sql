-- Portal del atleta: cuenta (email + contraseña con hash), sesiones de acceso y qué ve el atleta de cada entreno.
CREATE TABLE athlete_accounts (
  athlete_id TEXT PRIMARY KEY REFERENCES athletes(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE athlete_tokens (
  token_hash TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_athlete_tokens_athlete ON athlete_tokens (athlete_id);
-- session_key '*' = valor por defecto del atleta; cualquier otra clave = ajuste de esa sesión.
CREATE TABLE athlete_view_settings (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('completo','solo_rpe','solo_carga','rpe_porcentaje')),
  PRIMARY KEY (athlete_id, session_key)
);
