-- Nota del atleta debajo de cada ejercicio de cada entreno (la lee el coach).
CREATE TABLE athlete_exercise_notes (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (athlete_id, session_key, exercise_name)
);
