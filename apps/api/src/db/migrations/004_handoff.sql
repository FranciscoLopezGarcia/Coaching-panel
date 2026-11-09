-- Trazabilidad de ediciones de registros y mapeo de ejercicios de Hevy revisable/persistente.
CREATE TABLE record_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  entity TEXT NOT NULL CHECK (entity IN ('actual_set','checkin','session_feedback')),
  entity_key TEXT NOT NULL,
  at TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update')),
  before_json TEXT,
  after_json TEXT NOT NULL,
  reason TEXT
);
CREATE INDEX idx_revisions_entity ON record_revisions (athlete_id, entity, entity_key, id);

CREATE TABLE hevy_exercise_map (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  lift TEXT CHECK (lift IN ('SQ','BP','DL')),
  variant_key TEXT,
  load_kind TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (athlete_id, title)
);
