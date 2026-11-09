import type { Lift } from './types.js';

export const RULES_VERSION = 'reglas-v0.2-propuesta';
/** Versión del registro de parámetros. Cambiar un default o su significado exige subirla. */
export const PARAMS_VERSION = 'params-v2';

/**
 * Tres conceptos que NO son lo mismo y no se intercambian:
 *  - Paso de carga (`stepKg`): incremento mínimo del EQUIPAMIENTO. Define el redondeo de una carga propuesta.
 *  - Cambio mínimo relevante (`minChange*`): cuánto debe variar una medida para INTERPRETARLA como progreso o caída.
 *  - Sensibilidad/incertidumbre del método (`rpeSensitivity`): cuánto puede errar el RPE reportado en un escenario de lectura.
 *    No es un intervalo estadístico ni una probabilidad.
 */
export type ParamConcept =
  | 'ventana'
  | 'umbral'
  | 'paso_de_carga'
  | 'cambio_minimo'
  | 'sensibilidad_metodo'
  | 'habilitacion'
  | 'cantidad';

export interface ParamDef {
  id: string;
  label: string;
  description: string;
  unit: string;
  concept: ParamConcept;
  kind: 'number' | 'integer' | 'boolean';
  default: number | boolean | null;
  /** Dónde puede definirse: global (todos), atleta, o por lift (precedencia lift > atleta > default). */
  scopes: ('global' | 'athlete' | 'lift')[];
  min?: number;
  max?: number;
  /** null = sin default: es un insumo esencial que el coach debe definir. */
  essential?: boolean;
  /** Reglas/interpretaciones que quedan suspendidas si falta este valor esencial. */
  suspendsWhenMissing?: string[];
  provenance: 'propuesta' | 'decision_del_proyecto' | 'equipamiento';
}

