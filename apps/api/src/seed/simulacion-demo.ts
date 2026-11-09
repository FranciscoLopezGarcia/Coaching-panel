import { readFileSync } from 'node:fs';
import { liftOfName } from './lifts.js';
import { parseCanonicalPlan, patternFor, pctFromTable, type PlannedSet } from '@coaching/engine';

/**
 * SIMULACIÓN DE DEMOSTRACIÓN. Completa el plan con los 1RM que informó el coach y genera una ejecución SIMULADA
 * (como si el atleta hubiera llenado todo hasta hoy). NADA de esto es lo que el atleta levantó: es dato inventado
 * por reglas simples y con semilla fija, para ver el sistema «lleno». Todo queda rotulado «SIMULADO» en el historial de ediciones.
 *
 *   tsx src/seed/simulacion-demo.ts <carpeta-con-csv> [--today 2026-11-09]
 * Usa la API que esté corriendo (API_BASE, por defecto http://localhost:3200/api). Es repetible: vuelve a escribir lo mismo.
 */
const BASE = process.env.API_BASE ?? 'http://localhost:3200/api';
const dir = process.argv[2];
const todayArg = process.argv.indexOf('--today');
const TODAY = todayArg > 0 ? (process.argv[todayArg + 1] as string) : new Date().toISOString().slice(0, 10);
if (!dir) {
  console.error('Uso: simulacion-demo.ts <carpeta con los CSV> [--today AAAA-MM-DD]');
  process.exit(2);
}
/** 1RM informados por el coach (SQ-BP-DL). */
const ONE_RM: Record<string, { file: string; SQ: number; BP: number; DL: number }> = {
  'Juli Sosa': { file: 'juli-sosa', SQ: 210, BP: 125, DL: 235 },
  'Estefi Quiroga': { file: 'estefi-quiroga', SQ: 155, BP: 90, DL: 175.5 },
  'Dylan Garcia': { file: 'dylan-garcia', SQ: 210, BP: 115, DL: 220 },
  'Marian Saez': { file: 'marian-saez', SQ: 225, BP: 135, DL: 245 },
  Lueto: { file: 'lueto', SQ: 140, BP: 100, DL: 180 },
};
const SIM =
  'SIMULADO (demostración): ejecución generada por reglas a partir de los 1RM informados por el coach; no es lo que levantó el atleta';

