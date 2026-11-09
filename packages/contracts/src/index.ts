/**
 * Contratos HTTP compartidos entre api y web. Los esquemas zod validan ENTRADAS; los tipos de salida se reexportan del motor
 * (solo tipos: el front no incluye lógica del motor).
 */
import { z } from 'zod';
import type {
  AthleteEvaluation,
  BlockMetrics,
  BlockSummary,
  ChangeEvent,
  Comparison,
  DecisionRow,
  Deviation,
  Exposure,
  FamilySummary,
  Lift,
  LiftEvaluation,
  Outcome,
  RuleResult,
} from '@coaching/engine';

export type {
  AthleteEvaluation,
  BlockMetrics,
  BlockSummary,
  ChangeEvent,
  Comparison,
  DecisionRow,
  Deviation,
  Exposure,
  FamilySummary,
  Lift,
  LiftEvaluation,
  Outcome,
  RuleResult,
};
export type { CompareRow, LiftChange, Delta, Ttp } from '@coaching/engine';

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha ISO yyyy-mm-dd');
const liftSchema = z.enum(['SQ', 'BP', 'DL']);
const rpe = z.number().min(1).max(10).nullable();

export const liftConfigSchema = z.object({
  minChangePct: z.number().positive().nullable().optional(),
  minChangeKg: z.number().positive().nullable().optional(),
  loadLimitKg: z.number().positive().nullable().optional(),
  prReps: z.number().int().positive().nullable().optional(),
  explorationApproved: z.boolean().optional(),
  stepKg: z.number().positive().nullable().optional(),
  prRpe: z.number().min(6).max(10).nullable().optional(),
  allowSingleMax: z.boolean().nullable().optional(),
  prExtrapolationReps: z.number().int().min(0).nullable().optional(),
  prEffortGap: z.number().min(0).nullable().optional(),
});
export const familyMetaSchema = z.object({
  objective: z.string().max(120).optional(),
  goldenConfirmed: z.boolean().optional(),
});
export const paramsSchema = z
  .object({
    stepKg: z.number().positive(),
    windowDays: z.number().int().positive(),
    rpeTolerance: z.number().min(0),
    minCompliance: z.number().min(0).max(1),
    painBlock: z.number().min(0).max(10),
    loadMaxSteps: z.number().int().positive(),
    prRpe: z.number().min(5).max(10),
    allowSingleMax: z.boolean(),
    prCheckMaxAgeDays: z.number().int().min(0),
    coachReviewValidityDays: z.number().int().positive(),
    peakIndexMin: z.number().min(0).max(100),
    volumeStableN: z.number().int().min(4),
    volumeRecoveryN: z.number().int().min(2),
    trialWeeks: z.number().int().positive(),
    fatigueThreshold: z.number().min(1).max(10),
    freqDeteriorationN: z.number().int().min(2),
    stabilityMinWeeks: z.number().min(1).max(26),
    rpeSensitivity: z.number().min(0).max(2),
    prExtrapolationReps: z.number().int().min(0).max(10),
    prEffortGap: z.number().min(0).max(5),
    familyTolerancePct: z.number().min(0).max(100),
    nExposures: z.number().int().min(2).max(8),
    prevDays: z.number().int().min(14).max(180),
    readinessValidityDays: z.number().int().min(1).max(30),
    loadN: z.number().int().min(1).max(5),
    loadRpeMargin: z.number().min(0).max(2),
    endN: z.number().int().min(2).max(5),
    endStableN: z.number().int().min(4).max(12),
    families: z.record(familyMetaSchema),
    perLift: z.object({ SQ: liftConfigSchema, BP: liftConfigSchema, DL: liftConfigSchema }).partial(),
  })
  .partial();

export const createAthleteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  competitionExercises: z
    .object({ SQ: z.string().min(1), BP: z.string().min(1), DL: z.string().min(1) })
    .partial()
    .default({ SQ: 'Squat comp', BP: 'Bench comp', DL: 'Deadlift comp' }),
});

