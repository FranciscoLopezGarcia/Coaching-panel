-- TRAC ampliado: datos opcionales del día que NO entran en la predisposición (sueño, energía, ganas, estrés y molestias siguen igual).
-- Tabla aparte y aditiva: ausencia = NULL (nunca 0).
CREATE TABLE checkin_extras (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  soreness REAL CHECK (soreness IS NULL OR (soreness >= 1 AND soreness <= 10)),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 1 AND confidence <= 10)),
  sleep_hours REAL CHECK (sleep_hours IS NULL OR (sleep_hours >= 0 AND sleep_hours <= 24)),
  bodyweight_kg REAL CHECK (bodyweight_kg IS NULL OR (bodyweight_kg >= 20 AND bodyweight_kg <= 400)),
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (athlete_id, date)
);
