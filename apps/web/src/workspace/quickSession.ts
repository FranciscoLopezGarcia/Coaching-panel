import type { MuscleGroupId } from '@coaching/contracts';
/**
 * Carga rápida de una sesión por TEXTO (como «Crear con texto» de PRG): una línea por ejercicio.
 *   Squat comp 3x5@4-5-6            3 series de 5, RPE 4, 5 y 6 (una por serie)
 *   1° Bench comp 4x5@8             prioridad 1° del coach
 *   Remo barra 3x10-12 RIR2         rango de reps y RIR (RIR 2 = RPE 8)
 *   Deadlift 1x5x100 + 3x5x90@8     varios bloques: «+» o «;»
 *   Sentadilla 5x3x100-105-110      cargas por serie (o 2 valores: rampa)
 *   | Ejercicio | Sets x Reps | Notas |   tablas de Markdown / Excel / WhatsApp
 * Una línea que empieza con el protocolo (sin nombre) sigue con el ejercicio anterior.
 * Solo interpreta texto: no guarda nada. El resultado se revisa y se edita en la planilla antes de publicar.
 */
export interface QuickSegment {
  exerciseName: string;
  variant: string;
  /** Movimiento: 'SQ' | 'BP' | 'DL' | 'acc:<grupo muscular>' (accesorio) | '' (sin elegir). */
  lift: string;
  count: string;
  reps: string;
  repsMax: string;
  kg: string;
  rpe: string;
  pct: string;
  ref: string;
  cap: string;
  mode: 'kg' | 'pct' | 'rpe' | 'rpe_cap';
  segment: 'work' | 'top' | 'backoff';
  warmup: boolean;
  tempo: string;
  pause: string;
  /** Qué ve el atleta en este ejercicio ('' = lo habitual). */
  view?: string;
  /** Progresión sugerida visible para el atleta: '' = solo el coach · 'reps' · 'reps_kg'. */
  prog?: string;
  rest: string;
  note: string;
  priority: string;
  /** true = la prioridad fue escrita (1°, 2°…) o heredada de la línea anterior; false = es solo una sugerencia por defecto. */
  priorityExplicit?: boolean;
}
export interface QuickLine {
  line: number;
  exercise: string;
  summary: string;
  sets: number;
  warnings: string[];
}
export interface QuickResult {
  segments: QuickSegment[];
  lines: QuickLine[];
  errors: { line: number; message: string }[];
}

/** Grupos musculares que se pueden elegir para un accesorio (ids = grupos del motor). */
export const MOVEMENT_GROUPS: { value: string; label: string }[] = [
  { value: 'cuadriceps', label: 'Cuádriceps' },
  { value: 'isquiotibiales', label: 'Isquios' },
  { value: 'gluteos', label: 'Glúteos' },
  { value: 'pantorrillas', label: 'Gemelos' },
  { value: 'pectoral', label: 'Pecho' },
  { value: 'hombros', label: 'Hombro' },
  { value: 'dorsales', label: 'Dorsales' },
  { value: 'espalda_alta', label: 'Espalda alta' },
  { value: 'espalda_baja', label: 'Espalda baja' },
  { value: 'trapecio', label: 'Trapecio' },
  { value: 'biceps', label: 'Bíceps' },
  { value: 'triceps', label: 'Tríceps' },
  { value: 'antebrazos', label: 'Antebrazo' },
  { value: 'core', label: 'Core' },
];
export type MuscleId = MuscleGroupId;
export const MOVEMENT_OTHER = 'acc:otro';

/** Valor de movimiento (una sola casilla) → campos que se guardan: lift de competición o grupo muscular del accesorio. */
export function movementFields(m: string): { lift: 'SQ' | 'BP' | 'DL' | null; muscleGroup: MuscleId | null } {
  if (m === 'SQ' || m === 'BP' || m === 'DL') return { lift: m, muscleGroup: null };
  const g = m.startsWith('acc:') ? m.slice(4) : '';
  return { lift: null, muscleGroup: g && g !== 'otro' ? (g as MuscleId) : null };
}
/** Campos guardados → valor de la casilla. */
export const movementValue = (lift: string | null | undefined, muscleGroup?: string | null): string =>
  lift ? lift : muscleGroup ? `acc:${muscleGroup}` : MOVEMENT_OTHER;

