import type { EvidenceAssessment } from './evidence.js';
import type { Explanation } from './explain.js';
import type { Lifecycle } from './intervention.js';
import { PARAMS_VERSION, RULES_VERSION, paramsText, type EngineParams } from './params.js';
import type { AthleteEvaluation, Lift } from './types.js';

/** @deprecated Alias legado derivado de `lifecycle`; se conserva solo por compatibilidad con consumidores previos. */
export type CoachDecision = 'Pendiente' | 'Aprobada' | 'Descartada' | 'Atendida';
export const COACH_DECISIONS: readonly CoachDecision[] = ['Pendiente', 'Aprobada', 'Descartada', 'Atendida'];
export type Validity = 'vigente' | 'expirada';

/**
 * Hallazgo del motor + su estado en el ciclo hallazgo → propuesta → decisión → intervención → seguimiento.
 * `lifecycle` es el estado vigente; la intervención con su historial y fechas (decisión ≠ aplicación) vive en `Intervention`.
 */
export interface DecisionRow {
  key: string;
  evaluatedOn: string;
  /** Primera vez que el motor emitió este hallazgo (no cambia al reevaluar). */
  detectedOn: string;
  dataUntil: string;
  lift: Lift;
  exposureId: string;
  status: string;
  ruleId: string;
  rulesVersion: string;
  paramsVersion: string;
  rank: number;
  isPrincipal: boolean;
  summary: string;
  evidence: string[];
  missing: string[];
  alternatives: string[];
  proposal: string;
  reviewWhen: string;
  /** Suficiencia de la evidencia. NO es una probabilidad. Ver `assessment` para actualidad y comparabilidad. */
  sufficiency: string;
  assessment: EvidenceAssessment | null;
  explanation: Explanation | null;
  validity: Validity;
  expiryReason: string;
  lifecycle: Lifecycle;
  interventionId: string | null;
  coachNote: string;
  /** Fecha de la decisión del coach ('' si no hubo). La fecha de aplicación está en la intervención. */
  decidedOn: string;
  /** @deprecated derivado de `lifecycle`. */
  coachDecision: CoachDecision;
  support: string[];
  paramsText: string;
  readiness: string;
}

export const legacyDecision = (l: Lifecycle): CoachDecision =>
  l === 'detectada'
    ? 'Pendiente'
    : l === 'aceptada'
      ? 'Aprobada'
      : l === 'descartada'
        ? 'Descartada'
        : 'Atendida';
export const lifecycleFromLegacy = (d: CoachDecision): Lifecycle =>
  d === 'Pendiente'
    ? 'detectada'
    : d === 'Aprobada'
      ? 'aceptada'
      : d === 'Descartada'
        ? 'descartada'
        : 'revisada';

export const decisionKey = (
  lift: string,
  exposureId: string,
  rule: string,
  dataUntil: string,
  version = RULES_VERSION,
): string => [lift, exposureId || '-', rule, dataUntil || '-', version].join('|');
const ruleKey = (r: Pick<DecisionRow, 'lift' | 'exposureId' | 'ruleId'>) =>
  `${r.lift}|${r.exposureId}|${r.ruleId}`;

/** Evaluación → filas persistibles. Las "sin señal" no principales no se guardan (ruido). */
export function toDecisionRows(ev: AthleteEvaluation, params: EngineParams): DecisionRow[] {
  const rows: DecisionRow[] = [];
  for (const l of Object.keys(ev.lifts) as Lift[]) {
    const le = ev.lifts[l];
    if (!le) continue;
    for (const r of le.results) {
      if (r.status === 'sin_senal' && !r.isPrincipal) continue;
      rows.push({
        key: decisionKey(l, r.exposureId, r.ruleId, r.dataUntil, ev.rulesVersion),
        evaluatedOn: ev.cutoff,
        detectedOn: ev.cutoff,
        dataUntil: r.dataUntil,
        lift: l,
        exposureId: r.exposureId,
        status: r.status,
        ruleId: r.ruleId,
        rulesVersion: ev.rulesVersion,
        paramsVersion: ev.paramsVersion ?? PARAMS_VERSION,
        rank: r.rank,
        isPrincipal: r.isPrincipal,
        summary: r.summary,
        evidence: r.evidence,
        missing: r.missing,
        alternatives: r.alternatives,
        proposal: r.proposal,
        reviewWhen: r.reviewWhen,
        sufficiency: r.sufficiency,
        assessment: r.assessment ?? null,
        explanation: r.explanation ?? null,
        validity: 'vigente',
        expiryReason: '',
        lifecycle: 'detectada',
        interventionId: null,
        coachNote: '',
        decidedOn: '',
        coachDecision: 'Pendiente',
        support: r.support,
        paramsText: paramsText(params, l),
        readiness: le.readiness,
      });
    }
  }
  return rows;
}

/**
 * Fusión IDEMPOTENTE con lo ya guardado. Misma clave ⇒ se actualiza el hallazgo conservando ciclo de vida, intervención, nota, fechas y decisión.
 * Las previas vigentes que ya no aparecen pasan a "expirada" con razón; nunca se borran ni se reescribe una decisión.
 */
export function mergeDecisions(previous: DecisionRow[], fresh: DecisionRow[], cutoff: string): DecisionRow[] {
  const prevByKey = new Map(previous.map((r) => [r.key, r]));
  const freshKeys = new Set(fresh.map((r) => r.key));
  const freshRules = new Set(fresh.map(ruleKey));
  const out: DecisionRow[] = fresh.map((n) => {
    const v = prevByKey.get(n.key);
    return v
      ? {
          ...n,
          detectedOn: v.detectedOn ?? n.detectedOn,
          lifecycle: v.lifecycle,
          interventionId: v.interventionId,
          coachNote: v.coachNote,
          decidedOn: v.decidedOn,
          coachDecision: legacyDecision(v.lifecycle),
        }
      : n;
  });
  for (const v of previous) {
    if (freshKeys.has(v.key)) continue;
    if (v.validity === 'vigente') {
      const reason = freshRules.has(ruleKey(v))
        ? 'reemplazada por una evaluación con datos más recientes'
        : 'la condición de la regla ya no se cumple';
      out.push({
        ...v,
        validity: 'expirada',
        isPrincipal: false,
        expiryReason: `${reason} · corte ${cutoff}`,
      });
    } else out.push(v);
  }
  return out.sort(
    (x, y) =>
      (x.evaluatedOn < y.evaluatedOn ? 1 : x.evaluatedOn > y.evaluatedOn ? -1 : 0) ||
      (x.validity === y.validity ? 0 : x.validity === 'vigente' ? -1 : 1) ||
      x.lift.localeCompare(y.lift) ||
      x.rank - y.rank ||
      x.key.localeCompare(y.key),
  );
}
