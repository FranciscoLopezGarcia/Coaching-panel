-- Esquema inicial. Prescripción y ejecución separadas. Ausencia = NULL (nunca 0).
CREATE TABLE athletes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  competition_exercises TEXT NOT NULL,        -- JSON {SQ,BP,DL}
  params TEXT NOT NULL DEFAULT '{}',           -- JSON: cambio mínimo, paso, límites (PROPUESTA, editable por el coach)
  created_at TEXT NOT NULL
);

CREATE TABLE planned_sets (
  id TEXT NOT NULL,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  slot_key TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  lift TEXT CHECK (lift IN ('SQ','BP','DL')),
  planned_date TEXT NOT NULL,
  set_no INTEGER NOT NULL,
  reps INTEGER NOT NULL CHECK (reps > 0),
  target_rpe REAL CHECK (target_rpe IS NULL OR (target_rpe >= 1 AND target_rpe <= 10)),
  planned_kg REAL CHECK (planned_kg IS NULL OR planned_kg > 0),
  is_warmup INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (athlete_id, id)
);
CREATE INDEX idx_planned_athlete_date ON planned_sets (athlete_id, planned_date);

CREATE TABLE actual_sets (
  athlete_id TEXT NOT NULL,
  planned_set_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done','skipped','pending')),
  kg REAL CHECK (kg IS NULL OR kg > 0),
  reps INTEGER CHECK (reps IS NULL OR reps > 0),
  rpe REAL CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  performed_on TEXT,
  pain REAL CHECK (pain IS NULL OR (pain >= 0 AND pain <= 10)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (athlete_id, planned_set_id),
  FOREIGN KEY (athlete_id, planned_set_id) REFERENCES planned_sets (athlete_id, id) ON DELETE CASCADE
);

CREATE TABLE checkins (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  sleep REAL, energy REAL, motivation REAL, stress REAL, pain REAL,
  PRIMARY KEY (athlete_id, date)
);

-- Última evaluación por (atleta, corte): idempotente (se reemplaza).
CREATE TABLE evaluations (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  cutoff TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (athlete_id, cutoff, rules_version)
);

-- Propuestas del motor + decisión del coach. Nunca se borran: las que dejan de aplicar pasan a "expirada".
CREATE TABLE decisions (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  lift TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  validity TEXT NOT NULL CHECK (validity IN ('vigente','expirada')),
  coach_decision TEXT NOT NULL,
  evaluated_on TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (athlete_id, key)
);
CREATE INDEX idx_decisions_validity ON decisions (athlete_id, validity);
