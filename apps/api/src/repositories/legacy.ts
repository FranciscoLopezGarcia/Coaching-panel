import {
  legacyDecision,
  lifecycleFromLegacy,
  type CoachDecision,
  type DecisionRow,
  type PlannedSet,
} from '@coaching/engine';

/**
 * Compatibilidad con datos guardados antes de la consolidación (planes y decisiones con el esquema anterior).
 * Nunca inventa correspondencias: lo que no existía queda en su valor neutro y se documenta (ver docs/MIGRACION_Y_COMPATIBILIDAD.md).
 */
type Raw = Record<string, unknown>;

/** Serie de un snapshot viejo (sin identidad de exposición ni protocolo): la identidad es el slot antiguo, tal cual (legacy_slot). */
export function upgradePlannedSet(raw: Raw): PlannedSet {
  const r = raw as unknown as Partial<PlannedSet> & {
    slotKey: string;
    exerciseName: string;
    plannedKg: number | null;
  };
  return {
    ...(r as PlannedSet),
    exposureId: r.exposureId ?? r.slotKey,
    exposureRole: r.exposureRole ?? null,
    priority: r.priority ?? null,
    variantKey: r.variantKey ?? r.exerciseName,
    copiedFrom: r.copiedFrom ?? null,
    plannedKgSource:
      r.plannedKgSource ?? (r.plannedKg !== null && r.plannedKg !== undefined ? 'fixed' : null),
    protocol: r.protocol ?? null,
  };
}

const SUFF: Record<string, 'suficiente' | 'parcial' | 'insuficiente'> = {
  Moderada: 'suficiente',
  Inicial: 'parcial',
  Insuficiente: 'insuficiente',
};

/** Decisión guardada con el esquema anterior: `slotKey`→`exposureId`, `confidence`→`sufficiency`, `coachDecision`→`lifecycle`. */
export function upgradeDecisionRow(raw: Raw): DecisionRow {
  const r = raw as Raw &
    Partial<DecisionRow> & { slotKey?: string; confidence?: string; coachDecision?: CoachDecision };
  const lifecycle = r.lifecycle ?? lifecycleFromLegacy(r.coachDecision ?? 'Pendiente');
  const { slotKey: _slot, confidence: _conf, ...rest } = r;
  void [_slot, _conf];
  return {
    ...(rest as unknown as DecisionRow),
    exposureId: r.exposureId ?? r.slotKey ?? '',
    detectedOn: r.detectedOn ?? (r.evaluatedOn as string),
    paramsVersion: r.paramsVersion ?? 'params-v1',
    sufficiency: r.sufficiency ?? SUFF[r.confidence ?? ''] ?? 'insuficiente',
    assessment: r.assessment ?? null,
    explanation: r.explanation ?? null,
    lifecycle,
    interventionId: r.interventionId ?? null,
    coachDecision: legacyDecision(lifecycle),
  };
}

/** Evaluaciones guardadas antes de la consolidación no traen el estado multidimensional ni la explicación: se piden de nuevo. */
export const isLegacyEvaluation = (payload: Raw): boolean => payload.paramsVersion === undefined;