/** [propuesta] salvo indicación. Ninguno es un umbral científico ni una constante de RTS/PRG. */
export const PARAM_REGISTRY: ParamDef[] = [
  {
    id: 'nExposures',
    label: 'Exposiciones por ventana',
    description: 'Cuántas exposiciones comparables forman la ventana reciente y la previa.',
    unit: 'exposiciones',
    concept: 'cantidad',
    kind: 'integer',
    default: 3,
    scopes: ['global', 'athlete'],
    min: 2,
    max: 8,
    provenance: 'propuesta',
  },
  {
    id: 'windowDays',
    label: 'Ventana reciente',
    description: 'Las exposiciones recientes deben caer dentro de estos días (antigüedad < valor).',
    unit: 'días',
    concept: 'ventana',
    kind: 'integer',
    default: 21,
    scopes: ['global', 'athlete'],
    min: 7,
    max: 90,
    provenance: 'propuesta',
  },
  {
    id: 'prevDays',
    label: 'Ventana previa',
    description:
      'Las exposiciones previas deben estar hasta este número de días antes de la primera reciente.',
    unit: 'días',
    concept: 'ventana',
    kind: 'integer',
    default: 42,
    scopes: ['global', 'athlete'],
    min: 14,
    max: 180,
    provenance: 'propuesta',
  },
  {
    id: 'readinessValidityDays',
    label: 'Vigencia del check-in semanal',
    description: 'Días durante los que un check-in se considera vigente.',
    unit: 'días',
    concept: 'ventana',
    kind: 'integer',
    default: 7,
    scopes: ['global', 'athlete'],
    min: 1,
    max: 30,
    provenance: 'propuesta',
  },
  {
    id: 'rpeTolerance',
    label: 'Tolerancia de RPE sobre el objetivo',
    description: 'RPE real − objetivo admitido sin considerar exceso de esfuerzo.',
    unit: 'RPE',
    concept: 'umbral',
    kind: 'number',
    default: 0.5,
    scopes: ['global', 'athlete'],
    min: 0,
    max: 2,
    provenance: 'propuesta',
  },
  {
    id: 'minCompliance',
    label: 'Cumplimiento mínimo',
    description: 'Fracción de series de trabajo previstas que deben estar hechas.',
    unit: 'fracción',
    concept: 'umbral',
    kind: 'number',
    default: 0.9,
    scopes: ['global', 'athlete'],
    min: 0.5,
    max: 1,
    provenance: 'propuesta',
  },
  {
    id: 'loadN',
    label: 'Exposiciones holgadas para R-LOAD',
    description: 'Exposiciones consecutivas con RPE por debajo del objetivo.',
    unit: 'exposiciones',
    concept: 'cantidad',
    kind: 'integer',
    default: 2,
    scopes: ['global', 'athlete'],
    min: 1,
    max: 5,
    provenance: 'propuesta',
  },
  {
    id: 'loadRpeMargin',
    label: 'Holgura de RPE para R-LOAD',
    description: 'RPE real ≤ objetivo − holgura.',
    unit: 'RPE',
    concept: 'umbral',
    kind: 'number',
    default: 0.5,
    scopes: ['global', 'athlete'],
    min: 0,
    max: 2,
    provenance: 'propuesta',
  },
  {
    id: 'loadMaxSteps',
    label: 'Salto máximo de carga',
    description: 'Máximo de pasos de carga por encima de la carga actual en una propuesta.',
    unit: 'pasos',
    concept: 'cantidad',
    kind: 'integer',
    default: 1,
    scopes: ['global', 'athlete'],
    min: 1,
    max: 4,
    provenance: 'propuesta',
  },
  {
    id: 'endN',
    label: 'Exposiciones por debajo para R-END',
    description: 'Exposiciones consecutivas por debajo de la mediana previa.',
    unit: 'exposiciones',
    concept: 'cantidad',
    kind: 'integer',
    default: 2,
    scopes: ['global', 'athlete'],
    min: 2,
    max: 5,
    provenance: 'propuesta',
  },
  {
    id: 'endStableN',
    label: 'Exposiciones de estabilidad observada',
    description: 'Exposiciones sin cambio relevante para informar una estabilidad observada.',
    unit: 'exposiciones',
    concept: 'cantidad',
    kind: 'integer',
    default: 6,
    scopes: ['global', 'athlete'],
    min: 4,
    max: 12,
    provenance: 'propuesta',
  },
  {
    id: 'painBlock',
    label: 'Molestia que pide revisión',
    description:
      'Molestia reportada (0–10) en 7 días que pide revisión del coach. No es un diagnóstico ni una predicción de lesión.',
    unit: '0–10',
    concept: 'umbral',
    kind: 'number',
    default: 4,
    scopes: ['global', 'athlete'],
    min: 1,
    max: 10,
    provenance: 'propuesta',
  },
  {
    id: 'stepKg',
    label: 'Paso de carga del equipamiento',
    description:
      'Incremento mínimo de la barra/discos disponibles. Define el redondeo de cargas propuestas; NO es un cambio mínimo relevante.',
    unit: 'kg',
    concept: 'paso_de_carga',
    kind: 'number',
    default: 2.5,
    scopes: ['global', 'athlete', 'lift'],
    min: 0.25,
    max: 25,
    provenance: 'equipamiento',
  },
  {
    id: 'prRpe',
    label: 'RPE objetivo del intento de récord',
    description:
      'RPE con el que se plantea un intento de récord de repeticiones. Configurable; no es universal.',
    unit: 'RPE',
    concept: 'umbral',
    kind: 'number',
    default: 9,
    scopes: ['global', 'athlete', 'lift'],
    min: 6,
    max: 10,
    provenance: 'propuesta',
  },
  {
    id: 'allowSingleMax',
    label: 'Habilitar single máximo',
    description:
      'Permite proponer un récord de single. APAGADO por defecto: requiere habilitación explícita y contexto de testing o competencia.',
    unit: '',
    concept: 'habilitacion',
    kind: 'boolean',
    default: false,
    scopes: ['global', 'athlete', 'lift'],
    provenance: 'decision_del_proyecto',
  },
  {
    id: 'prCheckMaxAgeDays',
    label: 'Antigüedad máxima del chequeo para un intento',
    description: 'Días de antigüedad máxima del check-in para considerar la recuperación actual.',
    unit: 'días',
    concept: 'ventana',
    kind: 'integer',
    default: 2,
    scopes: ['global', 'athlete'],
    min: 0,
    max: 14,
    provenance: 'propuesta',
  },
  {
    id: 'coachReviewValidityDays',
    label: 'Vigencia de la revisión técnica',
    description: 'Días durante los que una revisión técnica válida del coach cuenta.',
    unit: 'días',
    concept: 'ventana',
    kind: 'integer',
    default: 14,
    scopes: ['global', 'athlete'],
    min: 1,
    max: 60,
    provenance: 'propuesta',
  },
  {
    id: 'peakIndexMin',
    label: 'PeakIndex mínimo (modo A de expresión)',
    description:
      'Porcentaje mínimo de series ≥ 85 % de la referencia en 7 días (regla del Glosario de PRG reconstruida desde texto).',
    unit: '%',
    concept: 'umbral',
    kind: 'number',
    default: 15,
    scopes: ['global', 'athlete'],
    min: 0,
    max: 100,
    provenance: 'propuesta',
  },
  {
    id: 'stabilityMinWeeks',
    label: 'Duración mínima para hablar de meseta',
    description:
      'Semanas de estabilidad observada necesarias para que, con objetivo de progreso, se informe una posible meseta (no un fin de respuesta automático).',
    unit: 'semanas',
    concept: 'umbral',
    kind: 'number',
    default: 4,
    scopes: ['global', 'athlete'],
    min: 1,
    max: 26,
    provenance: 'propuesta',
  },
  {
    id: 'volumeStableN',
    label: 'Benchmarks estables para R-VOLUME',
    description: 'Exposiciones comparables sin cambio relevante exigidas para un ensayo de volumen.',
    unit: 'exposiciones',
    concept: 'cantidad',
    kind: 'integer',
    default: 6,
    scopes: ['global', 'athlete'],
    min: 4,
    max: 12,
    provenance: 'propuesta',
  },
  {
    id: 'volumeRecoveryN',
    label: 'Respuestas de recuperación para R-VOLUME',
    description: 'Check-ins estables exigidos.',
    unit: 'respuestas',
    concept: 'cantidad',
    kind: 'integer',
    default: 3,
    scopes: ['global', 'athlete'],
    min: 2,
    max: 8,
    provenance: 'propuesta',
  },
  {
    id: 'trialWeeks',
    label: 'Duración propuesta de un ensayo',
    description: 'Semanas de un ensayo de volumen propuesto.',
    unit: 'semanas',
    concept: 'cantidad',
    kind: 'integer',
    default: 4,
    scopes: ['global', 'athlete'],
    min: 1,
    max: 12,
    provenance: 'propuesta',
  },
  {
    id: 'fatigueThreshold',
    label: 'Fatiga de fin de sesión relevante',
    description: 'Fatiga reportada (1–10) desde la que cuenta para R-FREQUENCY.',
    unit: '1–10',
    concept: 'umbral',
    kind: 'number',
    default: 7,
    scopes: ['global', 'athlete'],
    min: 1,
    max: 10,
    provenance: 'propuesta',
  },
  {
    id: 'freqDeteriorationN',
    label: 'Sesiones con deterioro para R-FREQUENCY',
    description: 'Sesiones comparables con deterioro no programado exigidas.',
    unit: 'sesiones',
    concept: 'cantidad',
    kind: 'integer',
    default: 2,
    scopes: ['global', 'athlete'],
    min: 2,
    max: 6,
    provenance: 'propuesta',
  },
  {
    id: 'rpeSensitivity',
    label: 'Sensibilidad al RPE reportado',
    description:
      'Desplazamiento de RPE (hacia arriba) con el que se recalcula un escenario de lectura. NO es un intervalo de confianza ni un margen de seguridad estadístico.',
    unit: 'RPE',
    concept: 'sensibilidad_metodo',
    kind: 'number',
    default: 0.5,
    scopes: ['global', 'athlete'],
    min: 0,
    max: 2,
    provenance: 'propuesta',
  },
  {
    id: 'prExtrapolationReps',
    label: 'Extrapolación máxima de repeticiones (R-PR)',
    description:
      'Diferencia máxima entre las reps del intento y las reps de los benchmarks antes de marcar extrapolación.',
    unit: 'reps',
    concept: 'umbral',
    kind: 'integer',
    default: 2,
    scopes: ['global', 'athlete', 'lift'],
    min: 0,
    max: 10,
    provenance: 'propuesta',
  },
  {
    id: 'prEffortGap',
    label: 'Brecha máxima de esfuerzo (R-PR)',
    description:
      'Diferencia máxima entre el RPE del intento y el RPE medio de los benchmarks antes de marcar extrapolación de esfuerzo.',
    unit: 'RPE',
    concept: 'umbral',
    kind: 'number',
    default: 2,
    scopes: ['global', 'athlete', 'lift'],
    min: 0,
    max: 5,
    provenance: 'propuesta',
  },
  {
    id: 'familyTolerancePct',
    label: 'Tolerancia de dosis dentro de una familia',
    description:
      'Diferencia relativa máxima de NL semanal entre bloques de una misma familia para considerarlos comparables.',
    unit: '%',
    concept: 'umbral',
    kind: 'number',
    default: 25,
    scopes: ['global', 'athlete'],
    min: 0,
    max: 100,
    provenance: 'propuesta',
  },
  {
    id: 'minChangePct',
    label: 'Cambio mínimo relevante (%)',
    description:
      'Variación relativa mínima de e1RM para interpretarla como progreso o caída. Insumo esencial: sin él no se clasifica.',
    unit: '%',
    concept: 'cambio_minimo',
    kind: 'number',
    default: null,
    scopes: ['athlete', 'lift'],
    min: 0.01,
    max: 50,
    essential: true,
    suspendsWhenMissing: [
      'R-PROGRESS (clasificación)',
      'R-END',
      'R-VOLUME',
      'R-PR (favorabilidad)',
      'TTP: ventana y respuesta favorable',
      'Golden',
    ],
    provenance: 'propuesta',
  },
  {
    id: 'minChangeKg',
    label: 'Cambio mínimo relevante (kg)',
    description:
      'Variación absoluta mínima de e1RM para interpretarla como progreso o caída. Si se definen % y kg se exigen ambos.',
    unit: 'kg',
    concept: 'cambio_minimo',
    kind: 'number',
    default: null,
    scopes: ['athlete', 'lift'],
    min: 0.01,
    max: 100,
    essential: true,
    suspendsWhenMissing: [
      'R-PROGRESS (clasificación)',
      'R-END',
      'R-VOLUME',
      'R-PR (favorabilidad)',
      'TTP: ventana y respuesta favorable',
      'Golden',
    ],
    provenance: 'propuesta',
  },
  {
    id: 'loadLimitKg',
    label: 'Límite de carga del coach',
    description: 'Tope duro de una carga propuesta.',
    unit: 'kg',
    concept: 'umbral',
    kind: 'number',
    default: null,
    scopes: ['lift'],
    min: 1,
    max: 1000,
    provenance: 'propuesta',
  },
  {
    id: 'prReps',
    label: 'Repeticiones del récord a evaluar',
    description:
      'Reps del récord de peso para repeticiones; vacío = se infiere de la próxima sesión o de los benchmarks.',
    unit: 'reps',
    concept: 'cantidad',
    kind: 'integer',
    default: null,
    scopes: ['lift'],
    min: 1,
    max: 15,
    provenance: 'propuesta',
  },
  {
    id: 'explorationApproved',
    label: 'Ensayo exploratorio de volumen confirmado',
    description:
      'El coach confirma un ensayo exploratorio (habilita R-VOLUME sin dosis histórica documentada).',
    unit: '',
    concept: 'habilitacion',
    kind: 'boolean',
    default: false,
    scopes: ['lift'],
    provenance: 'decision_del_proyecto',
  },
];

