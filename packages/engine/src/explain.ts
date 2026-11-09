import {
  dependenciesOf,
  type EvidenceAssessment,
  type EvidenceDependency,
  type EvidenceItem,
  type Fact,
} from './evidence.js';
import type { RecordRef } from './metric-result.js';
import { PARAMS_VERSION, RULES_VERSION, stepFor, type EngineParams } from './params.js';
import type { Lift, RuleId, RuleResult, Status } from './types.js';

/**
 * Contrato explicativo de una recomendación: qué pasa, por qué, qué revisar o probar, límites y próximo chequeo,
 * con su regla, parámetros, evidencias (con origen y dependencias), faltantes, alternativas descartadas y referencias a los registros.
 * Los textos humanos se pueden rastrear a `facts`, `evidence` y `ruleId`: no dependen de un párrafo generado ni de un LLM.
 */
export interface Explanation {
  ruleId: RuleId;
  ruleVersion: string;
  paramsVersion: string;
  context: {
    lift: Lift;
    exposureId: string;
    cutoff: string;
    period: { from: string; to: string } | null;
    objective: string | null;
  };
  /** Conclusión de la regla (resumen). */
  conclusion: string;
  whatHappens: string;
  why: string[];
  reviewOrTry: string[];
  limits: string[];
  nextCheck: { when: string; criterion: string };
  assessment: EvidenceAssessment | null;
  evidence: EvidenceItem[];
  dependencies: EvidenceDependency[];
  facts: Fact[];
  missing: string[];
  discarded: { ruleId: RuleId; exposureId: string; status: Status; reason: string }[];
  paramsApplied: Record<string, number | boolean | string | null>;
  validity: { evaluatedOn: string; reevaluateWhen: string[]; staleAfter: string | null };
  refs: RecordRef[];
}

const LIMITS: Record<RuleId, string[]> = {
  'B-DOLOR': [
    'Una molestia reportada no es un diagnóstico ni una predicción de lesión.',
    'El número refleja lo que el atleta registró, no su causa.',
  ],
  'B-TECNICA': ['El criterio técnico es del coach: la app no valida técnica ni almacena video.'],
  'R-PROGRESS': [
    'Compara medianas de e1RM por curva: depende de la exactitud del RPE reportado.',
    'No prueba causalidad entre el estímulo y el cambio.',
    'Con el cambio mínimo no definido no se clasifica.',
  ],
  'R-LOAD': [
    'La carga propuesta es una lectura de tabla, no un resultado garantizado: depende del calentamiento y del día.',
    'No busca un PR ni modifica la programación.',
  ],
  'R-END': [
    'Una caída o una meseta no confirman un fin de respuesta: pueden deberse a variables no registradas.',
    'La estabilidad se interpreta según el objetivo del bloque; sin objetivo, la conclusión queda limitada.',
  ],
  'R-PR': [
    'Una oportunidad de récord no es una probabilidad de éxito ni autoriza un intento.',
    'Las lecturas con RPE desplazado son escenarios de sensibilidad, no un intervalo de confianza.',
    'Un mejor e1RM no es un récord real.',
  ],
  'R-EXPRESSION-A': [
    'Reglas de PRG reconstruidas desde texto, no su motor completo verificado.',
    'Una ventana favorable observada no es un pico fisiológico confirmado.',
  ],
  'R-EXPRESSION-B': [
    'Propuesta del proyecto, sin validación prospectiva.',
    'Una ventana favorable observada no es un pico fisiológico confirmado.',
  ],
  'R-VOLUME': [
    'Es un experimento propuesto: no hay evidencia de que más volumen mejore a este atleta.',
    'No se afirma subentrenamiento.',
  ],
  'R-FREQUENCY': [
    'No se atribuye causalidad a la frecuencia si también cambian el volumen, el ejercicio o el esfuerzo.',
    'La fatiga de fin de sesión es un dato reportado.',
  ],
};

const NEXT: Record<RuleId, string> = {
  'B-DOLOR': 'Nuevo registro de molestia o decisión del coach.',
  'B-TECNICA': 'Nueva revisión técnica del coach.',
  'R-PROGRESS': 'Próxima exposición comparable de la misma exposición.',
  'R-LOAD': 'Próxima exposición de la misma exposición.',
  'R-END': 'Próxima exposición comparable de la misma exposición.',
  'R-PR': 'Chequeo del día del intento (check-in o revisión del coach).',
  'R-EXPRESSION-A': 'Próxima sesión del lift.',
  'R-EXPRESSION-B': 'Próxima exposición comparable y nuevo check-in.',
  'R-VOLUME': 'Fin del ensayo propuesto.',
  'R-FREQUENCY': 'Dos o tres exposiciones con el nuevo reparto.',
};

