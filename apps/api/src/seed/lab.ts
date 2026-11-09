import type { ActualSet, PlannedSet, SessionFeedback } from '@coaching/engine';
import type { CheckInInput, ParamsInput } from '@coaching/contracts';
import type { AppContext } from '../app.js';

/**
 * LABORATORIO: atletas FICTICIOS reproducibles para explorar el sistema. Todo es inventado; no hay datos reales.
 * Las fechas son FIJAS (parten de `start`, un lunes) para que el caso sea idéntico en cada creación. La programación se publica por bloques
 * de 4 semanas con fecha de publicación propia, para que evaluar a un corte pasado solo vea lo que se conocía entonces.
 * Los casos describen condiciones a explorar; NO están ajustados para producir una etiqueta concreta.
 */
export const LAB_DEFAULT_START = '2026-06-01';
export const LAB_PREFIX = 'LAB';

export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

interface SetSpec {
  reps: number;
  kg: number | null;
  rpe: number | null;
  warmup?: boolean;
  protocol?: PlannedSet['protocol'];
}
interface SessionSpec {
  week: number;
  day: number;
  lift: 'SQ' | 'BP' | 'DL';
  exercise: string;
  sets: SetSpec[];
  tag: string;
  /** Identidad de la exposición (default `<lift>-primaria`), variante, rol y ejercicio cuya referencia fechada usa. */
  exposureId?: string;
  variant?: string;
  role?: 'primaria' | 'secundaria' | 'accesorio';
  refName?: string;
}
type Exec = {
  kg: number | null;
  reps: number | null;
  rpe: number | null;
  pain?: number | null;
  status?: 'done' | 'skipped';
} | null;

export interface LabCase {
  key: string;
  name: string;
  summary: string;
  explores: string;
  incompatible: string;
  indeterminate: string;
  contains: string;
  modify: string;
  invariant: string;
  limitations: string;
  /** Cortes sugeridos para evaluar (el laboratorio contiene datos posteriores a estos cortes). */
  cutoffs: { weekEnd: number; note: string }[];
  params: ParamsInput;
  refs: {
    exerciseName: string;
    kg: number;
    asOf: number;
    source: 'test' | 'competencia' | 'decision_del_coach';
    note: string;
  }[];
  weeks: number;
  executedWeeks: number;
  objective: string;
  blocks: { from: number; to: number; objective: string; family: string }[];
  /** Semana (1-based) desde la que se publica cada versión: se publica el viernes anterior al inicio de ese bloque. */
  publishAtWeek: number[];
  sessions: SessionSpec[];
  exec: (s: SessionSpec, setIdx: number) => Exec;
  checkins: (weekEnd: number) => Omit<CheckInInput, 'date'> | null;
  fatigue: (week: number, tag: string) => number | null;
  extra?: (ctx: AppContext, athleteId: string, d: (week: number, day: number) => string) => void;
}

const mk = (
  week: number,
  day: number,
  lift: 'SQ' | 'BP' | 'DL',
  exercise: string,
  tag: string,
  sets: SetSpec[],
  extra: Partial<SessionSpec> = {},
): SessionSpec => ({ week, day, lift, exercise, tag, sets, ...extra });
/** Día de volumen = OTRA exposición (variante con pausa): no se mezclan en una serie sesiones de esquemas distintos. */
const PAUSA: Partial<SessionSpec> = {
  exposureId: 'sq-pausa',
  variant: 'Pausa',
  role: 'secundaria',
  refName: 'Squat comp',
};
const reps = (n: number, kg: number, r: number, rpe: number): SetSpec[] =>
  Array.from({ length: n }, () => ({ reps: r, kg, rpe }));
const warm = (kg: number): SetSpec => ({ reps: 5, kg, rpe: null, warmup: true });
const minChange = { minChangePct: 1.5, minChangeKg: 2.5, stepKg: 2.5 };