export const protocolSchema = z.object({
  loadMode: z.enum(['kg', 'pct', 'rpe', 'rpe_cap']),
  pct: z.number().positive().max(150).nullable().default(null),
  capKg: z.number().positive().nullable().default(null),
  segment: z.enum(['top', 'backoff', 'work']).default('work'),
  tempo: z.string().max(40).nullable().default(null),
  pauseSec: z.number().int().min(0).nullable().default(null),
  instructions: z.string().max(500).nullable().default(null),
  /** Qué ve el atleta en este ejercicio (null/ausente = lo habitual). */
  athleteProgression: z.enum(['reps', 'reps_kg']).nullable().optional(),
  athleteView: z.enum(['completo', 'solo_rpe', 'solo_carga', 'rpe_porcentaje']).nullable().optional(),
  /** Tope del rango de repeticiones (reps = mínimo, repsMax = máximo). Ausente/null = repeticiones fijas. */
  repsMax: z.number().int().positive().nullable().optional(),
});

export const plannedSetSchema = z.object({
  id: z.string().min(1),
  sessionKey: z.string().min(1),
  slotKey: z.string().min(1),
  exerciseName: z.string().min(1),
  lift: liftSchema.nullable(),
  plannedDate: iso,
  setNo: z.number().int().positive(),
  reps: z.number().int().positive(),
  targetRpe: rpe,
  plannedKg: z.number().positive().nullable(),
  isWarmup: z.boolean().default(false),
  /** Opcionales: si faltan, el servicio las deriva (bloque B1, semana/día desde la fecha, familia = bloque, sin referencia). */
  blockKey: z.string().min(1).optional(),
  weekNo: z.number().int().positive().optional(),
  dayNo: z.number().int().min(1).max(7).optional(),
  familyKey: z.string().min(1).optional(),
  refKg: z.number().positive().nullable().optional(),
  /** Identidad estable de la exposición. Si falta se deriva del nombre del ejercicio y se marca como tal. */
  exposureId: z.string().min(1).optional(),
  exposureRole: z.enum(['primaria', 'secundaria', 'accesorio']).nullable().optional(),
  priority: z.number().int().min(1).max(5).nullable().optional(),
  /** Criterio de comparabilidad (variante/equipo/protocolo). Por defecto, el nombre del ejercicio. */
  variantKey: z.string().min(1).optional(),
  copiedFrom: z.string().nullable().optional(),
  protocol: protocolSchema.nullable().optional(),
});
export const importPlanSchema = z.object({
  sets: z.array(plannedSetSchema).min(1).max(5000),
  /** 'aplicado' genera versión y evento; 'borrador' guarda una foto sin tocar el plan vigente ni generar eventos. */
  status: z.enum(['aplicado', 'borrador']).default('aplicado'),
  /** Desde cuándo rige. Si falta se estima desde la primera serie que cambió (y se marca como estimada). */
  effectiveOn: iso.optional(),
  label: z.string().max(80).optional(),
  /** true = el payload es el plan COMPLETO: lo que falte se retira (con ejecución → historial; sin ella → se borra). */
  replace: z.boolean().default(false),
});

export const actualSetSchema = z.object({
  plannedSetId: z.string().min(1),
  status: z.enum(['done', 'skipped', 'pending']),
  kg: z.number().positive().nullable(),
  reps: z.number().int().positive().nullable(),
  rpe,
  performedOn: iso.nullable(),
  pain: z.number().min(0).max(10).nullable(),
});
export const importSetsSchema = z.object({
  sets: z.array(actualSetSchema).min(1).max(5000),
  /** Motivo de la edición (queda en la revisión). */
  reason: z.string().max(200).optional(),
});
/** Historial de ediciones de registros (paginado). */
export const revisionsQuerySchema = z.object({
  entity: z.enum(['actual_set', 'checkin', 'session_feedback']).optional(),
  key: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
/** Mapeo persistente de un ejercicio de Hevy (revisable; lift null = sin lift). */
export const hevyExerciseMapSchema = z.object({
  title: z.string().min(1).max(200),
  lift: z.enum(['SQ', 'BP', 'DL']).nullable(),
  variantKey: z.string().max(100).optional(),
  loadKind: z
    .enum(['total', 'per_side', 'machine', 'bodyweight', 'added_bodyweight', 'assisted', 'unknown'])
    .optional(),
});

const scale = z.number().min(1).max(10).nullable();
export const checkInSchema = z.object({
  date: iso,
  sleep: scale,
  energy: scale,
  motivation: scale,
  stress: scale,
  pain: scale,
});
export const sessionFeedbackSchema = z.object({
  sessionKey: z.string().min(1),
  endFatigue: scale,
  note: z.string().max(300).optional(),
});
export const coachReviewSchema = z.object({
  lift: liftSchema,
  date: iso,
  verdict: z.enum(['valida', 'no_comparable', 'observacion']),
  note: z.string().max(300).default(''),
});
export const competitionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  date: iso,
  phase: z.string().max(60).default(''),
});
export const changeCommentSchema = z.object({ coachComment: z.string().max(500) });
export const compareQuerySchema = z.object({
  lift: z.enum(['SQ', 'BP', 'DL', 'ALL']),
  a: z.string().min(1),
  b: z.string().min(1),
  universe: z.enum(['planned', 'actual']).default('planned'),
  scope: z.enum(['shared', 'full']).default('shared'),
});
export const evaluateSchema = z.object({ cutoff: iso.optional() });