const PARAMS_OF: Record<RuleId, string[]> = {
  'B-DOLOR': ['painBlock'],
  'B-TECNICA': ['coachReviewValidityDays'],
  'R-PROGRESS': ['nExposures', 'windowDays', 'prevDays', 'rpeTolerance', 'minCompliance'],
  'R-LOAD': ['loadN', 'loadRpeMargin', 'loadMaxSteps', 'stepKg', 'nExposures', 'windowDays'],
  'R-END': ['endN', 'endStableN', 'stabilityMinWeeks', 'rpeTolerance', 'minCompliance'],
  'R-PR': [
    'prRpe',
    'stepKg',
    'rpeSensitivity',
    'prExtrapolationReps',
    'prEffortGap',
    'allowSingleMax',
    'prCheckMaxAgeDays',
    'coachReviewValidityDays',
  ],
  'R-EXPRESSION-A': ['peakIndexMin'],
  'R-EXPRESSION-B': ['nExposures', 'windowDays', 'rpeTolerance', 'minCompliance', 'readinessValidityDays'],
  'R-VOLUME': ['volumeStableN', 'volumeRecoveryN', 'trialWeeks', 'minCompliance'],
  'R-FREQUENCY': ['fatigueThreshold', 'freqDeteriorationN', 'rpeTolerance'],
};

const REEVALUATE = [
  'nueva exposición registrada',
  'nuevo check-in',
  'nueva molestia o revisión técnica',
  'cambio de la programación',
  'corrección de un registro',
];

const fmtFact = (x: Fact): string =>
  `${x.label}: ${typeof x.value === 'number' ? Math.round(x.value * 100) / 100 : (x.value ?? '—')}${x.unit ? ` ${x.unit}` : ''}`.replace(
    '.',
    ',',
  );

export function buildExplanation(
  r: RuleResult,
  env: {
    lift: Lift;
    cutoff: string;
    params: EngineParams;
    objective: string | null;
    others: RuleResult[];
    deferredReasons: Map<string, string>;
    limits?: string[];
  },
): Explanation {
  const { dependencies } = dependenciesOf(r.evidenceItems);
  const p = env.params as unknown as Record<string, number | boolean>;
  const applied: Explanation['paramsApplied'] = {};
  for (const id of PARAMS_OF[r.ruleId])
    applied[id] = id === 'stepKg' ? stepFor(env.params, env.lift) : (p[id] ?? null);
  const lc = env.params.perLift[env.lift];
  applied.minChangePct = lc.minChangePct;
  applied.minChangeKg = lc.minChangeKg;
  const discarded: Explanation['discarded'] = [];
  for (const o of env.others) {
    if (o === r) continue;
    const key = `${o.ruleId}@${o.exposureId}`;
    const why =
      env.deferredReasons.get(key) ??
      (o.status === 'sin_senal'
        ? `no se cumplen las condiciones: ${o.summary}`
        : o.status === 'datos_insuficientes'
          ? `abstención por datos: ${o.missing[0] ?? o.summary}`
          : 'señal de menor prioridad; se conserva como secundaria');
    discarded.push({ ruleId: o.ruleId, exposureId: o.exposureId, status: o.status, reason: why });
  }
  const refs: RecordRef[] = [];
  const seen = new Set<string>();
  for (const e of r.evidenceItems)
    for (const ref of e.refs)
      if (!seen.has(`${ref.kind}:${ref.id}`)) {
        seen.add(`${ref.kind}:${ref.id}`);
        refs.push(ref);
      }
  const limits = [...LIMITS[r.ruleId], ...(env.limits ?? []), ...(r.assessment?.reasons ?? [])];
  const last = r.dataUntil || null;
  const stale = last
    ? new Date(Date.parse(`${last}T00:00:00Z`) + env.params.windowDays * 86_400_000)
        .toISOString()
        .slice(0, 10)
    : null;
  return {
    ruleId: r.ruleId,
    ruleVersion: RULES_VERSION,
    paramsVersion: PARAMS_VERSION,
    context: {
      lift: env.lift,
      exposureId: r.exposureId,
      cutoff: env.cutoff,
      period: r.evidenceItems.flatMap((e) => e.refs.map((x) => x.date).filter((d): d is string => !!d)).length
        ? {
            from: r.evidenceItems
              .flatMap((e) => e.refs.map((x) => x.date).filter((d): d is string => !!d))
              .sort()[0] as string,
            to: last ?? env.cutoff,
          }
        : null,
      objective: env.objective,
    },
    conclusion: r.summary,
    whatHappens: r.summary,
    why: r.facts.map(fmtFact),
    reviewOrTry: r.proposal ? [r.proposal] : [],
    limits: [...new Set(limits)],
    nextCheck: { when: r.reviewWhen || 'Con el próximo registro.', criterion: NEXT[r.ruleId] },
    assessment: r.assessment ?? null,
    evidence: r.evidenceItems,
    dependencies,
    facts: r.facts,
    missing: r.missing,
    discarded,
    paramsApplied: applied,
    validity: { evaluatedOn: env.cutoff, reevaluateWhen: REEVALUATE, staleAfter: stale },
    refs,
  };
}