/* ---------- A · Progreso ---------- */
const A_HEAVY = [120, 120, 122.5, 125, 125, 127.5, 130, 130, 132.5, 135, 135, 137.5];
const A_RPE = [8, 8, 7.5, 8, 7.5, 8, 8, 7.5, 8, 8, 7.5, 8];
const caseA: LabCase = {
  key: 'A',
  name: 'LAB-A · Progreso (ficticio)',
  summary:
    'Prescripción y ejecución comparables; el peso sube de forma gradual con esfuerzo estable y cuestionarios favorables.',
  explores:
    'Cómo se ve una mejora real con datos completos: progreso, tendencia, protocolo por porcentaje de una referencia fechada y recuperación favorable.',
  incompatible:
    'Revisión técnica, deterioro/fin de respuesta o "datos insuficientes" con el corte sugerido (hay 8+ exposiciones con RPE real).',
  indeterminate:
    'Si hay candidato a PR o ventana de expresión depende de parámetros que el coach debe definir; puede quedar sin señal.',
  contains:
    'SQ 2 sesiones/semana (lunes pesada con aproximación; jueves volumen con protocolo 75 % de la referencia), 12 semanas ejecutadas + 4 planificadas, referencia 150 kg (test) y 157,5 kg desde la semana 9, check-ins semanales favorables.',
  modify:
    'Cambiá RPE/kg de una semana (POST /sets), borrá un check-in, cambiá la referencia fechada, evaluá a distintos cortes, agregá semanas con "repetir semana".',
  invariant:
    'Los kg y RPE de las semanas ya ejecutadas hasta el corte, y el hecho de que evaluar a un corte pasado no usa las semanas posteriores.',
  limitations:
    'Una sola barra, sin cambios de estímulo ni competencia. Los umbrales de cambio mínimo (1,5 % / 2,5 kg) son del laboratorio, no una recomendación.',
  cutoffs: [
    { weekEnd: 6, note: 'a mitad de camino' },
    { weekEnd: 10, note: 'con ejecución posterior (semanas 11–12) que NO debe usarse' },
    { weekEnd: 12, note: 'toda la ejecución' },
  ],
  params: { perLift: { SQ: minChange }, families: { acum: { objective: 'fuerza' } } },
  refs: [
    { exerciseName: 'Squat comp', kg: 150, asOf: 1, source: 'test', note: 'test ficticio' },
    { exerciseName: 'Squat comp', kg: 157.5, asOf: 9, source: 'test', note: 'test ficticio' },
  ],
  weeks: 16,
  executedWeeks: 12,
  objective: 'fuerza',
  blocks: [1, 5, 9, 13].map((f) => ({ from: f, to: f + 3, objective: 'fuerza', family: 'acum' })),
  publishAtWeek: [1, 5, 9, 13],
  sessions: Array.from({ length: 16 }, (_, i) => i + 1).flatMap((w) => {
    const kg = A_HEAVY[w - 1] ?? 137.5 + (w - 12) * 2.5;
    return [
      mk(w, 1, 'SQ', 'Squat comp', 'pesada', [warm(60), ...reps(3, kg, 5, 8)]),
      mk(
        w,
        4,
        'SQ',
        'Squat pausa',
        'volumen',
        [0, 1, 2].map(() => ({
          reps: 8,
          kg: null,
          rpe: 7,
          protocol: {
            loadMode: 'pct' as const,
            pct: 75,
            capKg: null,
            segment: 'work' as const,
            tempo: null,
            pauseSec: null,
            instructions: null,
          },
        })),
        PAUSA,
      ),
    ];
  }),
  exec: (s, i) => {
    const set = s.sets[i]!;
    if (s.week > 12) return null;
    const rpe = s.tag === 'pesada' ? A_RPE[s.week - 1]! : 7;
    return { kg: set.kg, reps: set.reps, rpe: set.warmup ? null : rpe, pain: null };
  },
  checkins: () => ({ sleep: 8, energy: 8, motivation: 8, stress: 3, pain: 2 }),
  fatigue: (w, tag) => (tag === 'pesada' ? 5 + (w % 2) : null),
};