export interface LiftConfig {
  minChangePct: number | null;
  minChangeKg: number | null;
  loadLimitKg: number | null;
  prReps: number | null;
  explorationApproved: boolean;
  /** Paso de carga propio del lift; null = usa el global. */
  stepKg: number | null;
  prRpe: number | null;
  allowSingleMax: boolean | null;
  prExtrapolationReps: number | null;
  prEffortGap: number | null;
}

/** Parámetros efectivos. Los campos de nivel superior son los defaults/atleta; `perLift` los pisa donde se definió. */
export interface EngineParams {
  nExposures: number;
  windowDays: number;
  prevDays: number;
  readinessValidityDays: number;
  rpeTolerance: number;
  minCompliance: number;
  loadN: number;
  loadRpeMargin: number;
  loadMaxSteps: number;
  endN: number;
  endStableN: number;
  painBlock: number;
  stepKg: number;
  prRpe: number;
  allowSingleMax: boolean;
  prCheckMaxAgeDays: number;
  coachReviewValidityDays: number;
  peakIndexMin: number;
  stabilityMinWeeks: number;
  volumeStableN: number;
  volumeRecoveryN: number;
  trialWeeks: number;
  fatigueThreshold: number;
  freqDeteriorationN: number;
  rpeSensitivity: number;
  prExtrapolationReps: number;
  prEffortGap: number;
  familyTolerancePct: number;
  perLift: Record<Lift, LiftConfig>;
}

