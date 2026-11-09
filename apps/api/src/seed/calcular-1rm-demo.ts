import { existsSync, readFileSync } from 'node:fs';
import { openDb } from '../db/connection.js';
import { pctFromTable } from '@coaching/engine';

/**
 * Referencias de fuerza (1RM) por ejercicio y variante para la demo de los 5 atletas.
 * Orden de prioridad por ejercicio:
 *   1) marcas/1RM reales que informó el coach (los tres movimientos de competencia ya están cargados: no se tocan);
 *   2) 1RM estimado que el coach escribió en su planilla Excel para ese mismo ejercicio (si coincide el nombre);
 *   3) e1RM calculado con la curva RTS (kg ÷ %1RM de reps y RPE) de las mejores series ejecutadas, o del plan si aún no hay ejecución.
 * Cada referencia queda con su origen y la nota de cómo se obtuvo. Repetible: no duplica lo ya cargado.
 *   tsx src/seed/calcular-1rm-demo.ts [rm-excel.json] [--today AAAA-MM-DD]
 */
const BASE = process.env.API_BASE ?? 'http://localhost:3200/api';
const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '';
const excel: Record<string, Record<string, number>> = file && existsSync(file)
  ? JSON.parse(readFileSync(file, 'utf8'))
  : {};
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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
interface SetRow {
  lift?: string | null;
  exerciseName: string;
  isWarmup: boolean;
  planned: { reps: number; targetRpe: number | null; kg: number | null };
  actual: { status: string; kg: number | null; reps: number | null; rpe: number | null } | null;
  plannedDate?: string;
}
interface Sess {
  date: string;
  sets: SetRow[];
}
const COMP = new Set(['squat comp', 'bench comp', 'deadlift comp']);
const e1 = (kg: number, reps: number, rpe: number) => {
  const p = pctFromTable(reps, rpe, 'amplio');
  return p ? kg / p : null;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
};
const athletes = (await api('GET', '/athletes')) as { id: string; name: string }[];
for (const a of athletes) {
  const sessions = (await api('GET', `/athletes/${a.id}/sessions`)) as Sess[];
  const first = sessions.map((s) => s.date).sort()[0] as string;
  const known = (await api('GET', `/athletes/${a.id}/references`)) as {
    exerciseName: string;
    kg: number;
    source: string;
  }[];
  const byName = new Map<string, { actual: number[]; plan: number[]; sets: number }>();
  for (const s of sessions)
    for (const x of s.sets) {
      if (x.isWarmup || !x.lift) continue; // los accesorios no tienen 1RM
      const e = byName.get(x.exerciseName) ?? { actual: [], plan: [], sets: 0 };
      if (x.actual?.status === 'done' && x.actual.kg && x.actual.reps && x.actual.rpe) {
        const v = e1(x.actual.kg, x.actual.reps, x.actual.rpe);
        if (v) e.actual.push(v);
      }
      if (x.planned.kg && x.planned.targetRpe) {
        const v = e1(x.planned.kg, x.planned.reps, x.planned.targetRpe);
        if (v) e.plan.push(v);
      }
      e.sets++;
      byName.set(x.exerciseName, e);
    }
  // se recalculan las referencias estimadas por curva (las del coach no se tocan)
  if (process.env.DB_PATH) {
    const d = await openDb(process.env.DB_PATH);
    await d.run("DELETE FROM strength_references WHERE athlete_id = ? AND source = 'estimada_curva'", a.id);
    await d.close();
    known.splice(0, known.length, ...known.filter((r) => r.source !== 'estimada_curva'));
  }
  const real = excel[a.name] ?? {};
  const realBySlug = new Map(Object.entries(real).map(([k, v]) => [slug(k), v]));
  let added = 0;
  const lines: string[] = [];
  for (const [name, e] of [...byName.entries()].sort((x, y) => y[1].sets - x[1].sets)) {
    if (COMP.has(name.toLowerCase())) continue;
    let kg: number | null = null;
    let source: 'decision_del_coach' | 'estimada_curva' = 'estimada_curva';
    let note = '';
    const fromSheet = realBySlug.get(slug(name));
    if (fromSheet) {
      kg = fromSheet;
      source = 'decision_del_coach';
      note = '1RM estimado por el coach en su planilla (mismo ejercicio)';
    } else {
      const pool = e.actual.length >= 3 ? e.actual : e.plan;
      if (pool.length < 2) continue;
      const top = [...pool].sort((x, y) => y - x).slice(0, Math.min(3, pool.length));
      kg = Math.round(median(top) * 2) / 2;
      note = `e1RM por curva RTS (mediana de las ${top.length} mejores series ${e.actual.length >= 3 ? 'ejecutadas' : 'del plan'}) · aproximado`;
    }
    if (!(kg > 0 && kg <= 1000)) {
      console.log(`   (omitido ${name}: ${Math.round(kg)} kg no es plausible)`);
      continue;
    }
    if (known.some((k) => k.exerciseName === name && Math.abs(k.kg - (kg as number)) < 0.01)) continue;
    await api('POST', `/athletes/${a.id}/references`, { exerciseName: name, kg, source, asOf: first, note });
    added++;
    if (lines.length < 40)
      lines.push(`${name}: ${kg} kg (${source === 'estimada_curva' ? 'calculado' : 'planilla del coach'})`);
  }
  console.log(`${a.name}: ${added} referencias nuevas`);
  for (const l of lines.filter((l) => /safety|ssb|safe/i.test(l))) console.log('   · ' + l);
}