/* ---------- B · Deterioro ---------- */
const B_PLAN = [130, 132.5, 135, 137.5, 140, 142.5, 145, 147.5, 150, 152.5, 155, 157.5];
const B_KG = [130, 132.5, 135, 137.5, 135, 135, 132.5, 130, 130, 127.5, 125, 125];
const B_RPE = [8, 8, 8, 8, 8.5, 9, 9, 9.5, 9.5, 9.5, 9.5, 9.5];
const caseB: LabCase = {
  key: 'B',
  name: 'LAB-B · Deterioro (ficticio)',
  summary:
    'La prescripción sigue subiendo, pero el atleta carga menos y con más esfuerzo; los cuestionarios empeoran en paralelo.',
  explores:
    'Divergencia entre previsto y realizado, exceso de RPE sobre el objetivo, caída del e1RM y recuperación desfavorable (cuestionario y fatiga de sesión).',
  incompatible:
    'Progreso o candidato a PR como conclusión principal en los cortes de las semanas 8 y 12 (en el corte de la semana 4 todavía no hay deterioro y una lectura favorable es coherente).',
  indeterminate:
    'La causa (fatiga, técnica, estrés externo) NO se puede inferir de estos datos; el sistema solo describe.',
  contains:
    'SQ 2 sesiones/semana, 12 semanas ejecutadas; plan 130→157,5 kg, ejecutado 125–137,5 kg con RPE 8→9,5; check-ins que bajan (sueño, energía) y suben (estrés, molestia); fatiga de sesión 7→9; molestia por serie ≤ 3.',
  modify:
    'Bajá el RPE real de las últimas semanas o mejorá los check-ins y re-evaluá; agregá una semana de descarga con "repetir semana" y mirá el seguimiento de una intervención.',
  invariant: 'El plan publicado y las semanas previas a la 5 (ejecutadas según plan).',
  limitations:
    'La molestia no llega a un valor de alerta propio; el laboratorio no define umbrales de dolor. No hay diagnóstico ni causa.',
  cutoffs: [
    { weekEnd: 4, note: 'antes del deterioro (debería verse comparable)' },
    { weekEnd: 8, note: 'deterioro en curso' },
    { weekEnd: 12, note: 'deterioro sostenido' },
  ],
  params: { perLift: { SQ: minChange }, families: { acum: { objective: 'fuerza' } } },
  refs: [{ exerciseName: 'Squat comp', kg: 165, asOf: 1, source: 'test', note: 'test ficticio' }],
  weeks: 16,
  executedWeeks: 12,
  objective: 'fuerza',
  blocks: [1, 5, 9, 13].map((f) => ({ from: f, to: f + 3, objective: 'fuerza', family: 'acum' })),
  publishAtWeek: [1, 5, 9, 13],
  sessions: Array.from({ length: 16 }, (_, i) => i + 1).flatMap((w) => {
    const kg = B_PLAN[w - 1] ?? 157.5 + (w - 12) * 2.5;
    return [
      mk(w, 1, 'SQ', 'Squat comp', 'pesada', [warm(60), ...reps(3, kg, 5, 8)]),
      mk(w, 4, 'SQ', 'Squat pausa', 'volumen', reps(3, Math.round((kg * 0.78) / 2.5) * 2.5, 8, 7), PAUSA),
    ];
  }),
  exec: (s, i) => {
    if (s.week > 12) return null;
    const set = s.sets[i]!;
    if (set.warmup) return { kg: set.kg, reps: 5, rpe: null };
    if (s.tag === 'pesada') {
      const last = s.week >= 11 && i === 3;
      return {
        kg: B_KG[s.week - 1]!,
        reps: last ? 4 : 5,
        rpe: B_RPE[s.week - 1]!,
        pain: s.week >= 8 ? 3 : null,
      };
    }
    return {
      kg: Math.round((B_KG[s.week - 1]! * 0.78) / 2.5) * 2.5,
      reps: 8,
      rpe: Math.min(9, 7 + Math.max(0, (s.week - 4) * 0.25)),
    };
  },
  checkins: (w) =>
    w <= 4
      ? { sleep: 7, energy: 7, motivation: 7, stress: 4, pain: 2 }
      : {
          sleep: Math.max(3, 7 - (w - 4) * 0.5),
          energy: Math.max(2, 7 - (w - 4) * 0.6),
          motivation: Math.max(3, 7 - (w - 4) * 0.5),
          stress: Math.min(9, 4 + (w - 4) * 0.6),
          pain: Math.min(5, 2 + Math.floor((w - 4) / 3)),
        },
  fatigue: (w, tag) => (tag === 'pesada' ? Math.min(9, 6 + Math.floor(w / 3)) : null),
};