export const decisionPatchSchema = z.object({
  coachDecision: z.enum(['Pendiente', 'Aprobada', 'Descartada', 'Atendida']),
  coachNote: z.string().max(500).optional(),
});

export type CreateAthleteInput = z.infer<typeof createAthleteSchema>;
export type ImportPlanInput = z.infer<typeof importPlanSchema>;
export type ImportSetsInput = z.infer<typeof importSetsSchema>;
export type CheckInInput = z.infer<typeof checkInSchema>;
export type ParamsInput = z.infer<typeof paramsSchema>;
export type CompareQuery = z.infer<typeof compareQuerySchema>;
export type DecisionPatchInput = z.infer<typeof decisionPatchSchema>;

/** Resumen para el dashboard (una fila por atleta). */
export interface AthleteSummary {
  id: string;
  name: string;
  lastRecord: string | null;
  evaluatedOn: string | null;
  lifts: Partial<
    Record<Lift, { status: string; summary: string; sufficiency: string; dataUntil: string } | null>
  >;
  pendingDecisions: number;
}
export interface DashboardData {
  today: string;
  cards: { active: number; needReview: number; blocksEnding: number; pendingCheckins: number };
  priorities: {
    athleteId: string;
    athleteName: string;
    lift: Lift;
    status: string;
    summary: string;
    since: string;
  }[];
  opportunities: {
    athleteId: string;
    athleteName: string;
    lift: Lift;
    status: string;
    summary: string;
    key: string;
  }[];
  competitions: {
    id: string;
    athleteId: string;
    athleteName: string;
    name: string;
    date: string;
    daysLeft: number;
    phase: string;
  }[];
  recent: {
    date: string;
    athleteId: string;
    athleteName: string;
    kind: 'sesion' | 'cambio' | 'evaluacion';
    text: string;
  }[];
}
export interface AthleteDetail {
  id: string;
  name: string;
  competitionExercises: Partial<Record<Lift, string>>;
  params: ParamsInput;
  evaluation: AthleteEvaluation | null;
  decisions: DecisionRow[];
}
export interface ApiError {
  error: string;
  details?: unknown;
}

export interface EventWithFollowUp {
  event: ChangeEvent;
  outcomes: Outcome[];
}
export interface HistoryData {
  events: EventWithFollowUp[];
  deviations: Deviation[];
}
export interface BlocksData {
  blocks: BlockSummary[];
  families: FamilySummary[];
}
export interface LoadData {
  planned: BlockMetrics[];
  actual: BlockMetrics[];
}
export type PerformanceData = Partial<
  Record<Lift, { exposures: Exposure[]; records: { reps: number; kg: number; date: string }[] }>
