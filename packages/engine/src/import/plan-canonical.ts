import { csvRecords } from './csv.js';
import { resolvePlannedKg } from '../program.js';
import type { Lift, PlannedSet } from '../types.js';

/**
 * Contrato CANÓNICO de programación (plan-canonical-v1), pensado para cargar el plan del coach sin inventar el formato de ningún Excel.
 * Una fila = un ejercicio de una sesión. El protocolo es texto con una gramática ESTRICTA (la misma del Macro v4):
 *   bloques separados por "+";  S x R | S x R@RPE | S x R x KG | S x R x KG@RPE | S x R-R2 ; la coma es decimal; "5" solo = 1x5.
 * Lo que no encaja en la gramática se rechaza con el motivo: NO se interpreta texto libre como cálculo.
 * Columnas (encabezado obligatorio, orden libre):
 *   block, week, date, exercise, protocol            (obligatorias; `date` = fecha civil de la sesión: NO se infiere)
 *   day, session, exposure_id, lift, role, priority, variant, ref_kg, family, slot, notes   (opcionales)
 */
export const CANONICAL_PLAN_VERSION = 'plan-canonical-v1';

export interface ProtocolBlock {
  n: number;
  reps: number;
  repsMax: number;
  rpe: number | null;
  kg: number | null;
}

export function parseProtocolText(txt: string): { blocks: ProtocolBlock[]; error: string | null } {
  const t0 = txt.trim();
  if (!t0) return { blocks: [], error: 'protocolo vacío' };
  const parts = t0.split('+');
  const NUM = '(\\d+(?:[.,]\\d+)?)';
  const X = '\\s*[x×*]\\s*';
  const re = new RegExp(
    `^(?:(\\d+)${X})?(\\d+)(?:\\s*[-–]\\s*(\\d+))?(?:${X}${NUM}(?:\\s*kg)?)?(?:\\s*@\\s*${NUM})?$`,
  );
  const blocks: ProtocolBlock[] = [];
  let total = 0;
  for (const p of parts) {
    const t = p.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!t) return { blocks: [], error: 'hay un “+” sin bloque a un lado' };
    const m = re.exec(t);
    if (!m)
      return {
        blocks: [],
        error: `no entiendo “${p.trim()}” (formatos: 4x5@7 · 4x5x107,5 · 4x5x107,5@7 · 3x6-8 · separá bloques con +)`,
      };
    const n = m[1] ? Number(m[1]) : 1;
    const reps = Number(m[2]);
    const repsMax = m[3] ? Number(m[3]) : reps;
    const kg = m[4] ? Number(m[4].replace(',', '.')) : null;
    const rpe = m[5] ? Number(m[5].replace(',', '.')) : null;
    if (repsMax < reps) return { blocks: [], error: `rango de reps al revés en “${p.trim()}”` };
    if (n < 1 || n > 30) return { blocks: [], error: `series por bloque: 1 a 30 (“${p.trim()}”)` };
    if (reps < 1 || repsMax > 100) return { blocks: [], error: `reps: 1 a 100 (“${p.trim()}”)` };
    if (rpe !== null && !(rpe >= 1 && rpe <= 10 && (rpe * 2) % 1 === 0))
      return { blocks: [], error: `RPE 1–10 en pasos de 0,5 (“${p.trim()}”)` };
    if (kg !== null && !(kg > 0)) return { blocks: [], error: `la carga debe ser positiva (“${p.trim()}”)` };
    total += n;
    blocks.push({ n, reps, repsMax, rpe, kg });
  }
  if (total > 60) return { blocks: [], error: 'máximo 60 series por ejercicio y sesión' };
  return { blocks, error: null };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const weekday = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface PlanLineError {
  line: number;
  message: string;
}

export interface CanonicalPlanParse {
  version: string;
  ok: boolean;
  sets: PlannedSet[];
  errors: PlanLineError[];
  warnings: string[];
  summary: { rows: number; sessions: number; sets: number; blocks: string[]; weeks: number };
}

const LIFTS = new Set(['SQ', 'BP', 'DL']);