/* ---------- C · Mantenimiento ---------- */
const caseC: LabCase = {
  key: 'C',
  name: 'LAB-C · Estabilidad con objetivo de mantenimiento (ficticio)',
  summary:
    'Carga y esfuerzo constantes durante 12 semanas, con objetivo declarado de mantenimiento y cuestionarios favorables.',
  explores:
    'Que la estabilidad se interprete según el objetivo: con mantenimiento declarado, estable NO es "fin de respuesta".',
  incompatible: 'Fin de respuesta / meseta presentada como problema, o una orden de "más estímulo".',
  indeterminate:
    'Si el atleta podría progresar con otro estímulo: los datos no lo dicen. Con RPE 7 sostenido puede aparecer un candidato a PR (el margen de esfuerzo existe), aunque en mantenimiento intentarlo quizá no corresponda: el sistema no distingue esa intención. Cambiar el objetivo cambia la lectura de la estabilidad (probalo).',
  contains:
    'SQ 2 sesiones/semana, 12 semanas ejecutadas, 130 kg × 5 a RPE 7 (pesada) y 100 kg × 8 a RPE 6,5 (volumen); objetivo "mantenimiento" en macro, meso y familia; referencia 160 kg.',
  modify:
    'Cambiá el objetivo de la familia a "fuerza" (PUT /params, families.mant.objective) y re-evaluá al mismo corte; subí el RPE de las últimas semanas.',
  invariant:
    'Kg y reps de las semanas ejecutadas (la lectura cambia solo por objetivo/parámetros, no por los datos).',
  limitations:
    'No hay cambio de estímulo ni competencia. "Estable" depende del cambio mínimo configurado en el laboratorio.',
  cutoffs: [
    { weekEnd: 8, note: '8 semanas estables' },
    { weekEnd: 12, note: '12 semanas estables' },
  ],
  params: { perLift: { SQ: minChange }, families: { mant: { objective: 'mantenimiento' } } },
  refs: [{ exerciseName: 'Squat comp', kg: 160, asOf: 1, source: 'test', note: 'test ficticio' }],
  weeks: 16,
  executedWeeks: 12,
  objective: 'mantenimiento',
  blocks: [1, 5, 9, 13].map((f) => ({ from: f, to: f + 3, objective: 'mantenimiento', family: 'mant' })),
  publishAtWeek: [1, 5, 9, 13],
  sessions: Array.from({ length: 16 }, (_, i) => i + 1).flatMap((w) => [
    mk(w, 1, 'SQ', 'Squat comp', 'pesada', [warm(60), ...reps(3, 130, 5, 7)]),
    mk(w, 4, 'SQ', 'Squat pausa', 'volumen', reps(3, 100, 8, 6.5), PAUSA),
  ]),
  exec: (s, i) => {
    if (s.week > 12) return null;
    const set = s.sets[i]!;
    return { kg: set.kg, reps: set.reps, rpe: set.warmup ? null : s.tag === 'pesada' ? 7 : 6.5 };
  },
  checkins: () => ({ sleep: 8, energy: 7, motivation: 7, stress: 3, pain: 2 }),
  fatigue: (_w, tag) => (tag === 'pesada' ? 4 : null),
};