>;
export interface PlanVersionRow {
  id: string;
  seq: number;
  status: 'aplicado' | 'borrador';
  detectedOn: string;
  effectiveOn: string | null;
  label: string;
  sets: number;
}
export interface CheckInRow {
  date: string;
  sleep: number | null;
  energy: number | null;
  motivation: number | null;
  stress: number | null;
  pain: number | null;
  readiness: number | null;
}
export interface SessionRow {
  sessionKey: string;
  date: string;
  lift: Lift | null;
  exerciseName: string;
  blockKey: string;
  weekNo: number;
  dayNo: number;
  endFatigue: number | null;
  /** Ejercicios/exposiciones presentes en la sesión (una sesión puede tener varios). */
  exercises: {
    exposureId: string;
    exerciseName: string;
    lift: Lift | null;
    variantKey: string;
    exposureRole: 'primaria' | 'secundaria' | 'accesorio' | null;
    priority: number | null;
  }[];
  /** Segmentos identificables (top / backoff / work) con los ids de sus series. */
  segments: { segmentKey: string; exposureId: string; segment: string; setIds: string[] }[];
  sets: {
    /** Id estable de la serie prevista: es el que se usa para registrar la ejecución. */
    plannedSetId: string;
    exposureId: string;
    exerciseName: string;
    lift: Lift | null;
    variantKey: string;
    segmentKey: string;
    isWarmup: boolean;
    /** true = ya no está en la programación vigente pero se conserva porque tiene ejecución. */
    retired: boolean;
    priority: number | null;
    refKg: number | null;
    copiedFrom: string | null;
    plannedKgSource: 'fixed' | 'derived' | null;
    protocol: {
      loadMode: 'kg' | 'pct' | 'rpe' | 'rpe_cap';
      pct: number | null;
      capKg: number | null;
      segment: 'top' | 'backoff' | 'work';
      tempo: string | null;
      pauseSec: number | null;
      instructions: string | null;
      athleteProgression?: 'reps' | 'reps_kg' | null;
      athleteView?: 'completo' | 'solo_rpe' | 'solo_carga' | 'rpe_porcentaje' | null;
    } | null;
    setNo: number;
    planned: { reps: number; targetRpe: number | null; kg: number | null };
    actual: {
      status: string;
      kg: number | null;
      reps: number | null;
      rpe: number | null;
      pain: number | null;
      performedOn: string | null;
    } | null;
  }[];
}

/** Nombre del modelo de SI usado en la UI. Un test verifica que coincide con el del motor. */
export const SI_MODEL = 'rts-aprox-v1' as const;

/* ====================== Consolidación: importaciones, referencias, intervenciones, programación ====================== */
import type {
  Explanation,
  FamilySummary as FamilySummaryT,
  Intervention,
  InterventionFollowUp,
  LiftState,
  MacroSummary,
  MesoSummary,
  MetricDefinition,
  MetricResult,
  ObservedSet,
  PeriodComparison,
  PlanTemplate,
  Preview,
  ReplayReport,
  StrengthReference,
} from '@coaching/engine';
export type {
  Explanation,
  Intervention,
  InterventionFollowUp,
  LiftState,
  MacroSummary,
  MesoSummary,
  MetricDefinition,
  MetricResult,
  ObservedSet,
  PeriodComparison,
  PlanTemplate,
  Preview,
  ReplayReport,
  StrengthReference,
};
export type { FamilySummaryT };

const iso2 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha ISO yyyy-mm-dd');
const csvText = z.string().min(1).max(20_000_000);

/** Importación de Hevy: primero `dry_run` (no escribe), después `apply` con el `confirmToken` de lo que se vio. */
export const hevyImportSchema = z.object({
  csv: csvText,
  mode: z.enum(['dry_run', 'apply']).default('dry_run'),
  timeZone: z.string().max(60).optional(),
  exerciseMap: z
    .record(
      z.object({
        exerciseId: z.string().optional(),
        lift: z.enum(['SQ', 'BP', 'DL']).nullable().optional(),
        variantKey: z.string().optional(),
        loadKind: z
          .enum(['total', 'per_side', 'machine', 'bodyweight', 'added_bodyweight', 'assisted', 'unknown'])
          .optional(),
      }),
    )
    .optional(),
  confirmToken: z.string().optional(),
});
export const planCsvImportSchema = z.object({
  csv: csvText,
  mode: z.enum(['dry_run', 'apply']).default('dry_run'),
  status: z.enum(['aplicado', 'borrador']).default('aplicado'),
  replace: z.boolean().default(false),
  effectiveOn: iso2.optional(),
  label: z.string().max(80).optional(),
  confirmToken: z.string().optional(),
});