const ACCESSORY_RULES: [RegExp, string][] = [
  [
    /prensa|leg press|extensi[oó]n de cu|leg extension|hack|b[uú]lgar|zancada|lunge|split squat|sissy|goblet|belt squat|step.?up|cu[aá]dr/,
    'cuadriceps',
  ],
  [
    /curl (femoral|de isquio|n[oó]rdico)|leg curl|hamstring|n[oó]rdic|nordic|buenos d[ií]as|good morning|isquio/,
    'isquiotibiales',
  ],
  [/hip thrust|puente de gl|glute|gl[uú]teo|patada/, 'gluteos'],
  [/gemelo|pantorrilla|calf/, 'pantorrillas'],
  [/jal[oó]n|lat pull|pulldown|dominada|pull.?up|chin.?up/, 'dorsales'],
  [/face pull|remo|\brow\b|pullover/, 'espalda_alta'],
  [/hiperextens|lumbar|back extension/, 'espalda_baja'],
  [/encogimiento|shrug|trapecio/, 'trapecio'],
  [/apertura|\bfly\b|flyes|pec deck|cruce|fondos|\bdips?\b|flexi[oó]n|push.?up|pecho/, 'pectoral'],
  [/elevaci[oó]n lateral|lateral raise|vuelos|hombro|delt|raise/, 'hombros'],
  [/martillo|hammer|predicador|preacher|b[ií]ceps|bicep|curl/, 'biceps'],
  [/tr[ií]ceps|tricep|pushdown|jm press|franc[eé]s|skull|copa|extensi[oó]n.*polea/, 'triceps'],
  [/antebrazo|mu[nñ]eca|wrist|farmer/, 'antebrazos'],
  [/abdominal|plancha|plank|crunch|\bcore\b|ab wheel|rueda|pallof/, 'core'],
];

/**
 * Sugerencia de movimiento por nombre (se puede cambiar después en la planilla). Las variantes pertenecen al patrón de su competitiva
 * (p. ej. press militar o banca inclinado → BP; sentadilla frontal → SQ; peso muerto rumano → DL). Lo que no se reconoce queda sin elegir.
 */
export function suggestLift(name: string): string {
  const n = name.toLowerCase().trim();
  if (/hack|prensa|b[uú]lgar|goblet|split|cossac|cosack|pistol|sissy|belt squat/.test(n))
    return 'acc:cuadriceps';
  if (
    /^(squat|sentadilla|sq)\b|\b(front|frontal|pausa|pause|box|safety|low bar|high bar|tempo|anderson) squat|sentadilla (frontal|pausa|con pausa|box|safety)/.test(
      n,
    )
  )
    return 'SQ';
  if (
    /^(deadlift|deadlit|peso muerto|dl)\b|rumano|\brdl\b|stiff|sumo|d[eé]ficit|deficit|rack pull|trap bar|jefferson/.test(
      n,
    )
  )
    return 'DL';
  if (
    /^(bench ?press|bench|bp|press banca|banca|spoto)\b|floor press|close.?grip|agarre cerrado|incline|inclin|declin|press militar|militar|overhead press|\bohp\b|push press|shoulder press|press (de )?hombros?/.test(
      n,
    ) ||
    /(mancuerna|dumbbell|mnc).*(banca|bench|press)/.test(n)
  )
    return 'BP';
  const hit = ACCESSORY_RULES.find(([re]) => re.test(n));
  return hit ? `acc:${hit[1]}` : '';
}