const noCfg = (): LiftConfig => ({
  minChangePct: null,
  minChangeKg: null,
  loadLimitKg: null,
  prReps: null,
  explorationApproved: false,
  stepKg: null,
  prRpe: null,
  allowSingleMax: null,
  prExtrapolationReps: null,
  prEffortGap: null,
});

const defaults = (): Record<string, number | boolean> => {
  const o: Record<string, number | boolean> = {};
  for (const d of PARAM_REGISTRY)
    if (
      (d.default !== null && d.scopes.includes('global')) ||
      (d.default !== null && d.scopes.includes('athlete'))
    )
      o[d.id] = d.default as number | boolean;
  return o;
};

export const DEFAULT_PARAMS: EngineParams = {
  ...(defaults() as unknown as Omit<EngineParams, 'perLift'>),
  perLift: { SQ: noCfg(), BP: noCfg(), DL: noCfg() },
};

export type ParamOverrides = Partial<Omit<EngineParams, 'perLift'>> & {
  perLift?: Partial<Record<Lift, Partial<LiftConfig>>>;
};

export function buildParams(o: ParamOverrides = {}): EngineParams {
  const { perLift, ...rest } = o;
  const merged: EngineParams = {
    ...DEFAULT_PARAMS,
    ...rest,
    perLift: { SQ: noCfg(), BP: noCfg(), DL: noCfg() },
  };
  for (const l of ['SQ', 'BP', 'DL'] as Lift[]) merged.perLift[l] = { ...noCfg(), ...(perLift?.[l] ?? {}) };
  return merged;
}