/* ---------- D · Datos incompletos ---------- */
const caseD: LabCase = {
  key: 'D',
  name: 'LAB-D · Datos incompletos (ficticio)',
  summary:
    'Progreso moderado con RPE faltante la mayor parte del tiempo, cuestionarios solo al inicio, sesiones registradas a medias y una semana sin registro.',
  explores:
    'Abstención parcial: qué métricas y reglas siguen disponibles, cuáles no, y que los faltantes nunca se rellenan (ni RPE con el objetivo ni check-ins con el último valor).',
  incompatible:
    'Un e1RM por curva en semanas sin RPE real, una conclusión de recuperación sin cuestionario vigente, o ceros inventados en semanas sin registro.',
  indeterminate:
    'Casi todo lo que dependa de esfuerzo o recuperación. Es el resultado esperado, no un error.',
  contains:
    'SQ 2 sesiones/semana, 10 semanas con ejecución parcial: RPE solo en pesadas desde la semana 7; semana 4 con la tercera serie sin registrar; jueves de la semana 6 omitido; semana 8 sin ningún registro; check-ins solo semanas 1–3; la referencia fechada recién existe desde la semana 6.',
  modify:
    'Cargá el RPE de una semana, un check-in reciente o la serie faltante y mirá qué se habilita; agregá la referencia antes de la semana 6.',
  invariant:
    'Lo que no se registró sigue como "sin registro" (no se convierte en 0 ni en "omitida" automáticamente).',
  limitations: 'El caso mezcla varias carencias a propósito; no sirve para aislar el efecto de una sola.',
  cutoffs: [
    { weekEnd: 5, note: 'antes de la referencia y con un cuestionario viejo' },
    { weekEnd: 10, note: 'con RPE parcial y cuestionario antiguo' },
  ],
  params: { perLift: { SQ: minChange }, families: { inc: { objective: 'fuerza' } } },
  refs: [
    {
      exerciseName: 'Squat comp',
      kg: 155,
      asOf: 6,
      source: 'decision_del_coach',
      note: 'referencia definida recién en la semana 6',
    },
  ],
  weeks: 14,
  executedWeeks: 10,
  objective: 'fuerza',
  blocks: [1, 5, 9, 13].map((f) => ({ from: f, to: f + 3, objective: 'fuerza', family: 'inc' })),
  publishAtWeek: [1, 5, 9, 13],
  sessions: Array.from({ length: 14 }, (_, i) => i + 1).flatMap((w) => {
    const kg = 120 + Math.floor((w - 1) / 2) * 2.5;
    return [
      mk(w, 1, 'SQ', 'Squat comp', 'pesada', [warm(60), ...reps(3, kg, 5, 8)]),
      mk(w, 4, 'SQ', 'Squat pausa', 'volumen', reps(3, kg - 20, 8, 7), PAUSA),
    ];
  }),
  exec: (s, i) => {
    const set = s.sets[i]!;
    if (s.week > 10 || s.week === 8) return null;
    if (s.week === 6 && s.tag === 'volumen') return { kg: null, reps: null, rpe: null, status: 'skipped' };
    if (s.week === 4 && s.tag === 'pesada' && i === 3) return null;
    const rpe = set.warmup ? null : s.tag === 'pesada' && s.week >= 7 ? 8 : null;
    return { kg: set.kg, reps: set.reps, rpe, pain: null };
  },
  checkins: (w) => (w <= 3 ? { sleep: 7, energy: 7, motivation: 7, stress: 4, pain: 2 } : null),
  fatigue: () => null,
};

/* ---------- E · Redistribución ---------- */
const caseE: LabCase = {
  key: 'E',
  name: 'LAB-E · Redistribución de frecuencia (ficticio)',
  summary:
    'La frecuencia pasa de 2 a 3 sesiones por semana manteniendo el NL semanal (50 repeticiones), con cargas y distribución distintas.',
  explores:
    'Que el sistema distinga NL semanal igual de distribución distinta; identidad de exposición vs ubicación; si el cambio de frecuencia se trata como cambio de estímulo.',
  incompatible:
    'Un aumento o descenso de "dosis semanal" (el NL no cambia), o confundir las nuevas sesiones con otros ejercicios (es la misma exposición).',
  indeterminate:
    'Si la nueva distribución rinde mejor o peor: con 6 semanas por esquema no se puede concluir.',
  contains:
    'SQ semanas 1–6: lunes y jueves 5×5 a 125 kg; semanas 7–12: lunes, miércoles y viernes (3×6 a 120, 3×6 a 120, 2×7 a 115), NL 50 en ambos esquemas; publicado en dos versiones (la segunda al inicio de la semana 7).',
  modify:
    'Movela a otra frecuencia con "mover sesión" o "repetir estructura", compará semanas con week-compare y mirá NL/series/tonelaje por semana.',
  invariant: 'NL semanal = 50 en las 12 semanas; exposición `sq-primaria` en todas.',
  limitations:
    'El tonelaje y la intensidad media sí cambian (carga menor por serie). No hay cuestionarios de contraste.',
  cutoffs: [
    { weekEnd: 6, note: 'solo el esquema de 2 sesiones' },
    { weekEnd: 9, note: 'esquema nuevo, 3 semanas' },
    { weekEnd: 12, note: 'ambos esquemas completos' },
  ],
  params: { perLift: { SQ: minChange }, families: { dist: { objective: 'fuerza' } } },
  refs: [{ exerciseName: 'Squat comp', kg: 155, asOf: 1, source: 'test', note: 'test ficticio' }],
  weeks: 12,
  executedWeeks: 12,
  objective: 'fuerza',
  blocks: [
    { from: 1, to: 6, objective: 'fuerza', family: 'dist' },
    { from: 7, to: 12, objective: 'fuerza', family: 'dist' },
  ],
  publishAtWeek: [1, 7],
  sessions: Array.from({ length: 12 }, (_, i) => i + 1).flatMap((w) =>
    w <= 6
      ? [
          mk(w, 1, 'SQ', 'Squat comp', 'lun', [warm(60), ...reps(5, 125, 5, 8)]),
          mk(w, 4, 'SQ', 'Squat comp', 'jue', reps(5, 125, 5, 8)),
        ]
      : [
          mk(w, 1, 'SQ', 'Squat comp', 'lun', [warm(60), ...reps(3, 120, 6, 7.5)]),
          mk(w, 3, 'SQ', 'Squat comp', 'mie', reps(3, 120, 6, 7.5)),
          mk(w, 5, 'SQ', 'Squat comp', 'vie', reps(2, 115, 7, 7.5)),
        ],
  ),
  exec: (s, i) => {
    const set = s.sets[i]!;
    return { kg: set.kg, reps: set.reps, rpe: set.warmup ? null : s.week <= 6 ? 8 : 7.5 };
  },
  checkins: () => ({ sleep: 7, energy: 7, motivation: 7, stress: 4, pain: 2 }),
  fatigue: () => 5,
};

