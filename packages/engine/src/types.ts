/** Tipos del dominio. El motor no conoce HTTP, SQL ni UI. */
export type Lift = 'SQ' | 'BP' | 'DL';
export const LIFTS: readonly Lift[] = ['SQ', 'BP', 'DL'];

/** Cómo se prescribe la carga de una serie. Las instrucciones libres (`instructions`) NUNCA alimentan cálculos. */
export interface Protocol {
  loadMode: 'kg' | 'pct' | 'rpe' | 'rpe_cap';
  /** % de la referencia (loadMode 'pct'). */
  pct: number | null;
  /** Tope de carga (loadMode 'rpe_cap'): la carga prevista es min(carga por RPE, tope). */
  capKg: number | null;
  segment: 'top' | 'backoff' | 'work';
  tempo: string | null;
  pauseSec: number | null;
  instructions: string | null;
  /** Qué muestra el portal del atleta en este ejercicio (null/ausente = lo habitual del atleta o de la sesión). */
  /** Progresión sugerida visible para el atleta: null/ausente = solo la ve el coach; 'reps' = meta de repeticiones; 'reps_kg' = repeticiones y carga. */
  athleteProgression?: 'reps' | 'reps_kg' | null;
  athleteView?: 'completo' | 'solo_rpe' | 'solo_carga' | 'rpe_porcentaje' | null;
  /** Tope del rango de repeticiones (p. ej. 8–10 ⇒ reps = 8, repsMax = 10). null/ausente = repeticiones fijas. Estructurado: no se interpreta texto libre. */
  repsMax?: number | null;
}

/** Serie PREVISTA (prescripción). Separada siempre de la ejecución. */
export interface PlannedSet {
  id: string;
  /** Sesión prevista (bloque-semana-día). Una exposición = una sesión. */
  sessionKey: string;
  /**
   * IDENTIDAD estable de la exposición dentro del plan (p. ej. "banca-primaria"). Sobrevive a mover la sesión de día o de posición.
   * Compartir identidad NO implica comparabilidad: ver `variantKey`.
   */
  exposureId: string;
  /** Rol de la exposición dentro de la programación (atributo, no identidad). */
  exposureRole: 'primaria' | 'secundaria' | 'accesorio' | null;
  /** Prioridad declarada por el coach (1 = máxima). */
  priority: number | null;
  /**
   * Criterio de comparabilidad del rendimiento: variante/equipo/protocolo. Dos instancias de la misma exposición con distinto `variantKey`
   * NO se comparan entre sí (se segmenta el análisis).
   */
  variantKey: string;
  /** UBICACIÓN en el calendario (día/posición). Es modificable: mover una sesión no rompe la continuidad histórica. */
  slotKey: string;
  /** Linaje: id de la serie de la que se copió esta instancia (null si es original). Cada instancia tiene su propio id. */
  copiedFrom: string | null;
  exerciseName: string;
  lift: Lift | null;
  plannedDate: string; // ISO yyyy-mm-dd
  setNo: number;
  reps: number;
  /** RPE objetivo EXPLÍCITO. Nunca se deriva de kg/referencia. */
  targetRpe: number | null;
  plannedKg: number | null;
  /** 'fixed' = cargado por el coach; 'derived' = calculado desde protocolo + referencia; null = sin carga prevista. */
  plannedKgSource: 'fixed' | 'derived' | null;
  /** Protocolo estructurado (null = solo reps/RPE/kg planos). Las instrucciones libres no se convierten en cálculos. */
  protocol: Protocol | null;
  isWarmup: boolean;
  /** Bloque (macro/meso) al que pertenece la serie. Un bloque tiene varias semanas (microciclos). */
  blockKey: string;
  /** Semana dentro del bloque (1-based). La duración del microciclo se guarda; no se asume 7 días en la lógica de reglas. */
  weekNo: number;
  /** Posición del día dentro de la semana (1-based). */
  dayNo: number;
  /** Familia/versión de microciclo para comparar respuesta entre ciclos (p. ej. "acumulacion-3x6"). */
  familyKey: string;
  /** Referencia 1RM FECHADA con la que se calcula la intensidad relativa (nunca se cambia en silencio). */
  refKg: number | null;
}

/** Serie EJECUTADA (registro del atleta). null = sin dato (nunca 0 por ausencia). */
export interface ActualSet {
  plannedSetId: string;
  status: 'done' | 'skipped' | 'pending';
  kg: number | null;
  reps: number | null;
  rpe: number | null;
  performedOn: string | null;
  /** Molestia 0–10 reportada en la serie. */
  pain: number | null;
}

export interface Readiness {
  date: string;
  /** Disposición 1–10 (promedio propio del check-in; NO es TRAC). */
  value: number;
}

import type { EvidenceAssessment, EvidenceItem, Fact, Sufficiency } from './evidence.js';
import type { PrCandidate } from './pr-candidate.js';
import type { Explanation } from './explain.js';
import type { LiftState } from './state.js';

