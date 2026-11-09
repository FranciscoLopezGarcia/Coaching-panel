-- Etapas 2–4: bloques/semanas/familias, referencia fechada, versiones del plan, eventos de cambio, feedback de sesión,
-- revisiones técnicas del coach y competencias. Prescripción y ejecución siguen separadas.
ALTER TABLE planned_sets ADD COLUMN block_key TEXT NOT NULL DEFAULT 'B1';
ALTER TABLE planned_sets ADD COLUMN week_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE planned_sets ADD COLUMN day_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE planned_sets ADD COLUMN family_key TEXT NOT NULL DEFAULT 'F1';
ALTER TABLE planned_sets ADD COLUMN ref_kg REAL CHECK (ref_kg IS NULL OR ref_kg > 0);
-- Series que dejaron de estar en el plan pero tienen ejecución: se conservan como historial.
ALTER TABLE planned_sets ADD COLUMN retired INTEGER NOT NULL DEFAULT 0;

CREATE TABLE plan_versions (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('aplicado','borrador')),
  detected_on TEXT NOT NULL,
  effective_on TEXT,
  label TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL,
  content TEXT NOT NULL,
  UNIQUE (athlete_id, seq)
);

CREATE TABLE change_events (
  id TEXT NOT NULL,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  version_a TEXT NOT NULL,
  version_b TEXT NOT NULL,
  status TEXT NOT NULL,
  detected_on TEXT NOT NULL,
  effective_on TEXT,
  payload TEXT NOT NULL,
  coach_comment TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (athlete_id, id),
  UNIQUE (athlete_id, version_a, version_b)
);

CREATE TABLE session_feedback (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  end_fatigue REAL CHECK (end_fatigue IS NULL OR (end_fatigue >= 1 AND end_fatigue <= 10)),
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (athlete_id, session_key)
);

CREATE TABLE coach_reviews (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  lift TEXT NOT NULL CHECK (lift IN ('SQ','BP','DL')),
  date TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('valida','no_comparable','observacion')),
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (athlete_id, lift, date)
);

CREATE TABLE competitions (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT ''
);