/* ---------- F · Posible oportunidad ---------- */
const F_SQ = [125, 125, 127.5, 130, 130, 132.5, 135, 135, 137.5, 137.5, 137.5, 137.5];
const F_BP = [90, 92.5, 92.5, 95, 95, 97.5, 100, 100, 100, 100, 100, 100];
const F_BP_RPE = [8.5, 8.5, 8.5, 9, 8.5, 9, 9, 8, 7.5, 7, 7, 7];
const caseF: LabCase = {
  key: 'F',
  name: 'LAB-F · Posible oportunidad (ficticio)',
  summary:
    'Progresión de 9 semanas seguida de 3 semanas con carga sostenida, menos series, esfuerzo menor y cuestionarios favorables.',
  explores:
    'Si el historial alcanza para evaluar una ventana de expresión y un candidato a PR, y cómo se explican sus límites (extrapolación, sensibilidad al RPE).',
  incompatible:
    'Una garantía ("PR asegurado", "pico confirmado") o una predicción de fecha: el sistema no hace ninguna de las dos.',
  indeterminate:
    'Que haya oportunidad real: el estado puede quedar "pendiente de evaluación" o sin señal. Mirá los límites declarados antes de decidir.',
  contains:
    'SQ semanas 1–9 progresivas (125→137,5) y semanas 10–12 con 3→2 series; BP semanal (90→100 kg) con RPE de 8,5–9 que baja a 7 en las últimas 4 semanas; referencias 160 (SQ) y 125 (BP); revisión técnica válida; competencia ficticia en la semana 16.',
  modify:
    'Subí el RPE de las últimas semanas de BP, cambiá la referencia o el RPE de PR en parámetros y re-evaluá; probá cortes anteriores.',
  invariant: 'Las semanas 1–8 de ambas barras.',
  limitations: 'El historial de BP es corto para extrapolar; ninguna señal es una predicción validada.',
  cutoffs: [
    { weekEnd: 8, note: 'antes del sostenimiento' },
    { weekEnd: 10, note: 'inicio del sostenimiento (semanas 11–12 existen y no deben usarse)' },
    { weekEnd: 12, note: 'historial completo' },
  ],
  params: { perLift: { SQ: minChange, BP: minChange }, families: { pico: { objective: 'pico' } } },
  refs: [
    { exerciseName: 'Squat comp', kg: 160, asOf: 1, source: 'test', note: 'test ficticio' },
    { exerciseName: 'Bench comp', kg: 125, asOf: 1, source: 'test', note: 'test ficticio' },
  ],
  weeks: 16,
  executedWeeks: 12,
  objective: 'pico',
  blocks: [1, 5, 9, 13].map((f) => ({
    from: f,
    to: f + 3,
    objective: f >= 9 ? 'pico' : 'fuerza',
    family: 'pico',
  })),
  publishAtWeek: [1, 5, 9, 13],
  sessions: Array.from({ length: 16 }, (_, i) => i + 1).flatMap((w) => {
    const sq = F_SQ[w - 1] ?? 137.5;
    const bp = F_BP[w - 1] ?? 100;
    return [
      mk(w, 1, 'SQ', 'Squat comp', 'sq', [warm(60), ...reps(w >= 10 ? (w >= 11 ? 2 : 3) : 3, sq, 5, 8)]),
      mk(w, 3, 'BP', 'Bench comp', 'bp', [warm(50), ...reps(3, bp, 5, 8)]),
    ];
  }),
  exec: (s, i) => {
    if (s.week > 12) return null;
    const set = s.sets[i]!;
    if (set.warmup) return { kg: set.kg, reps: 5, rpe: null };
    if (s.tag === 'bp') return { kg: set.kg, reps: 5, rpe: F_BP_RPE[s.week - 1]! };
    return { kg: set.kg, reps: 5, rpe: s.week <= 9 ? 8 : s.week === 10 ? 7.5 : 7 };
  },
  checkins: (w) => ({ sleep: 8, energy: w >= 10 ? 9 : 8, motivation: 8, stress: 3, pain: 2 }),
  fatigue: (_w, tag) => (tag === 'sq' || tag === 'bp' ? 4 : null),
  extra: async (ctx, id, d) => {
    await ctx.history.upsertReview(id, {
      lift: 'BP',
      date: d(11, 3),
      verdict: 'valida',
      note: 'técnica comparable (ficticio)',
    });
    await ctx.history.addCompetition(id, { name: 'Competencia ficticia', date: d(16, 6), phase: 'Pico' });
  },
};