const NUM = '\\d+(?:[.,]\\d+)?';
const toNum = (s: string) => Number(s.replace(',', '.'));
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const FIRST_PROTO = /(^|\s)\d+\s*[x×*]\s*\d/i;
const PRIO = /^\s*(?:p(?:rio)?\s*)?([1-5])\s*[°º]\s*[:.)-]?\s*|^\s*p(?:rio)?\s*([1-5])\s+/i;
const BLOCK = new RegExp(
  `^(\\d+)\\s*[x×*]\\s*(\\d+)(?:\\s*-\\s*(\\d+))?(?:\\s*/\\s*\\d+)?` + // N x R [-R2] [/R]
    `(?:\\s*[x×*]\\s*(${NUM}(?:\\s*[-/]\\s*${NUM})*)\\s*(?:kg)?)?` + // x KG [lista]
    `(?:\\s*(@\\s*)?(rpe|rir)?\\s*(${NUM}(?:\\s*[-/]\\s*${NUM})*))?` + // @RPE [lista] / RIR n
    `\\s*(.*)$`,
  'i',
);

function spread(
  list: number[],
  n: number,
  step: number,
): { values: number[]; ramp: boolean } | { error: string } {
  if (list.length === n) return { values: list, ramp: false };
  if (list.length === 1) return { values: Array.from({ length: n }, () => list[0] as number), ramp: false };
  if (list.length > n) return { error: `hay ${list.length} valores para ${n} series` };
  // rampa lineal entre el primero y el último
  const a = list[0] as number;
  const b = list[list.length - 1] as number;
  const values = Array.from({ length: n }, (_, i) => {
    const v = n === 1 ? a : a + ((b - a) * i) / (n - 1);
    return Math.round(v / step) * step;
  });
  return { values, ramp: true };
}

