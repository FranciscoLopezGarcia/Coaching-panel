import type { MethodRef } from './e1rm-methods.js';
import type { RecordRef } from './metric-result.js';

/**
 * Candidato a récord, estructurado. Tipo único soportado hoy: récord de CARGA para repeticiones (con RPE objetivo acotado).
 * Un mejor e1RM no es un PR real; el single máximo está apagado salvo habilitación explícita.
 * Toda estimación es una lectura bajo escenarios de RPE, NO un intervalo estadístico ni una probabilidad de éxito.
 */
export type PrRecordType = 'load_for_reps' | 'single' | 'reps_at_load' | 'rpe_comparable';

export interface PrScenario {
  /** Desplazamiento de RPE (hacia arriba) aplicado a los benchmarks. 0 = lectura tal como se registró. */
  rpeShift: number;
  /** E conservadora (mínimo entre benchmarks) con ese desplazamiento. */
  eCons: number;
  /** Carga candidata redondeada hacia abajo al paso de carga del equipamiento. */
  kg: number;
  /** ¿La carga candidata supera el récord previo en al menos un paso (y respeta el límite del coach)? */
  holds: boolean;
}

export interface PrCandidate {
  type: PrRecordType;
  exercise: string;
  variantKey: string;
  /** Condiciones conocidas de las exposiciones usadas (variante, equipo, tipo de carga). */
  conditions: string[];
  previousRecord: { kg: number; reps: number; date: string; setRef: RecordRef } | null;
  protocol: { reps: number; rpe: number; kg: number };
  step: number;
  method: MethodRef;
  scenarios: PrScenario[];
  reference: {
    benchmarkReps: number[];
    benchmarkRpeMean: number | null;
    attemptRpe: number;
    effortGap: number | null;
  };
  recency: { lastBenchmark: string; daysSince: number; checkIn: string | null; coachReview: string | null };
  comparability: string;
  flags: {
    /** Las repeticiones del intento difieren demasiado de las de los benchmarks. */
    extrapolatedReps: boolean;
    /** El RPE del intento supera por mucho el esfuerzo con el que se hicieron los benchmarks. */
    extrapolatedEffort: boolean;
    /** La oportunidad desaparece si el RPE reportado estaba subestimado dentro del escenario de sensibilidad. */
    sensitiveToRpe: boolean;
    /** La carga candidata es exactamente récord + un paso. */
    marginal: boolean;
  };
  /** Condiciones pendientes de revisión del coach. */
  pendingConditions: string[];
  readiness: 'listo' | 'pendiente_validacion' | 'pendiente_evaluacion';
}