export const strengthReferenceSchema = z.object({
  exerciseName: z.string().min(1),
  kg: z.number().positive().max(1000),
  source: z.enum(['test', 'competencia', 'estimada_curva', 'estimada_formula', 'decision_del_coach']),
  asOf: iso2,
  note: z.string().max(300).default(''),
});

const lifecycle = z.enum([
  'detectada',
  'revisada',
  'aceptada',
  'descartada',
  'aplicada',
  'seguimiento',
  'cerrada',
]);
export const interventionCreateSchema = z.object({
  /** Clave de la propuesta (DecisionRow.key). Sin clave = intervención manual del coach. */
  proposalKey: z.string().min(1).optional(),
  lift: z.enum(['SQ', 'BP', 'DL']).optional(),
  exposureId: z.string().optional(),
  on: iso2.optional(),
  appliedOn: iso2.optional(),
  appliedDescription: z.string().max(500).optional(),
  linkedEventId: z.string().optional(),
  coachNote: z.string().max(500).optional(),
});
export const interventionTransitionSchema = z.object({
  to: lifecycle,
  on: iso2.optional(),
  note: z.string().max(500).optional(),
  appliedOn: iso2.optional(),
  appliedDescription: z.string().max(500).optional(),
  deviatesFromProposal: z.boolean().optional(),
  linkedEventId: z.string().optional(),
});

const selection = z
  .object({
    blockKey: z.string().optional(),
    weeks: z.array(z.number().int().positive()).optional(),
    sessionKeys: z.array(z.string()).optional(),
    exposureIds: z.array(z.string()).optional(),
    setIds: z.array(z.string().min(1)).max(2000).optional(),
    segmentKeys: z.array(z.string().min(1)).max(500).optional(),
    lift: z.enum(['SQ', 'BP', 'DL']).optional(),
    // estricto: una clave mal escrita (p. ej. `weekNo`) NO debe ensanchar la selección en silencio
  })
  .strict();
/** Operaciones de programación. `preview` no guarda; `draft` guarda un borrador; `apply` aplica (una versión, un evento). */
const programOpsBase = [
  z.object({
    type: z.literal('duplicate_session'),
    sessionKey: z.string(),
    newSessionKey: z.string(),
    plannedDate: iso2,
    dayNo: z.number().int().min(1).max(7).optional(),
    weekNo: z.number().int().positive().optional(),
    blockKey: z.string().optional(),
    slotKey: z.string().optional(),
    replaceExisting: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('repeat_week'),
    blockKey: z.string(),
    sourceWeek: z.number().int().positive(),
    targetWeek: z.number().int().positive(),
    shiftDays: z.number().int().optional(),
    targetStartDate: iso2.optional(),
    replaceExisting: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('repeat_structure'),
    blockKey: z.string(),
    sourceWeek: z.number().int().positive(),
    targetWeeks: z.array(z.number().int().positive()).min(1),
    replaceExisting: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('apply_template'),
    templateId: z.string(),
    blockKey: z.string(),
    weekNo: z.number().int().positive(),
    startDate: iso2,
    familyKey: z.string().optional(),
    replaceExisting: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('change_protocol'),
    selection,
    change: z.object({
      reps: z.number().int().positive().optional(),
      targetRpe: z.number().min(1).max(10).nullable().optional(),
      plannedKg: z.number().positive().nullable().optional(),
      protocol: protocolSchema.partial().nullable().optional(),
      variantKey: z.string().optional(),
      exerciseName: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('move_session'),
    sessionKey: z.string(),
    plannedDate: iso2,
    dayNo: z.number().int().min(1).max(7).optional(),
    /** Número de semana al que pasa la sesión (si se omite, se conserva). */
    weekNo: z.number().int().positive().optional(),
    slotKey: z.string().optional(),
  }),
] as const;
const programOpFields = {
  mode: z.enum(['preview', 'draft', 'apply']).default('preview'),
  label: z.string().max(80).optional(),
  effectiveOn: iso2.optional(),
  /** Versión aplicada sobre la que se calculó la vista previa. Si el plan cambió, se rechaza con 409 (sin sobrescribir). */
  baseVersionId: z.string().min(1).nullable().optional(),
};
export const programOpSchema = z.object({
  ...programOpFields,
  op: z.discriminatedUnion('type', programOpsBase),
});
/** Extensión (aditiva): quitar series seleccionadas y agregar series nuevas con vista previa. No altera el tipo `ProgramOpInput` existente. */
export const programOpFullSchema = z.object({
  ...programOpFields,
  op: z.discriminatedUnion('type', [
    ...programOpsBase,
    z.object({ type: z.literal('remove_sets'), selection }),
    z.object({ type: z.literal('add_sets'), sets: z.array(plannedSetSchema).min(1).max(500) }),
  ]),
});
export const saveTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  blockKey: z.string(),
  weekNo: z.number().int().positive(),
});
export const macroSchema = z.object({
  name: z.string().trim().min(1).max(80),
  startDate: iso2,
  endDate: iso2.nullable().default(null),
  objective: z.string().max(120).nullable().default(null),
  status: z.enum(['activo', 'cerrado', 'planificado']).default('activo'),
});
export const mesoSchema = z.object({
  blockKey: z.string().min(1),
  macroId: z.string().nullable().default(null),
  name: z.string().trim().min(1).max(80),
  startDate: iso2.nullable().default(null),
  endDate: iso2.nullable().default(null),
  objective: z.string().max(120).nullable().default(null),
});
export const microSchema = z.object({
  blockKey: z.string().min(1),
  weekNo: z.number().int().positive(),
  startDate: iso2,
  endDate: iso2,
});
export const exposureLinkSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  note: z.string().max(300).default(''),
});
export const replaySchema = z.object({
  from: iso2,
  to: iso2,
  step: z.enum(['weekly', 'sessions']).default('weekly'),
  horizonN: z.number().int().min(2).max(8).optional(),
});
export const periodQuerySchema = z.object({
  from: iso2,
  to: iso2,
  lift: z.enum(['SQ', 'BP', 'DL', 'ALL']).default('ALL'),
  exercise: z.string().optional(),
  referenceMode: z.enum(['original', 'retrospective']).default('original'),
});
export const abQuerySchema = z.object({
  aFrom: iso2,
  aTo: iso2,
  bFrom: iso2,
  bTo: iso2,
  lift: z.enum(['SQ', 'BP', 'DL', 'ALL']).default('ALL'),
  exercise: z.string().optional(),
});
export const sourceQuerySchema = z.object({ source: z.string().optional(), cutoff: iso2.optional() });