export function parseCanonicalPlan(text: string, opts: { stepKg?: number } = {}): CanonicalPlanParse {
  const out: CanonicalPlanParse = {
    version: CANONICAL_PLAN_VERSION,
    ok: false,
    sets: [],
    errors: [],
    warnings: [],
    summary: { rows: 0, sessions: 0, sets: 0, blocks: [], weeks: 0 },
  };
  const { headers, records } = csvRecords(text);
  const h = new Map(headers.map((x) => [x.toLowerCase(), x]));
  const need = ['block', 'week', 'date', 'exercise', 'protocol'].filter((x) => !h.has(x));
  if (need.length) {
    out.errors.push({ line: 1, message: `faltan columnas obligatorias: ${need.join(', ')}` });
    return out;
  }
  const get = (d: Record<string, string>, k: string) =>
    h.has(k) ? (d[h.get(k) as string] ?? '').trim() : '';
  const seen = new Set<string>();
  const sessions = new Set<string>();
  const derivedIdentity = new Set<string>();
  for (const { line, data: d } of records) {
    out.summary.rows++;
    const err = (message: string) => out.errors.push({ line, message });
    const block = get(d, 'block');
    const week = Number(get(d, 'week'));
    const date = get(d, 'date');
    const exercise = get(d, 'exercise');
    if (!block) {
      err('falta el bloque');
      continue;
    }
    if (!Number.isInteger(week) || week < 1) {
      err('la semana debe ser un entero ≥ 1');
      continue;
    }
    if (!ISO.test(date)) {
      err(`fecha inválida o ausente (“${date}”): la fecha NO se infiere, usá yyyy-mm-dd`);
      continue;
    }
    if (!exercise) {
      err('falta el ejercicio');
      continue;
    }
    const pr = parseProtocolText(get(d, 'protocol'));
    if (pr.error) {
      err(`protocolo: ${pr.error}`);
      continue;
    }
    const liftRaw = get(d, 'lift').toUpperCase();
    if (liftRaw && !LIFTS.has(liftRaw)) {
      err(`lift inválido “${liftRaw}” (SQ, BP, DL o vacío para accesorios)`);
      continue;
    }
    const day = get(d, 'day') ? Number(get(d, 'day')) : weekday(date);
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      err('day debe estar entre 1 y 7');
      continue;
    }
    const refRaw = get(d, 'ref_kg').replace(',', '.');
    const refKg = refRaw ? Number(refRaw) : null;
    if (refRaw && !(Number.isFinite(refKg) && (refKg as number) > 0)) {
      err('ref_kg debe ser positivo');
      continue;
    }
    const prRaw = get(d, 'priority');
    const priority = prRaw ? Number(prRaw) : null;
    if (prRaw && !(Number.isInteger(priority) && (priority as number) >= 1 && (priority as number) <= 5)) {
      err('priority debe ser un entero de 1 a 5');
      continue;
    }
    const roleRaw = get(d, 'role').toLowerCase();
    if (roleRaw && !['primaria', 'secundaria', 'accesorio'].includes(roleRaw)) {
      err('role debe ser primaria, secundaria o accesorio');
      continue;
    }
    const exposureId = get(d, 'exposure_id') || slug(exercise);
    if (!get(d, 'exposure_id')) derivedIdentity.add(exposureId);
    const sessionKey = get(d, 'session') || `${block}-w${week}-d${day}`;
    const dupKey = `${sessionKey}|${exposureId}`;
    if (seen.has(dupKey)) {
      err(`el ejercicio “${exposureId}” aparece dos veces en la sesión ${sessionKey}`);
      continue;
    }
    seen.add(dupKey);
    sessions.add(sessionKey);
    let k = 0;
    for (const b of pr.blocks) {
      for (let i = 0; i < b.n; i++) {
        k++;
        const hasKg = b.kg !== null;
        const base: PlannedSet = {
          id: `${sessionKey}-${exposureId}-${k}`,
          sessionKey,
          exposureId,
          exposureRole: (roleRaw || null) as PlannedSet['exposureRole'],
          priority,
          variantKey: get(d, 'variant') || slug(exercise),
          slotKey: get(d, 'slot') || `${exposureId}|D${day}`,
          copiedFrom: null,
          exerciseName: exercise,
          lift: (liftRaw || null) as Lift | null,
          plannedDate: date,
          setNo: k,
          reps: b.reps,
          targetRpe: b.rpe,
          plannedKg: hasKg ? b.kg : null,
          plannedKgSource: hasKg ? 'fixed' : null,
          protocol:
            hasKg || b.rpe !== null || b.repsMax > b.reps
              ? {
                  loadMode: hasKg ? 'kg' : b.rpe !== null ? 'rpe' : 'kg',
                  pct: null,
                  capKg: null,
                  segment: 'work',
                  tempo: null,
                  pauseSec: null,
                  repsMax: b.repsMax > b.reps ? b.repsMax : null,
                  instructions:
                    b.repsMax > b.reps
                      ? `reps ${b.reps}–${b.repsMax} (rango: el atleta anota las reps)`
                      : get(d, 'notes') || null,
                }
              : null,
          isWarmup: false,
          blockKey: block,
          weekNo: week,
          dayNo: day,
          familyKey: get(d, 'family') || block,
          refKg,
        };
        if (!hasKg && b.rpe !== null) {
          const r = resolvePlannedKg(base, opts.stepKg);
          if (r.kg !== null) {
            base.plannedKg = r.kg;
            base.plannedKgSource = 'derived';
          }
        }
        out.sets.push(base);
      }
    }
  }
  if (derivedIdentity.size)
    out.warnings.push(
      `${derivedIdentity.size} ejercicio(s) sin exposure_id: la identidad se derivó del nombre (${[...derivedIdentity].slice(0, 5).join(', ')}). Declararla evita perder continuidad si se renombra o se cambia de variante.`,
    );
  if (out.sets.some((s) => s.plannedKg === null))
    out.warnings.push(
      `${out.sets.filter((s) => s.plannedKg === null).length} serie(s) sin carga prevista (RPE sin referencia, o sin carga): el tonelaje previsto quedará parcial.`,
    );
  out.summary = {
    rows: out.summary.rows,
    sessions: sessions.size,
    sets: out.sets.length,
    blocks: [...new Set(out.sets.map((s) => s.blockKey))],
    weeks: new Set(out.sets.map((s) => `${s.blockKey}|${s.weekNo}`)).size,
  };
  out.ok = out.errors.length === 0 && out.sets.length > 0;
  return out;
}
