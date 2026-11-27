-- Cierre de bloque del atleta: cómo le fue (general y por movimiento) y notas. Solo cambios ADITIVOS.
-- Las respuestas van en JSON validado por la API; lo que no se contesta queda en null (nunca 0).
CREATE TABLE block_feedback (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  block_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (athlete_id, block_key)
);
