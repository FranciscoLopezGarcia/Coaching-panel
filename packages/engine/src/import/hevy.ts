import { fingerprintText } from './hash.js';
import { csvRecords } from './csv.js';
import type { LoadKind, ObservedSet, SetType } from '../observed.js';
import type { Lift } from '../types.js';

/**
 * Importador del CSV de exportación de Hevy. Pura: texto → filas normalizadas + rechazos con motivo. No toca ninguna base de datos.
 *
 * Interpretaciones EXPLÍCITAS (quedan registradas en el resultado):
 *  - Fechas: `start_time` no trae zona horaria. Se toma la hora tal como está escrita (hora local de la cuenta) y se usa su FECHA civil;
 *    la zona configurada (`timeZone`) se registra pero no convierte nada en formatos "d mes aaaa, hh:mm". Si el valor trae offset/UTC (ISO),
 *    se convierte a la zona configurada.
 *  - Tipos de serie: normal → trabajo; warmup → calentamiento; failure → trabajo al fallo; dropset → dropset (excluido de récords/e1RM).
 *  - RPE vacío = no registrado (null); peso vacío = null (nunca 0). No se deduce prescripción ni descanso de lo ejecutado.
 *  - Mancuernas: el peso se interpreta POR LADO (no se duplica ni se asume carga total); peso corporal sin carga añadida no tiene kg.
 */
export const HEVY_SOURCE = 'hevy';
export const HEVY_PARSER_VERSION = 'hevy-csv-v1';

export interface HevyOptions {
  /** Zona horaria con la que se interpretan los instantes con offset. Default: la del coach. */
  timeZone?: string;
  /** Correcciones/ampliaciones al mapeo ejercicio → lift/variante/tipo de carga, por título exacto. */
  exerciseMap?: Record<string, Partial<ExerciseMapping>>;
  /** Carga máxima plausible (kg) para rechazar errores de tipeo. */
  maxKg?: number;
}

export interface ExerciseMapping {
  exerciseId: string;
  lift: Lift | null;
  variantKey: string;
  loadKind: LoadKind;
}

const DEFAULT_MAP: Record<string, ExerciseMapping> = {
  'Squat (Barbell)': { exerciseId: 'squat-barbell', lift: 'SQ', variantKey: 'barbell', loadKind: 'total' },
  'Bench Press (Barbell)': {
    exerciseId: 'bench-press-barbell',
    lift: 'BP',
    variantKey: 'barbell',
    loadKind: 'total',
  },
  'Deadlift (Barbell)': {
    exerciseId: 'deadlift-barbell',
    lift: 'DL',
    variantKey: 'barbell',
    loadKind: 'total',
  },
  'Sumo Deadlift': { exerciseId: 'sumo-deadlift', lift: 'DL', variantKey: 'sumo', loadKind: 'total' },
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function mappingFor(
  title: string,
  over: HevyOptions['exerciseMap'] = {},
): { mapping: ExerciseMapping; known: boolean } {
  const base = DEFAULT_MAP[title];
  const ov = over[title];
  if (base || ov) return { mapping: { ...(base ?? inferMapping(title)), ...(ov ?? {}) }, known: true };
  return { mapping: inferMapping(title), known: false };
}

/** Sin mapeo explícito: lift = null (no se adivina) y el tipo de carga se infiere SOLO del equipamiento declarado en el título. */
function inferMapping(title: string): ExerciseMapping {
  const t = title.toLowerCase();
  const loadKind: LoadKind = /\(dumbbell\)/.test(t)
    ? 'per_side'
    : /\(barbell\)|\(ez bar\)|\(trap bar\)/.test(t)
      ? 'total'
      : /\(machine\)|\(cable\)|\(smith machine\)|\(plate loaded\)/.test(t)
        ? 'machine'
        : /\(assisted\)/.test(t)
          ? 'assisted'
          : /weighted/.test(t)
            ? 'added_bodyweight'
            : /\(bodyweight\)|\(body weight\)/.test(t)
              ? 'bodyweight'
              : 'unknown';
  return {
    exerciseId: slug(title),
    lift: null,
    variantKey: loadKind === 'unknown' ? 'sin-equipo' : slug(t.match(/\(([^)]+)\)/)?.[1] ?? loadKind),
    loadKind,
  };
}

const MONTHS: Record<string, number> = {
  ene: 1,
  jan: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dic: 12,
  dec: 12,
};

export interface ParsedDate {
  date: string;
  time: string;
  interpretation: 'hora_local_escrita' | 'instante_convertido_a_zona';
}

