-- Perfil ampliado del atleta, competencias detalladas con intentos y biblioteca de ejercicios propios.
-- Solo cambios ADITIVOS: tablas nuevas y columnas nuevas con valor por defecto. Ausencia = NULL (nunca 0).
CREATE TABLE athlete_profile (
  athlete_id TEXT PRIMARY KEY REFERENCES athletes(id) ON DELETE CASCADE,
  birth_date TEXT,
  sex TEXT CHECK (sex IS NULL OR sex IN ('M','F','X')),
  bodyweight_kg REAL CHECK (bodyweight_kg IS NULL OR (bodyweight_kg >= 20 AND bodyweight_kg <= 400)),
  weight_class TEXT NOT NULL DEFAULT '',
  federation TEXT NOT NULL DEFAULT '',
  equipment TEXT CHECK (equipment IS NULL OR equipment IN ('raw','equipado','ambos')),
  training_since TEXT,
  days_per_week INTEGER CHECK (days_per_week IS NULL OR (days_per_week >= 1 AND days_per_week <= 7)),
  goals TEXT NOT NULL DEFAULT '',
  history_notes TEXT NOT NULL DEFAULT '',
  constraints_notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

ALTER TABLE competitions ADD COLUMN location TEXT NOT NULL DEFAULT '';
ALTER TABLE competitions ADD COLUMN weight_class TEXT NOT NULL DEFAULT '';
ALTER TABLE competitions ADD COLUMN bodyweight_kg REAL;
ALTER TABLE competitions ADD COLUMN importance TEXT NOT NULL DEFAULT '';
ALTER TABLE competitions ADD COLUMN notes TEXT NOT NULL DEFAULT '';

-- Intentos de competencia: lo previsto (apertura planificada) y lo realizado van en columnas separadas, nunca se completan entre sí.
CREATE TABLE competition_attempts (
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  lift TEXT NOT NULL CHECK (lift IN ('SQ','BP','DL')),
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1 AND attempt_no <= 3),
  planned_kg REAL CHECK (planned_kg IS NULL OR planned_kg > 0),
  actual_kg REAL CHECK (actual_kg IS NULL OR actual_kg > 0),
  result TEXT CHECK (result IS NULL OR result IN ('valido','nulo')),
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (competition_id, lift, attempt_no)
);

-- Biblioteca propia del coach (la fija vive en el motor). Los músculos se guardan como JSON {grupo: 'directo'|'indirecto'}.
CREATE TABLE exercise_library (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  lift TEXT CHECK (lift IS NULL OR lift IN ('SQ','BP','DL')),
  pattern TEXT NOT NULL DEFAULT '',
  equipment TEXT NOT NULL DEFAULT '',
  muscles TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