export type HevyImportInput = z.infer<typeof hevyImportSchema>;
export type PlanCsvImportInput = z.infer<typeof planCsvImportSchema>;
export type ProgramOpInput = z.infer<typeof programOpSchema>;
export type ProgramOpFullInput = z.infer<typeof programOpFullSchema>;
export type InterventionCreateInput = z.infer<typeof interventionCreateSchema>;
export type InterventionTransitionInput = z.infer<typeof interventionTransitionSchema>;

/** Resumen explicativo multidimensional que consume el frontend. */
export interface AthleteStateData {
  cutoff: string;
  rulesVersion: string;
  paramsVersion: string;
  lifts: Partial<Record<Lift, LiftState>>;
  missingConfig: { id: string; lift: Lift; label: string; suspends: string[] }[];
  legacyEvaluation: boolean;
  /** Vigencia de la última evaluación: `inputsChangedSinceEvaluation` true = hubo cambios en las entradas conocidas a ese corte (null = evaluación sin huella). */
  freshness?: {
    evaluatedCutoff: string;
    storedFingerprint: string | null;
    currentFingerprint: string;
    inputsChangedSinceEvaluation: boolean | null;
  } | null;
}
export interface MetricsData {
  cutoff: string;
  period: { from: string; to: string };
  source: string;
  referenceMode: 'original' | 'retrospective';
  metrics: Record<string, MetricResult>;
}
export interface ImportPreviewResponse {
  mode: 'dry_run' | 'apply';
  preview: unknown;
  applied: { batchId: string; inserted: number; ignored: number } | null;
}