function parseBlock(
  raw: string,
  base: Omit<
    QuickSegment,
    'count' | 'reps' | 'repsMax' | 'kg' | 'rpe' | 'mode' | 'segment' | 'warmup' | 'note'
  >,
  note0: string,
): { segs: QuickSegment[]; summary: string; sets: number; warnings: string[] } | { error: string } {
  const m = BLOCK.exec(raw.trim());
  if (!m)
    return { error: `no entiendo «${raw.trim()}» (ejemplos: 3x5@7 · 4x8-10 RIR2 · 3x5@4-5-6 · 1x3x180@8)` };
  const n = Number(m[1]);
  const reps = Number(m[2]);
  const repsMax = m[3] ? Number(m[3]) : 0;
  if (n < 1 || n > 60) return { error: `series entre 1 y 60 («${raw.trim()}»)` };
  if (reps < 1 || reps > 100) return { error: `repeticiones entre 1 y 100 («${raw.trim()}»)` };
  if (repsMax && repsMax < reps) return { error: `rango de repeticiones al revés («${raw.trim()}»)` };
  const warnings: string[] = [];
  let kgs: number[] | null = null;
  if (m[4]) {
    const l = m[4].split(/[-/]/).map((x) => toNum(x.trim()));
    if (l.some((x) => !(x > 0))) return { error: `la carga debe ser positiva («${raw.trim()}»)` };
    const s = spread(l, n, 2.5);
    if ('error' in s) return { error: `cargas: ${s.error}` };
    if (s.ramp) warnings.push('cargas en rampa');
    kgs = s.values;
  }
  let rpes: number[] | null = null;
  if (m[7]) {
    if (!m[5] && !m[6]) return { error: `falta «@» o «RPE/RIR» antes de ${m[7]} («${raw.trim()}»)` };
    const isRir = (m[6] ?? '').toLowerCase() === 'rir';
    const l = m[7].split(/[-/]/).map((x) => toNum(x.trim()));
    const conv = l.map((x) => (isRir ? 10 - x : x));
    if (conv.some((x) => !(x >= 1 && x <= 10 && (x * 2) % 1 === 0)))
      return { error: `RPE 1–10 en pasos de 0,5 («${raw.trim()}»)` };
    const s = spread(conv, n, 0.5);
    if ('error' in s) return { error: `RPE: ${s.error}` };
    if (s.ramp) warnings.push('RPE en rampa');
    rpes = s.values;
  }
  const tail = (m[8] ?? '').trim();
  let type: QuickSegment['segment'] = 'work';
  let warmup = false;
  let note = note0;
  if (tail) {
    const words = tail.toLowerCase();
    if (/\b(top|top ?set)\b/.test(words)) type = 'top';
    else if (/\bback ?off\b/.test(words)) type = 'backoff';
    if (/\b(aprox\w*|warm ?up|calent\w*)\b/.test(words)) warmup = true;
    const rest = tail
      .replace(/\b(top ?set|top|back ?off|aprox\w*|warm ?up|calent\w*)\b/gi, '')
      .replace(/^[\s,;()-]+|[\s,;()-]+$/g, '');
    if (rest) note = note ? `${note} · ${rest}` : rest;
  }
  const varies = (xs: number[] | null) => !!xs && new Set(xs).size > 1;
  const common = {
    ...base,
    reps: String(reps),
    repsMax: repsMax ? String(repsMax) : '',
    segment: type,
    warmup,
    note,
  };
  const modeOf = (kg: string): QuickSegment['mode'] => (kg ? 'kg' : 'rpe');
  const segs: QuickSegment[] = [];
  if (varies(kgs) || varies(rpes)) {
    for (let i = 0; i < n; i++) {
      const kg = kgs ? fmt(kgs[i] as number) : '';
      segs.push({ ...common, count: '1', kg, rpe: rpes ? fmt(rpes[i] as number) : '', mode: modeOf(kg) });
    }
  } else {
    const kg = kgs ? fmt(kgs[0] as number) : '';
    segs.push({ ...common, count: String(n), kg, rpe: rpes ? fmt(rpes[0] as number) : '', mode: modeOf(kg) });
  }
  const parts = [`${n}×${repsMax ? `${reps}-${repsMax}` : reps}`];
  if (kgs) parts.push(varies(kgs) ? `${kgs.map(fmt).join('-')} kg` : `${fmt(kgs[0] as number)} kg`);
  if (rpes) parts.push(varies(rpes) ? `RPE ${rpes.map(fmt).join('-')}` : `RPE ${fmt(rpes[0] as number)}`);
  if (type !== 'work') parts.push(type === 'top' ? 'top set' : 'backoff');
  if (warmup) parts.push('aproximación');
  return { segs, summary: parts.join(' · '), sets: n, warnings };
}

