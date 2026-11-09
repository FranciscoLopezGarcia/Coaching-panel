import { createRequire } from 'node:module';

/**
 * Corrige en la demo qué ejercicios son movimientos de competición (o sus variantes) y quita los 1RM de accesorios.
 *  1) Reclasifica `lift` (SQ/BP/DL/ninguno) de cada serie del plan con reglas por nombre (más completas que las de la carga inicial:
 *     entiende abreviaturas «DL/SQ/BP», errores de tipeo como «Deadlit», «no belt»/«beltless» y variantes como «Spoto press»).
 *  2) Borra las referencias de fuerza (1RM) de los ejercicios que no son movimientos principales: un accesorio no tiene 1RM.
 * Es repetible. Usa la API (API_BASE) para el plan y la base de datos (DB_PATH) para borrar referencias.
 *   DB_PATH=<ruta.sqlite> tsx src/seed/corregir-lift-demo.ts
 */
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const BASE = process.env.API_BASE ?? 'http://localhost:3200/api';
const dbPath = process.env.DB_PATH;
if (!dbPath) {
  console.error('Indicá DB_PATH con la ruta de la base de datos a limpiar.');
  process.exit(2);
}
import { liftOfName, type Lift } from './lifts.js';
const api = async (m: string, p: string, b?: unknown) => {
  const r = await fetch(BASE + p, {
    method: m,
    headers: { 'content-type': 'application/json' },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  const t = (await r.json()) as unknown;
  if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${JSON.stringify(t).slice(0, 300)}`);
  return t;
};
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000');
const athletes = (await api('GET', '/athletes')) as { id: string; name: string }[];
for (const a of athletes) {
  const plan = (await api('GET', `/athletes/${a.id}/plan`)) as {
    sets: { exerciseName: string; lift: Lift | null }[];
  };
  const changed = new Map<string, string>();
  const sets = plan.sets.map((s) => {
    const lift = liftOfName(s.exerciseName);
    if (lift !== s.lift) changed.set(s.exerciseName, `${s.lift ?? '—'} → ${lift ?? '—'}`);
    return { ...s, lift };
  });
  if (changed.size) {
    await api('POST', `/athletes/${a.id}/plan`, {
      sets,
      status: 'aplicado',
      replace: true,
      label: 'Reclasificación de movimientos (competición y variantes) por nombre',
    });
  }
  const accessories = [...new Set(sets.filter((s) => !s.lift).map((s) => s.exerciseName))];
  let removed = 0;
  for (const name of accessories) {
    const r = db
      .prepare('DELETE FROM strength_references WHERE athlete_id = ? AND exercise_name = ?')
      .run(a.id, name);
    removed += Number(r.changes);
  }
  console.log(
    `${a.name}: ${changed.size} ejercicios reclasificados · ${removed} referencias de accesorios borradas`,
  );
  for (const [n, c] of [...changed.entries()].slice(0, 10)) console.log(`   · ${n}: ${c}`);
}
db.close();