export type Status =
  | 'revision_coach'
  | 'posible_fin_respuesta'
  | 'datos_insuficientes'
  | 'candidato_pr'
  | 'oportunidad_pendiente'
  | 'ventana_expresion'
  | 'margen_carga'
  | 'progreso_sostenido'
  | 'tendencia_inicial_favorable'
  | 'estabilidad_observada'
  | 'candidato_volumen'
  | 'candidato_frecuencia'
  | 'sin_senal';

export type RuleId =
  | 'B-DOLOR'
  | 'B-TECNICA'
  | 'R-PROGRESS'
  | 'R-LOAD'
  | 'R-END'
  | 'R-PR'
  | 'R-EXPRESSION-A'
  | 'R-EXPRESSION-B'
  | 'R-VOLUME'
  | 'R-FREQUENCY';

/** Fatiga de final de sesión (1–10) registrada por el atleta/coach. null = sin dato. */
export interface SessionFeedback {
  sessionKey: string;
  endFatigue: number | null;
}

/** Revisión técnica opcional del coach (sin video en la app). Sin revisión: "técnica no validada en la app". */
export interface CoachReview {
  lift: Lift;
  date: string;
  verdict: 'valida' | 'no_comparable' | 'observacion';
  note: string;
}

/** Exposición comparable: una sesión de un slot con su mejor e1RM de tabla (E). */
export interface Exposure {
  sessionKey: string;
  exposureId: string;
  /** Variante/protocolo de esta instancia (de `PlannedSet.variantKey`). Define la comparabilidad dentro de la identidad. */
  variantKey: string;
  /** Ubicación calendaria de la instancia (día/posición). Informativa. */
  location: string;
  date: string;
  setsPlanned: number;
  setsDone: number;
  setsSkipped: number;
  compliance: number;
  repsPlanned: number;
  repsDone: number;
  /** Mejor e1RM de tabla entre series hechas CON RPE real; null si ninguna lo tiene. */
  e: number | null;
  best: { setId: string; kg: number; reps: number; rpe: number } | null;
  /** Mediana de (RPE real − RPE objetivo); null si no hay objetivo cargado. */
  rpeDev: number | null;
  doneSetIds: string[];
  plannedSets: PlannedSet[];
}

export interface RuleResult {
  ruleId: RuleId;
  exposureId: string;
  status: Status;
  /** Orden de prioridad (menor = más prioritario). */
  rank: number;
  summary: string;
  evidence: string[];
  missing: string[];
  alternatives: string[];
  proposal: string;
  reviewWhen: string;
  /** Suficiencia de la evidencia (ver `assessment` para actualidad y comparabilidad). NO es una probabilidad. */
  sufficiency: Sufficiency;
  /** Evidencias con origen y fuente, para separar las independientes de las derivadas de las mismas series. */
  evidenceItems: EvidenceItem[];
  /** Hechos numéricos de los que se derivan los textos. */
  facts: Fact[];
  /** Lectura de tendencia de rendimiento (solo R-PROGRESS). */
  trend?: 'mejora' | 'estable' | 'baja';
  /** Candidato a PR estructurado (solo R-PR). */
  candidate?: PrCandidate;
  /** Evaluación explicable; la completa el pipeline. */
  assessment?: EvidenceAssessment;
  /** Contrato explicativo estructurado de este resultado. */
  explanation?: Explanation;
  /** Fecha del último dato usado (clave de idempotencia). */
  dataUntil: string;
  support: string[];
  isPrincipal: boolean;
  /** Subtipo opcional (p. ej. R-END: 'caida' | 'estabilidad'). La estabilidad no es deterioro. */
  tag?: string;
}

export interface DataQuality {
  futureIgnored: number;
  doneWithoutDate: number;
  setsWithoutRpe: number;
  outsideTable: number;
  setsWithoutTargetRpe: number;
  sessionsWithoutRecord: number;
}

export interface LiftEvaluation {
  lift: Lift;
  results: RuleResult[];
  principal: RuleResult | null;
  secondary: RuleResult[];
  quality: DataQuality;
  readiness: string;
  blocked: boolean;
  /** Estado multidimensional, conclusión principal, conflictos y secuencia. */
  state: LiftState;
}

export interface AthleteEvaluation {
  cutoff: string;
  rulesVersion: string;
  paramsVersion: string;
  lifts: Partial<Record<Lift, LiftEvaluation>>;
  /** Resumen por bloque (dosis prevista/realizada, respuesta, TTP observado). */
  blocks: import('./blocks.js').BlockSummary[];
  /** TTP descriptivo y candidatos golden por familia de microciclo. */
  families: import('./blocks.js').FamilySummary[];
  /** Huella de las entradas conocidas al corte con las que se evaluó (detecta cambios posteriores hechos desde cualquier cliente). */
  inputFingerprint?: string;
}