/* ---------- Proyección de rendimiento (experimental) ---------- */
export type { PerformanceProjection, ProjectionSummary } from '@coaching/engine';
export const performanceProjectionQuerySchema = z
  .object({
    lift: z.enum(['SQ', 'BP', 'DL']).optional(),
    exercise: z.string().min(1).optional(),
    exposureId: z.string().min(1).optional(),
    variantKey: z.string().min(1).optional(),
    variable: z.enum(['e1rm_table_rpe', 'e1rm_prg_formulas']).default('e1rm_table_rpe'),
    source: z.string().min(1).optional(),
    cutoff: iso2.optional(),
    horizonDays: z.coerce.number().int().min(1).max(365).optional(),
    macroId: z.string().min(1).optional(),
    blockKey: z.string().min(1).optional(),
    from: iso2.optional(),
    to: iso2.optional(),
    scope: z.enum(['history', 'view']).default('history'),
    aggregate: z.enum(['best', 'median']).optional(),
    levelK: z.coerce.number().int().min(1).max(10).optional(),
    halfLifeDays: z.coerce.number().min(1).max(365).optional(),
    rangeNominal: z.coerce.number().min(0.5).max(0.99).optional(),
  })
  .superRefine((q, ctx) => {
    if (!q.lift && !q.exercise && !q.exposureId)
      ctx.addIssue({ code: 'custom', message: 'Indicá lift, exercise o exposureId', path: ['lift'] });
    if (q.from && q.to && q.from > q.to)
      ctx.addIssue({ code: 'custom', message: 'from no puede ser posterior a to', path: ['from'] });
    const views = [q.blockKey ? 1 : 0, q.macroId ? 1 : 0, q.from || q.to ? 1 : 0].reduce((a, b) => a + b, 0);
    if (views > 1)
      ctx.addIssue({
        code: 'custom',
        message: 'Usá un solo selector de vista: blockKey, macroId o from/to',
        path: ['blockKey'],
      });
    if (q.scope === 'view' && views === 0)
      ctx.addIssue({
        code: 'custom',
        message: 'scope=view requiere blockKey, macroId o from/to',
        path: ['scope'],
      });
  });
export type PerformanceProjectionQuery = z.infer<typeof performanceProjectionQuerySchema>;

/** Identificación de la instancia (`GET /api/instance`, y resumen en `GET /api/health`). */
export interface InstanceData {
  mode: 'laboratory' | 'personal' | 'unspecified';
  fictitious: boolean | null;
  datasetId: string | null;
  label: string | null;
  createdAt: string | null;
  cases: {
    key: string;
    name: string;
    athleteId: string;
    summary: string;
    explores: string;
    objective: string;
    cutoffs: { date: string; note: string }[];
  }[];
}

/* ---------- Variables núcleo (NL, SI, tonelaje, volumen muscular, fatiga) ---------- */
export type {
  CoreResult,
  SessionRow as CoreSessionRow,
  WeekRow as CoreWeekRow,
  CoreBundle,
  MuscleVolume,
  BetweenSets,
} from '@coaching/engine';
export const coreQuerySchema = z
  .object({
    from: iso2,
    to: iso2,
    cutoff: iso2.optional(),
    lift: z.enum(['SQ', 'BP', 'DL']).optional(),
    source: z.string().min(1).optional(),
    /** Dominio de la curva RPE para el e1RM por curva (SI no depende de esto). */
    domain: z.enum(['recomendado', 'amplio']).default('recomendado'),
    /** Qué filas devolver: totales + semanas, + sesiones (detalle), o todo. */
    view: z.enum(['weeks', 'sessions', 'all']).default('all'),
    /** realizado = solo lo ejecutado; previsto = la prescripción (series, reps, kg y RPE objetivo) tratada como dosis planificada. */
    basis: z.enum(['realizado', 'previsto']).default('realizado'),
  })
  .refine((q) => q.from <= q.to, { message: 'from no puede ser posterior a to', path: ['from'] });
export type CoreQuery = z.infer<typeof coreQuerySchema>;

/* ---------- Tablas (RPE, RM, SI, fórmulas) ---------- */
export const loadTableQuerySchema = z.object({
  e1rm: z.coerce.number().positive().max(1500),
  stepKg: z.coerce.number().positive().max(50).default(2.5),
});
export const prgSiTableQuerySchema = z.object({
  pctFrom: z.coerce.number().min(1).max(200).optional(),
  pctTo: z.coerce.number().min(1).max(200).optional(),
  pctStep: z.coerce.number().min(0.5).max(50).optional(),
  repsMax: z.coerce.number().int().min(1).max(50).optional(),
});
