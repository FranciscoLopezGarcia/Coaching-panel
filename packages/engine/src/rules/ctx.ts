import type { BlockSummary } from '../blocks.js';
import type { EngineParams, LiftConfig } from '../params.js';
import type { ObservedSet } from '../observed.js';
import type { ActualSet, CoachReview, Lift, PlannedSet, Readiness } from '../types.js';

/** Contexto común de las reglas de un lift: entradas ya filtradas al corte. */
export interface RuleCtx {
  lift: Lift;
  cfg: LiftConfig;
  p: EngineParams;
  cutoff: string;
  actual: Map<string, ActualSet>;
  /** Series previstas del ejercicio de competencia (benchmark) de este lift. */
  bench: PlannedSet[];
  /** Todas las series previstas del lift (cualquier ejercicio). */
  liftPlanned: PlannedSet[];
  allPlanned: PlannedSet[];
  allActual: ActualSet[];
  readinessHistory: Readiness[];
  reviews: CoachReview[];
  feedback: Map<string, number | null>;
  blocks: BlockSummary[];
  /** Observaciones del lift hasta el corte (para récords y métricas descriptivas). */
  observed: ObservedSet[];
  /** Objetivo declarado del bloque vigente (familia). null = no disponible: limita lo que puede concluirse. */
  objective: string | null;
  /** Cambios de estímulo detectados en el plan que afectan a la ventana analizada. */
  stimulusChanges: { id: string; effectiveOn: string; classification: string }[];
}