/** Paso de carga del lift (precedencia: lift > global). */
export const stepFor = (p: EngineParams, lift: Lift): number => p.perLift[lift].stepKg ?? p.stepKg;
export const prRpeFor = (p: EngineParams, lift: Lift): number => p.perLift[lift].prRpe ?? p.prRpe;
export const singleMaxAllowed = (p: EngineParams, lift: Lift): boolean =>
  p.perLift[lift].allowSingleMax ?? p.allowSingleMax;
export const prExtrapolationRepsFor = (p: EngineParams, lift: Lift): number =>
  p.perLift[lift].prExtrapolationReps ?? p.prExtrapolationReps;
export const prEffortGapFor = (p: EngineParams, lift: Lift): number =>
  p.perLift[lift].prEffortGap ?? p.prEffortGap;

export interface ParamIssue {
  id: string;
  scope: 'global' | Lift;
  message: string;
}

/** Valida un conjunto de overrides contra el registro (rango, entero, alcance). No lanza: devuelve los problemas. */
export function validateParams(o: ParamOverrides): ParamIssue[] {
  const issues: ParamIssue[] = [];
  const byId = new Map(PARAM_REGISTRY.map((d) => [d.id, d]));
  const check = (id: string, v: unknown, scope: 'global' | Lift) => {
    const d = byId.get(id);
    if (!d) return void issues.push({ id, scope, message: 'Parámetro desconocido' });
    if (v === null || v === undefined) return;
    const where = scope === 'global' ? 'athlete' : 'lift';
    if (!d.scopes.includes(where))
      return void issues.push({ id, scope, message: `No se puede definir a nivel ${where}` });
    if (d.kind === 'boolean')
      return typeof v === 'boolean'
        ? undefined
        : void issues.push({ id, scope, message: 'Debe ser verdadero/falso' });
    if (typeof v !== 'number' || !Number.isFinite(v))
      return void issues.push({ id, scope, message: 'Debe ser un número' });
    if (d.kind === 'integer' && !Number.isInteger(v)) issues.push({ id, scope, message: 'Debe ser entero' });
    if (d.min !== undefined && v < d.min) issues.push({ id, scope, message: `Mínimo ${d.min}` });
    if (d.max !== undefined && v > d.max) issues.push({ id, scope, message: `Máximo ${d.max}` });
  };
  const { perLift, ...rest } = o;
  for (const [k, v] of Object.entries(rest)) check(k, v, 'global');
  for (const l of ['SQ', 'BP', 'DL'] as Lift[])
    for (const [k, v] of Object.entries(perLift?.[l] ?? {})) check(k, v, l);
  return issues;
}

