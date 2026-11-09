-- Consolidación del motor: identidad de exposición, protocolos, observaciones (Hevy), referencias de fuerza fechadas,
-- intervenciones, macros/mesos/microciclos, plantillas, importaciones y vínculos explícitos de identidad.
-- COMPATIBILIDAD: los registros existentes se conservan. Cada slot antiguo ("ejercicio|Dn") se migra como su PROPIA identidad
-- (identity_source = 'legacy_slot'); NO se fusionan slots por inferencia. Fusionar dos identidades requiere un vínculo explícito (exposure_links).

ALTER TABLE planned_sets ADD COLUMN exposure_id TEXT NOT NULL DEFAULT '';
ALTER TABLE planned_sets ADD COLUMN exposure_role TEXT CHECK (exposure_role IS NULL OR exposure_role IN ('primaria','secundaria','accesorio'));
ALTER TABLE planned_sets ADD COLUMN priority INTEGER CHECK (priority IS NULL OR (priority >= 1 AND priority <= 5));
ALTER TABLE planned_sets ADD COLUMN variant_key TEXT NOT NULL DEFAULT '';
ALTER TABLE planned_sets ADD COLUMN copied_from TEXT;
ALTER TABLE planned_sets ADD COLUMN planned_kg_source TEXT CHECK (planned_kg_source IS NULL OR planned_kg_source IN ('fixed','derived'));
ALTER TABLE planned_sets ADD COLUMN protocol TEXT;
ALTER TABLE planned_sets ADD COLUMN identity_source TEXT NOT NULL DEFAULT 'declarada' CHECK (identity_source IN ('declarada','legacy_slot','derivada_del_nombre'));

UPDATE planned_sets SET
  exposure_id = slot_key,
  variant_key = exercise_name,
  planned_kg_source = CASE WHEN planned_kg IS NOT NULL THEN 'fixed' END,
  identity_source = 'legacy_slot';

-- Vínculo EXPLÍCITO entre identidades (p. ej. el coach confirma que "banca|D1" y "banca|D3" eran la misma exposición movida de día).
CREATE TABLE exposure_links (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  from_exposure_id TEXT NOT NULL,
  to_exposure_id TEXT NOT NULL,
  linked_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (athlete_id, from_exposure_id),
  CHECK (from_exposure_id <> to_exposure_id)
);

-- Lo que el atleta HIZO sin prescripción vinculada (p. ej. Hevy). La prescripción nunca se deduce de lo ejecutado.
CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('observaciones','plan')),
  parser_version TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  token TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE observed_sets (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  source TEXT NOT NULL,
  batch_id TEXT REFERENCES import_batches(id),
  external_key TEXT NOT NULL,
  session_key TEXT NOT NULL,
  date TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  lift TEXT CHECK (lift IS NULL OR lift IN ('SQ','BP','DL')),
  variant_key TEXT NOT NULL,
  set_type TEXT NOT NULL CHECK (set_type IN ('work','warmup','failure','dropset')),
  kg REAL CHECK (kg IS NULL OR kg >= 0),
  reps INTEGER CHECK (reps IS NULL OR reps > 0),
  rpe REAL CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  load_kind TEXT NOT NULL,
  PRIMARY KEY (athlete_id, id),
  UNIQUE (athlete_id, source, external_key)
);
CREATE INDEX idx_observed_date ON observed_sets (athlete_id, date);

-- Referencia de fuerza: entidad aparte de las estimaciones de e1RM, con fuente, fecha, ejercicio y versión.
CREATE TABLE strength_references (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  kg REAL NOT NULL CHECK (kg > 0),
  source TEXT NOT NULL CHECK (source IN ('test','competencia','estimada_curva','estimada_formula','decision_del_coach')),
  as_of TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'v1',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_refs_lookup ON strength_references (athlete_id, exercise_name, as_of);

-- Hallazgo → propuesta → decisión → intervención → seguimiento. El historial y las fechas viven en el payload.
CREATE TABLE interventions (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  proposal_key TEXT,
  lift TEXT,
  state TEXT NOT NULL CHECK (state IN ('detectada','revisada','aceptada','descartada','aplicada','seguimiento','cerrada')),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_interventions_proposal ON interventions (athlete_id, proposal_key) WHERE proposal_key IS NOT NULL;

-- Macro → meso → microciclo con fechas explícitas y duración variable. Los sets siguen identificándose por block_key/week_no.
CREATE TABLE macros (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  objective TEXT,
  status TEXT NOT NULL CHECK (status IN ('activo','cerrado','planificado'))
);
CREATE TABLE mesos (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  block_key TEXT NOT NULL,
  macro_id TEXT REFERENCES macros(id),
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  objective TEXT,
  PRIMARY KEY (athlete_id, block_key)
);
CREATE TABLE microcycles (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  block_key TEXT NOT NULL,
  week_no INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  PRIMARY KEY (athlete_id, block_key, week_no)
);
CREATE TABLE plan_templates (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