/** Interpreta el texto completo. `defaultPriority` se usa cuando una línea no trae «1°», «2°»… */
export function parseQuickSession(text: string): QuickResult {
  const out: QuickResult = { segments: [], lines: [], errors: [] };
  let lastName = '';
  let lastPrio = '';
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  rows.forEach((raw, idx) => {
    const line = idx + 1;
    let s = raw.replace(/^\s*[-•*]\s+/, '').trim();
    // comentarios del coach: «texto entre comillas» o «# hasta el final de la línea» → nota del ejercicio (el atleta la lee)
    const comments: string[] = [];
    s = s.replace(/["“”]([^"“”]*)["“”]/g, (_m, c: string) => {
      if (c.trim()) comments.push(c.trim());
      return ' ';
    });
    const hash = s.indexOf('#');
    if (hash >= 0) {
      const c = s.slice(hash + 1).trim();
      if (c) comments.push(c);
      s = s.slice(0, hash);
    }
    s = s.trim();
    if (!s && comments.length) {
      // línea que es solo comentario: se agrega a la nota del ejercicio anterior
      if (!lastName) {
        out.errors.push({ line, message: 'el comentario va después de un ejercicio' });
        return;
      }
      const extra = comments.join(' · ');
      for (const g of out.segments)
        if (g.exerciseName === lastName) g.note = g.note ? `${g.note} · ${extra}` : extra;
      return;
    }
    if (!s || /^\|?[\s:|-]+\|?$/.test(s)) return; // vacía o separador de tabla
    // tabla (Markdown/Excel): primera celda = ejercicio, la celda con NxR = protocolo, el resto = notas
    let tableNote = '';
    if (s.includes('|') || s.includes('\t')) {
      const cells = s
        .split(/\||\t/)
        .map((c) => c.trim())
        .filter(Boolean);
      const pi = cells.findIndex((c) => /\d+\s*[x×*]\s*\d/i.test(c));
      if (pi < 0) return; // encabezado u otra fila sin protocolo
      const name = pi > 0 ? cells[0]! : '';
      tableNote = cells.filter((_, i) => i !== pi && i !== 0).join(' · ');
      s = `${name} ${cells[pi]}`.trim();
    }
    if (comments.length) tableNote = [tableNote, ...comments].filter(Boolean).join(' · ');
    // prioridad del coach al inicio
    let prio = '';
    const pm = PRIO.exec(s);
    if (pm) {
      prio = (pm[1] ?? pm[2]) as string;
      s = s.slice(pm[0].length).trim();
    }
    const at = s.search(FIRST_PROTO);
    if (at < 0) {
      out.errors.push({ line, message: `no encuentro series y repeticiones en «${s}» (ej.: 3x5@7)` });
      return;
    }
    let name = s
      .slice(0, at)
      .trim()
      .replace(/[:,\-–—]+$/, '')
      .trim();
    const protocol = s.slice(at).trim();
    let continued = false;
    if (!name) {
      name = lastName;
      continued = true;
      if (!name) {
        out.errors.push({ line, message: 'falta el nombre del ejercicio' });
        return;
      }
    }
    if (!prio && continued) prio = lastPrio;
    const lift = suggestLift(name);
    const explicit = !!prio;
    if (!prio) prio = lift && !lift.startsWith('acc:') ? '2' : '3';
    const base = {
      exerciseName: name,
      variant: '',
      lift,
      pct: '',
      ref: '',
      cap: '',
      tempo: '',
      pause: '',
      rest: '',
      priority: prio,
      priorityExplicit: explicit,
    };
    const blocks = protocol.split(/\s*[+;]\s*/).filter(Boolean);
    const segs: QuickSegment[] = [];
    const summaries: string[] = [];
    const warnings: string[] = [];
    let sets = 0;
    let failed = false;
    for (const b of blocks) {
      const r = parseBlock(b, base, tableNote);
      if ('error' in r) {
        out.errors.push({ line, message: r.error });
        failed = true;
        break;
      }
      segs.push(...r.segs);
      summaries.push(r.summary);
      warnings.push(...r.warnings);
      sets += r.sets;
    }
    if (failed) return;
    out.segments.push(...segs);
    out.lines.push({ line, exercise: name, summary: summaries.join(' + '), sets, warnings });
    lastName = name;
    lastPrio = prio;
  });
  return out;
}

/** Texto equivalente de los segmentos actuales (para volver al modo texto sin perder lo cargado). */
export function segmentsToText(segs: QuickSegment[]): string {
  return segs
    .filter((s) => s.exerciseName)
    .map((s) => {
      const reps = s.repsMax ? `${s.reps}-${s.repsMax}` : s.reps;
      return `${s.priority ? s.priority + '° ' : ''}${s.exerciseName} ${s.count}x${reps}${s.kg ? 'x' + s.kg : ''}${s.rpe ? '@' + s.rpe : ''}${s.note ? ' ' + s.note : ''}`;
    })
    .join('\n');
}

/** Ajustes por ejercicio que no se escriben en el texto: descanso entre series (s) y qué ve el atleta. */
export type ExMeta = Record<string, { pause: string; view: string; prog: string }>;
export function applyMeta(segs: QuickSegment[], meta: ExMeta): QuickSegment[] {
  return segs.map((s) => {
    const m = meta[s.exerciseName];
    return m ? { ...s, pause: m.pause, view: m.view, prog: m.prog } : s;
  });
}