export interface MissingConfig {
  id: string;
  lift: Lift;
  label: string;
  /** Interpretaciones que quedan suspendidas. Las métricas independientes (NL, series, tonelaje, récords…) siguen disponibles. */
  suspends: string[];
  independentMetricsUnaffected: true;
}

/** Qué configuración esencial falta, y qué interpretación queda suspendida. Nunca bloquea métricas independientes. */
export function missingConfig(p: EngineParams, lifts: Lift[] = ['SQ', 'BP', 'DL']): MissingConfig[] {
  const out: MissingConfig[] = [];
  for (const l of lifts) {
    const c = p.perLift[l];
    if ((c.minChangePct ?? 0) <= 0 && (c.minChangeKg ?? 0) <= 0) {
      const d = PARAM_REGISTRY.find((x) => x.id === 'minChangePct') as ParamDef;
      out.push({
        id: 'minChange',
        lift: l,
        label: 'Cambio mínimo relevante (% y/o kg)',
        suspends: d.suspendsWhenMissing ?? [],
        independentMetricsUnaffected: true,
      });
    }
  }
  return out;
}

/** Origen de cada valor efectivo, para auditar la precedencia lift > atleta > default. */
export function paramProvenance(
  stored: ParamOverrides,
): Record<string, 'default' | 'atleta' | { lift: Lift[] }> {
  const out: Record<string, 'default' | 'atleta' | { lift: Lift[] }> = {};
  for (const d of PARAM_REGISTRY) {
    const lifts = (['SQ', 'BP', 'DL'] as Lift[]).filter(
      (l) =>
        (stored.perLift?.[l] as Record<string, unknown> | undefined)?.[d.id] !== undefined &&
        (stored.perLift?.[l] as Record<string, unknown>)[d.id] !== null,
    );
    const athlete = (stored as Record<string, unknown>)[d.id] !== undefined;
    out[d.id] = lifts.length ? { lift: lifts } : athlete ? 'atleta' : 'default';
  }
  return out;
}

export function paramsText(p: EngineParams, lift: Lift): string {
  const c = p.perLift[lift];
  const d = (v: number | null, u: string) => (v === null ? 'no definido' : `${v}${u}`);
  return (
    `${PARAMS_VERSION}; N=${p.nExposures}; ventana=${p.windowDays} d; tolRPE=${p.rpeTolerance}; cumpl≥${Math.round(p.minCompliance * 100)}%; paso=${stepFor(p, lift)} kg; ` +
    `sensibilidad RPE=+${p.rpeSensitivity}; cambio mín. ${lift} = ${d(c.minChangePct, ' %')} / ${d(c.minChangeKg, ' kg')}${c.minChangePct !== null && c.minChangeKg !== null ? ' (se exigen ambos)' : ''}`
  );
}