const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = (await r.json()) as unknown;
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(t).slice(0, 600)}`);
  return t;
};

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Qué fracción del 1RM del movimiento principal se usa como referencia de un ejercicio (supuesto de la demo). */
function reference(
  name: string,
  lift: 'SQ' | 'BP' | 'DL' | null,
  rm: { SQ: number; BP: number; DL: number },
): number {
  const n = name.toLowerCase();
  const mnc = /mnc|mancuerna|dumbbell/.test(n);
  if (lift) {
    if (/comp\b|comp$/.test(n) && !/band|banda|tempo|paus|bloque|bloq|board|deficit|dinamic/.test(n))
      return rm[lift];
    if (/band|banda|\bvs\b/.test(n)) return rm[lift] * 0.65;
    if (/bloque|bloq|deficit|dinamic/.test(n)) return rm[lift] * 0.75;
    if (/paus|tempo|3ct|board|spoto|tyg|safety|box|\d{3}/.test(n)) return rm[lift] * 0.85;
    return rm[lift] * 0.9;
  }
  const p = patternFor(n.replace(/[^a-z0-9]+/g, '-'), name);
  const f = (x: number) => (mnc ? x * 0.4 : x);
  switch (p) {
    case 'sentadilla':
      return rm.SQ * 0.55;
    case 'bisagra_cadera':
      return rm.DL * 0.55;
    case 'unilateral_pierna':
      return rm.SQ * (mnc ? 0.12 : 0.3);
    case 'aislamiento_pierna':
      return rm.SQ * 0.3;
    case 'empuje_horizontal':
      return f(rm.BP * 0.6);
    case 'empuje_vertical':
      return f(rm.BP * 0.45);
    case 'traccion_horizontal':
      return f(rm.BP * 0.55);
    case 'traccion_vertical':
      return rm.BP * 0.5;
    case 'aislamiento_brazos':
    case 'aislamiento_hombro_espalda':
      return f(rm.BP * 0.3);
    case 'core':
      return rm.SQ * 0.15;
    case 'transporte_olimpico':
      return rm.DL * 0.4;
    default:
      return rm.BP * 0.35;
  }
}

function rpeFromPct(reps: number, pct: number): number {
  let best = 8;
  let bd = Infinity;
  for (let r = 4; r <= 10; r += 0.5) {
    const p = pctFromTable(reps, r, 'amplio');
    if (p === null) continue;
    const d = Math.abs(p - pct);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best;
}
const floorToStep = (x: number, step: number) => Math.floor(x / step + 1e-9) * step;
const half = (x: number) => Math.round(x * 2) / 2;

const athletes = (await api('GET', '/athletes')) as { id: string; name: string }[];
for (const [name, cfg] of Object.entries(ONE_RM)) {
  const a = athletes.find((x) => x.name === name);
  if (!a) {
    console.warn(`No existe ${name}`);
    continue;
  }
  const parsed = parseCanonicalPlan(readFileSync(`${dir}/${cfg.file}.csv`, 'utf8'), { stepKg: 2.5 });
  if (!parsed.ok) throw new Error(`${name}: el CSV tiene errores`);
  const first = parsed.sets.map((s) => s.plannedDate).sort()[0] as string;

  // 1) referencias de fuerza (decisión del coach), vigentes desde el primer día del plan
  const comp = { SQ: 'Squat comp', BP: 'Bench comp', DL: 'Deadlift comp' } as const;
  for (const l of ['SQ', 'BP', 'DL'] as const)
    await api('POST', `/athletes/${a.id}/references`, {
      exerciseName: comp[l],
      kg: cfg[l],
      source: 'decision_del_coach',
      asOf: first,
      note: '1RM informado por el coach (2026-11-09)',
    });

  // 2) plan completado: kg desde RPE y RPE desde kg, siempre con la referencia declarada
  const completed: PlannedSet[] = parsed.sets.map((s0) => {
    const s: PlannedSet = { ...s0, lift: liftOfName(s0.exerciseName) };
    const ref = reference(s.exerciseName, s.lift, cfg);
    const out: PlannedSet = { ...s, refKg: Math.round(ref * 2) / 2 };
    if (out.targetRpe === null && out.plannedKg !== null) {
      out.targetRpe = rpeFromPct(out.reps, out.plannedKg / ref);
    } else if (out.targetRpe === null && out.plannedKg === null) {
      out.targetRpe = 8;
    }
    if (out.plannedKg === null && out.targetRpe !== null) {
      const pct = pctFromTable(out.reps, out.targetRpe, 'amplio');
      if (pct !== null) {
        out.plannedKg = Math.max(2.5, floorToStep(ref * pct, 2.5));
        out.plannedKgSource = 'derived';
      }
    }
    return out;
  });
  const plan = (await api('POST', `/athletes/${a.id}/plan`, {
    sets: completed,
    status: 'aplicado',
    replace: true,
    label: 'Plan completado con 1RM del coach (kg↔RPE derivados)',
  })) as { changed: boolean };

  // 3) ejecución SIMULADA hasta hoy
  const rand = rng(name);
  const done = completed.filter((s) => s.plannedDate <= TODAY);
  const byEx = new Map<string, PlannedSet[]>();
  for (const s of done) {
    const k = `${s.sessionKey}|${s.exposureId}`;
    (byEx.get(k) ?? byEx.set(k, []).get(k)!).push(s);
  }
  const actuals: {
    plannedSetId: string;
    status: 'done' | 'skipped';
    kg: number | null;
    reps: number | null;
    rpe: number | null;
    performedOn: string | null;
    pain: number | null;
  }[] = [];
  const sessionRpe = new Map<string, number[]>();
  const sessionDate = new Map<string, string>();
  for (const sets of byEx.values()) {
    sets.sort((x, y) => x.setNo - y.setNo);
    sets.forEach((s, i) => {
      if (rand() < 0.02) {
        actuals.push({
          plannedSetId: s.id,
          status: 'skipped',
          kg: null,
          reps: null,
          rpe: null,
          performedOn: s.plannedDate,
          pain: null,
        });
        return;
      }
      const max = s.protocol?.repsMax ?? s.reps;
      let reps = s.reps;
      if (max > s.reps) {
        const fatigue = Math.floor(i / 2) + (rand() < 0.3 ? 1 : 0);
        reps = Math.max(s.reps - 1, max - Math.floor(rand() * 2) - fatigue);
      } else if (i >= 3 && rand() < 0.25) reps = Math.max(1, s.reps - 1);
      let kg = s.plannedKg;
      if (kg !== null && rand() < 0.1) kg += 2.5;
      const target = s.targetRpe ?? 8;
      const rpe = Math.min(
        10,
        Math.max(5, half(target + i * 0.25 + (rand() - 0.4) * 1.2 + (reps < s.reps ? 0.5 : 0))),
      );
      actuals.push({
        plannedSetId: s.id,
        status: 'done',
        kg,
        reps,
        rpe,
        performedOn: s.plannedDate,
        pain: rand() < 0.04 ? 2 : 0,
      });
      (sessionRpe.get(s.sessionKey) ?? sessionRpe.set(s.sessionKey, []).get(s.sessionKey)!).push(rpe);
      sessionDate.set(s.sessionKey, s.plannedDate);
    });
  }
  for (let i = 0; i < actuals.length; i += 1000)
    await api('POST', `/athletes/${a.id}/sets`, { sets: actuals.slice(i, i + 1000), reason: SIM });

  // 4) fatiga de fin de sesión y check-ins diarios, también simulados
  for (const [key, rs] of sessionRpe) {
    const m = rs.reduce((x, y) => x + y, 0) / rs.length;
    await api('POST', `/athletes/${a.id}/session-feedback`, {
      sessionKey: key,
      endFatigue: Math.min(10, Math.max(1, Math.round(m - 1.5 + (rand() - 0.5) * 2))),
      note: 'SIMULADO',
    });
  }
  const days = [...new Set(sessionDate.values())].sort();
  for (const d of days) {
    const v = () => Math.min(10, Math.max(3, Math.round(7 + (rand() - 0.5) * 4)));
    await api('POST', `/athletes/${a.id}/checkins`, {
      date: d,
      sleep: v(),
      energy: v(),
      motivation: v(),
      stress: v(),
      pain: 1,
    });
  }
  console.log(
    `${name}: plan ${plan.changed ? 'actualizado' : 'sin cambios'} · ${completed.length} series previstas · ${actuals.length} ejecutadas simuladas hasta ${TODAY} · ${sessionRpe.size} sesiones · ${days.length} check-ins`,
  );
}