export const LAB_CASES: LabCase[] = [caseA, caseB, caseC, caseD, caseE, caseF];

const weekday = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export interface LabCreated {
  key: string;
  name: string;
  id: string;
  cutoffs: { date: string; note: string }[];
}

/** Crea los casos con un reloj controlado (fechas de publicación coherentes con la historia). Requiere una BD NUEVA. */
export async function createLab(
  ctx: AppContext,
  clock: { value: string },
  start: string,
  log: (m: string) => void = () => {},
  only?: string[],
): Promise<LabCreated[]> {
  const out: LabCreated[] = [];
  const dateOf = (week: number, day: number) => addDays(start, (week - 1) * 7 + (day - 1));
  for (const c of LAB_CASES) {
    if (only && !only.includes(c.key)) continue;
    const a = await ctx.athletes.create(c.name, { SQ: 'Squat comp', BP: 'Bench comp', DL: 'Deadlift comp' });
    await ctx.athletes.setParams(a.id, c.params);
    const blockOf = (w: number) => c.blocks.find((b) => w >= b.from && w <= b.to)!;
    const blockKey = (w: number) => `${c.key}-M${c.blocks.indexOf(blockOf(w)) + 1}`;
    const planned: PlannedSet[] = [];
    for (const s of c.sessions) {
      const date = dateOf(s.week, s.day);
      const b = blockOf(s.week);
      const ref = c.refs
        .filter((r) => r.exerciseName === s.exercise && dateOf(r.asOf, 1) <= date)
        .sort((x, y) => y.asOf - x.asOf)[0];
      s.sets.forEach((set, k) => {
        planned.push({
          id: `${c.key.toLowerCase()}-w${s.week}-d${s.day}-${slug(s.exercise)}-${k + 1}`,
          sessionKey: `${c.key.toLowerCase()}-w${s.week}-d${s.day}-${slug(s.exercise)}`,
          slotKey: `${slug(s.exercise)}|D${s.day}`,
          exerciseName: s.exercise,
          lift: s.lift,
          plannedDate: date,
          setNo: k + 1,
          reps: set.reps,
          targetRpe: set.warmup ? null : set.rpe,
          plannedKg: set.kg,
          isWarmup: set.warmup ?? false,
          blockKey: blockKey(s.week),
          weekNo: s.week - b.from + 1,
          dayNo: weekday(date),
          familyKey: b.family,
          refKg: ref ? ref.kg : null,
          exposureId: s.exposureId ?? `${s.lift.toLowerCase()}-primaria`,
          exposureRole: s.role ?? 'primaria',
          priority: s.role === 'secundaria' ? 2 : 1,
          variantKey: s.variant ?? s.exercise,
          copiedFrom: null,
          plannedKgSource: set.kg !== null ? 'fixed' : null,
          protocol: set.protocol ?? null,
        });
      });
    }
    // programación publicada por bloques, cada una con su fecha de publicación (el viernes anterior)
    for (const [i, w] of c.publishAtWeek.entries()) {
      clock.value = addDays(dateOf(w, 1), -3);
      const known = planned.filter((p) => p.plannedDate < dateOf(c.publishAtWeek[i + 1] ?? c.weeks + 1, 1));
      await ctx.plans.importPlan(a.id, {
        sets: known.map((s) => ({ ...s })),
        status: 'aplicado',
        replace: true,
        label: `Publicación semana ${w}`,
      });
    }
    // referencias fechadas
    for (const r of c.refs)
      await ctx.references.add(a.id, {
        exerciseName: r.exerciseName,
        kg: r.kg,
        source: r.source,
        asOf: dateOf(r.asOf, 1),
        note: r.note,
      });
    // programación estructural
    const macro = await ctx.programmingRepo.createMacro(a.id, {
      name: `Macro ${c.key}`,
      startDate: dateOf(1, 1),
      endDate: dateOf(c.weeks, 7),
      objective: c.objective,
      status: 'activo',
    });
    for (const [i, b] of c.blocks.entries())
      await ctx.programmingRepo.upsertMeso(a.id, {
        blockKey: `${c.key}-M${i + 1}`,
        macroId: macro.id,
        name: `Meso ${i + 1} (${b.objective})`,
        startDate: dateOf(b.from, 1),
        endDate: dateOf(b.to, 7),
        objective: b.objective,
      });
    // ejecución (con el id leído del plan guardado, que ya trae las cargas derivadas de protocolos)
    const stored = new Map((await ctx.records.listActivePlanned(a.id)).map((s) => [s.id, s]));
    const actual: ActualSet[] = [];
    for (const s of c.sessions) {
      s.sets.forEach((_set, k) => {
        const id = `${c.key.toLowerCase()}-w${s.week}-d${s.day}-${slug(s.exercise)}-${k + 1}`;
        const sp = stored.get(id);
        if (!sp) return;
        const e = c.exec({ ...s, sets: s.sets.map((x, j) => (j === k ? { ...x, kg: sp.plannedKg } : x)) }, k);
        if (!e) return;
        actual.push({
          plannedSetId: id,
          status: e.status ?? 'done',
          kg: e.kg,
          reps: e.reps,
          rpe: e.rpe,
          performedOn: e.status === 'skipped' ? null : dateOf(s.week, s.day),
          pain: e.pain ?? null,
        });
      });
    }
    await ctx.records.upsertActual(
      a.id,
      actual,
      `${addDays(start, c.executedWeeks * 7)}T12:00:00.000Z`,
      'laboratorio (ficticio)',
    );
    // cuestionarios
    for (let w = 1; w <= c.executedWeeks; w++) {
      const q = c.checkins(w);
      if (q) await ctx.records.upsertCheckIn(a.id, { date: dateOf(w, 7), ...q });
      for (const s of c.sessions.filter((x) => x.week === w)) {
        const fat = c.fatigue(w, s.tag);
        if (
          fat !== null &&
          actual.some(
            (x) =>
              x.plannedSetId.startsWith(`${c.key.toLowerCase()}-w${w}-d${s.day}-`) && x.status === 'done',
          )
        )
          await ctx.history.upsertFeedback(a.id, {
            sessionKey: `${c.key.toLowerCase()}-w${w}-d${s.day}-${slug(s.exercise)}`,
            endFatigue: fat,
          } as SessionFeedback);
      }
    }
    await c.extra?.(ctx, a.id, dateOf);
    // evaluación inicial en el primer corte sugerido con ejecución posterior (la última foto queda visible en el tablero)
    const mid = c.cutoffs[Math.min(1, c.cutoffs.length - 1)]!;
    const cutoffs = c.cutoffs.map((x) => ({ date: dateOf(x.weekEnd, 7), note: x.note }));
    await ctx.evaluation.evaluate(a.id, dateOf(mid.weekEnd, 7));
    log(`+ ${c.name} (${a.id}) · cortes sugeridos: ${cutoffs.map((x) => x.date).join(', ')}`);
    out.push({ key: c.key, name: c.name, id: a.id, cutoffs });
  }
  return out;
}