/** "3 abr 2026, 18:30" · "Apr 3, 2026, 6:30 PM" · "2026-04-03 18:30:00" · "2026-04-03T21:30:00Z". null si no se entiende. */
export function parseHevyDate(raw: string, timeZone: string): ParsedDate | null {
  const s = raw.trim();
  let m = /^(\d{1,2})\s+([A-Za-zñÑ]{3,4})\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(s);
  if (m) {
    const mon = MONTHS[(m[2] as string).toLowerCase()];
    if (!mon) return null;
    return {
      date: `${m[3]}-${String(mon).padStart(2, '0')}-${(m[1] as string).padStart(2, '0')}`,
      time: `${(m[4] as string).padStart(2, '0')}:${m[5]}`,
      interpretation: 'hora_local_escrita',
    };
  }
  m = /^([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i.exec(s);
  if (m) {
    const mon = MONTHS[(m[1] as string).toLowerCase()];
    if (!mon) return null;
    let h = Number(m[4]);
    if (m[6]?.toUpperCase() === 'PM' && h < 12) h += 12;
    if (m[6]?.toUpperCase() === 'AM' && h === 12) h = 0;
    return {
      date: `${m[3]}-${String(mon).padStart(2, '0')}-${(m[2] as string).padStart(2, '0')}`,
      time: `${String(h).padStart(2, '0')}:${m[5]}`,
      interpretation: 'hora_local_escrita',
    };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    if (!m[6])
      return {
        date: `${m[1]}-${m[2]}-${m[3]}`,
        time: `${m[4]}:${m[5]}`,
        interpretation: 'hora_local_escrita',
      };
    const d = new Date(s.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return {
      date: `${g('year')}-${g('month')}-${g('day')}`,
      time: `${g('hour')}:${g('minute')}`,
      interpretation: 'instante_convertido_a_zona',
    };
  }
  return null;
}

export interface HevyRow extends Omit<ObservedSet, 'id'> {
  id: string;
  /** Clave estable para detectar duplicados y reimportar sin duplicar. */
  externalKey: string;
  workoutTitle: string;
  startRaw: string;
  line: number;
  warnings: string[];
}

export interface Rejected {
  line: number;
  reason: string;
  raw: Record<string, string>;
}

export interface HevyParse {
  parserVersion: string;
  options: { timeZone: string; maxKg: number };
  fatal: string[];
  rows: HevyRow[];
  rejected: Rejected[];
  duplicatesInFile: number;
  /** Interpretación de fechas aplicada (para que el consumidor la muestre). */
  dateInterpretation: string;
}

const REQUIRED = ['start_time', 'exercise_title', 'set_index', 'set_type', 'weight_kg', 'reps'];

const num = (s: string): number | null => {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

export function parseHevyCsv(text: string, opts: HevyOptions = {}): HevyParse {
  const timeZone = opts.timeZone ?? 'America/Argentina/Mendoza';
  const maxKg = opts.maxKg ?? 1000;
  const out: HevyParse = {
    parserVersion: HEVY_PARSER_VERSION,
    options: { timeZone, maxKg },
    fatal: [],
    rows: [],
    rejected: [],
    duplicatesInFile: 0,
    dateInterpretation: `start_time se toma como hora local escrita (cuenta en ${timeZone}) y se usa su fecha civil; los instantes con offset/UTC se convierten a ${timeZone}.`,
  };
  const { headers, records } = csvRecords(text);
  const missing = REQUIRED.filter((h) => !headers.includes(h));
  if (!headers.length || missing.length) {
    out.fatal.push(
      `Faltan columnas obligatorias: ${missing.join(', ') || 'encabezado'}. ¿Es una exportación de entrenamientos de Hevy?`,
    );
    return out;
  }
  const seen = new Set<string>();
  for (const { line, data: d } of records) {
    const rej = (reason: string) => out.rejected.push({ line, reason, raw: d });
    const title = d.exercise_title as string;
    if (!title) {
      rej('sin título de ejercicio');
      continue;
    }
    const dt = parseHevyDate(d.start_time as string, timeZone);
    if (!dt) {
      rej(`fecha no interpretable: “${d.start_time}”`);
      continue;
    }
    const st = (d.set_type as string).toLowerCase();
    const typeMap: Record<string, SetType> = {
      normal: 'work',
      '': 'work',
      warmup: 'warmup',
      failure: 'failure',
      dropset: 'dropset',
    };
    if (!(st in typeMap)) {
      rej(`tipo de serie desconocido: “${d.set_type}”`);
      continue;
    }
    const kg = num(d.weight_kg as string);
    const reps = num(d.reps as string);
    if (Number.isNaN(kg) || Number.isNaN(reps)) {
      rej('peso o repeticiones no numéricos');
      continue;
    }
    if (reps === null && kg === null) {
      rej('sin repeticiones ni carga (¿cardio o tiempo? no es una serie de fuerza)');
      continue;
    }
    if (reps === null || !Number.isInteger(reps) || reps <= 0) {
      rej(reps !== null && !Number.isInteger(reps) ? 'repeticiones no enteras' : 'sin repeticiones válidas');
      continue;
    }
    if (kg !== null && (kg < 0 || kg > maxKg)) {
      rej(`carga implausible (${kg} kg; máximo configurado ${maxKg})`);
      continue;
    }
    const warnings: string[] = [];
    let rpe = num((d.rpe ?? '') as string);
    if (rpe !== null && (Number.isNaN(rpe) || rpe < 1 || rpe > 10)) {
      warnings.push(`RPE no válido (“${d.rpe}”): se trata como no registrado`);
      rpe = null;
    }
    const { mapping } = mappingFor(title, opts.exerciseMap);
    const key = [d.start_time, title, d.set_index, st, d.weight_kg, d.reps, d.rpe ?? ''].join('|');
    if (seen.has(key)) {
      out.duplicatesInFile++;
      rej('duplicada dentro del archivo (misma sesión, ejercicio, serie y valores)');
      continue;
    }
    seen.add(key);
    const bodyweightNoLoad =
      (mapping.loadKind === 'bodyweight' || mapping.loadKind === 'added_bodyweight') &&
      (kg === null || kg === 0);
    if (mapping.loadKind === 'per_side')
      warnings.push('mancuernas: peso por lado (no se duplica ni se asume carga total)');
    out.rows.push({
      id: `hevy-${fingerprintText(key)}`,
      source: HEVY_SOURCE,
      sessionKey: `hevy:${dt.date}:${slug((d.title as string) || 'sin-titulo')}:${slug(d.start_time as string)}`,
      date: dt.date,
      exerciseName: title,
      exerciseId: mapping.exerciseId,
      lift: mapping.lift,
      variantKey: mapping.variantKey,
      setType: typeMap[st] as SetType,
      kg: bodyweightNoLoad ? null : kg === 0 ? null : kg,
      reps,
      rpe,
      loadKind: bodyweightNoLoad ? 'bodyweight' : mapping.loadKind,
      plannedSetId: null,
      setNo:
        Number.isInteger(Number(d.set_index)) && Number(d.set_index) >= 0 ? Number(d.set_index) + 1 : null,
      refKg: null,
      refSource: null,
      refAsOf: null,
      externalKey: key,
      workoutTitle: (d.title as string) ?? '',
      startRaw: d.start_time as string,
      line,
      warnings,
    });
  }
  return out;
}

export interface HevyPreview {
  newRows: number;
  duplicatesExisting: number;
  duplicatesInFile: number;
  rejected: number;
  rejectedByReason: { reason: string; count: number }[];
  sessions: number;
  dateRange: { from: string; to: string } | null;
  bySetType: Record<string, number>;
  withRpe: number;
  withoutRpe: number;
  unmappedExercises: { title: string; sets: number }[];
  /** Mapeo revisable: TODOS los ejercicios del archivo con el mapeo aplicado y si fue explícito (`known`) o inferido. */
  exercises: {
    title: string;
    sets: number;
    lift: Lift | null;
    loadKind: string;
    variantKey: string;
    known: boolean;
  }[];
  /** Registros VÁLIDOS (se importan) con alguna métrica no disponible: no son rechazos. */
  validWithGaps: { metric: string; rows: number; reason: string }[];
  /** Primeros rechazos reales (línea y motivo; sin contenido de la fila). */
  rejectedSample: { line: number; reason: string }[];
  loadKinds: Record<string, number>;
  warnings: string[];
  /** Huella del contenido y de las opciones: para aplicar hay que confirmar exactamente lo que se vio. */
  token: string;
  dateInterpretation: string;
  fatal: string[];
  /** Primeras filas normalizadas (para revisar el mapeo). */
  sample: Pick<HevyRow, 'date' | 'exerciseName' | 'setType' | 'kg' | 'reps' | 'rpe' | 'loadKind' | 'lift'>[];
}

/** Vista previa (dry-run): qué se importaría, qué se rechaza y por qué, qué ya existe y qué ejercicios no tienen mapeo. No escribe nada. */
export function previewHevy(
  p: HevyParse,
  existingKeys: Set<string> = new Set(),
  opts: HevyOptions = {},
): HevyPreview {
  const fresh = p.rows.filter((r) => !existingKeys.has(r.externalKey));
  const reasons = new Map<string, number>();
  for (const r of p.rejected)
    reasons.set(
      r.reason.replace(/\(.*\)|“.*”/g, '').trim(),
      (reasons.get(r.reason.replace(/\(.*\)|“.*”/g, '').trim()) ?? 0) + 1,
    );
  const dates = p.rows.map((r) => r.date).sort();
  const unmapped = new Map<string, number>();
  for (const r of p.rows)
    if (!mappingFor(r.exerciseName, opts.exerciseMap).known)
      unmapped.set(r.exerciseName, (unmapped.get(r.exerciseName) ?? 0) + 1);
  const exMap = new Map<
    string,
    { title: string; sets: number; lift: Lift | null; loadKind: string; variantKey: string; known: boolean }
  >();
  for (const r of p.rows) {
    const cur = exMap.get(r.exerciseName);
    if (cur) cur.sets++;
    else
      exMap.set(r.exerciseName, {
        title: r.exerciseName,
        sets: 1,
        lift: r.lift,
        loadKind: r.loadKind,
        variantKey: r.variantKey,
        known: mappingFor(r.exerciseName, opts.exerciseMap).known,
      });
  }
  const gap = (metric: string, reason: string, f: (r: HevyRow) => boolean) => ({
    metric,
    reason,
    rows: p.rows.filter((r) => r.setType !== 'warmup' && f(r)).length,
  });
  const validWithGaps = [
    gap(
      'e1rm_table_rpe',
      'Sin RPE real: no hay e1RM por curva (sí por fórmulas PRG).',
      (r) => r.rpe === null,
    ),
    gap(
      'tonnage',
      'Carga total desconocida (mancuernas por lado, peso corporal o tipo de carga desconocido): excluida del tonelaje.',
      (r) => r.loadKind !== 'total' && r.loadKind !== 'machine',
    ),
    gap(
      'lift_metrics',
      'Ejercicio sin mapeo a un lift: no cuenta para métricas por lift.',
      (r) => r.lift === null,
    ),
  ].filter((g) => g.rows > 0);
  const count = (f: (r: HevyRow) => string) =>
    p.rows.reduce<Record<string, number>>((a, r) => ((a[f(r)] = (a[f(r)] ?? 0) + 1), a), {});
  const warnings: string[] = [];
  if (unmapped.size)
    warnings.push(
      `${unmapped.size} ejercicio(s) sin mapeo explícito: se importan con lift = ninguno (no se adivina). Completá \`exerciseMap\` si querés que cuenten para un lift.`,
    );
  if (p.rows.some((r) => r.loadKind === 'per_side'))
    warnings.push('Hay mancuernas por lado: se excluyen del tonelaje total.');
  if (!p.rows.some((r) => r.rpe !== null))
    warnings.push(
      'El archivo no trae RPE real: no habrá e1RM por curva; sí por fórmulas, NL, series, tonelaje y récords.',
    );
  const token = fingerprintText(
    `${HEVY_PARSER_VERSION}|${p.options.timeZone}|${JSON.stringify(opts.exerciseMap ?? {})}|${fresh
      .map((r) => r.externalKey)
      .sort()
      .join('\n')}`,
  );
  return {
    newRows: fresh.length,
    duplicatesExisting: p.rows.length - fresh.length,
    duplicatesInFile: p.duplicatesInFile,
    rejected: p.rejected.length,
    rejectedByReason: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    sessions: new Set(fresh.map((r) => r.sessionKey)).size,
    dateRange: dates.length ? { from: dates[0] as string, to: dates.at(-1) as string } : null,
    bySetType: count((r) => r.setType),
    withRpe: p.rows.filter((r) => r.rpe !== null).length,
    withoutRpe: p.rows.filter((r) => r.rpe === null).length,
    unmappedExercises: [...unmapped.entries()]
      .map(([title, sets]) => ({ title, sets }))
      .sort((a, b) => b.sets - a.sets),
    exercises: [...exMap.values()].sort((a, b) => b.sets - a.sets),
    validWithGaps,
    rejectedSample: p.rejected.slice(0, 10).map((r) => ({ line: r.line, reason: r.reason })),
    loadKinds: count((r) => r.loadKind),
    warnings,
    token,
    dateInterpretation: p.dateInterpretation,
    fatal: p.fatal,
    sample: p.rows.slice(0, 5).map((r) => ({
      date: r.date,
      exerciseName: r.exerciseName,
      setType: r.setType,
      kg: r.kg,
      reps: r.reps,
      rpe: r.rpe,
      loadKind: r.loadKind,
      lift: r.lift,
    })),
  };
}
