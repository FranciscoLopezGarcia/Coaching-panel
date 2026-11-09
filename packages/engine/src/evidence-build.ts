import { daysBetween } from './dates.js';
import {
  correlationNote,
  dependenciesOf,
  type Comparability,
  type EvidenceAssessment,
  type EvidenceItem,
} from './evidence.js';
import { median } from './format.js';
import type { RecordRef } from './metric-result.js';
import type { EngineParams } from './params.js';
import type { CoachReview, Exposure, Lift, Readiness, RuleResult, SessionFeedback } from './types.js';

export interface CompatState {
  state: Comparability;
  reasons: string[];
}

export interface EvidenceEnv {
  lift: Lift;
  cutoff: string;
  params: EngineParams;
  /** Exposiciones del lift por clave de sesión. */
  bySession: Map<string, Exposure>;
  latestReadiness: Readiness | null;
  reviews: CoachReview[];
  pain: { max: number | null; refs: RecordRef[] };
  feedback: SessionFeedback[];
  /** Comparabilidad por exposición; '' = lift. */
  comparability: Map<string, CompatState>;
}

const sessionKeys = (r: RuleResult): string[] =>
  r.support.map((x) => /\(([^)]+)\)\s*$/.exec(x)?.[1]).filter((x): x is string => !!x);
const sessRef = (e: Exposure): RecordRef => ({ kind: 'session', id: e.sessionKey, date: e.date });

function performanceItems(r: RuleResult, exps: Exposure[]): EvidenceItem[] {
  if (!exps.length) return [];
  const series = `series:${r.exposureId}`;
  const refs = exps.map(sessRef);
  const items: EvidenceItem[] = [];
  const withE = exps.filter((e) => e.e !== null);
  if (withE.length)
    items.push({
      id: `${r.ruleId}:e1rm`,
      origin: 'rendimiento',
      label: 'e1RM por curva de las exposiciones usadas (mejor serie de cada una)',
      value: withE.at(-1)?.e ?? null,
      unit: 'kg',
      refs,
      derivedFrom: [series],
      independenceGroup: `rendimiento:${r.exposureId}`,
    });
  const devs = exps.map((e) => e.rpeDev).filter((d): d is number => d !== null);
  if (devs.length)
    items.push({
      id: `${r.ruleId}:esfuerzo`,
      origin: 'carga',
      label: 'Desvío de RPE (real − objetivo), mediana',
      value: median(devs),
      unit: 'RPE',
      refs,
      derivedFrom: [series],
      independenceGroup: `rendimiento:${r.exposureId}`,
    });
  items.push({
    id: `${r.ruleId}:cumplimiento`,
    origin: 'cumplimiento',
    label: 'Cumplimiento de series (mínimo de las exposiciones)',
    value: Math.min(...exps.map((e) => e.compliance)),
    refs,
    derivedFrom: [`ejecucion:${r.exposureId}`],
    independenceGroup: `cumplimiento:${r.exposureId}`,
  });
  return items;
}

function readinessItem(env: EvidenceEnv): EvidenceItem | null {
  const rd = env.latestReadiness;
  if (!rd) return null;
  const age = daysBetween(env.cutoff, rd.date);
  return {
    id: 'checkin',
    origin: 'cuestionario',
    label: `Disposición del check-in (propia, no TRAC) del ${rd.date}`,
    value: rd.value,
    unit: '/10',
    refs: [{ kind: 'checkin', id: rd.date, date: rd.date }],
    derivedFrom: ['checkin'],
    independenceGroup: 'cuestionario:checkin',
    stale: age > env.params.readinessValidityDays,
  };
}

/** Completa los ítems de evidencia de un resultado si la regla no los dio ya. */
export function evidenceItemsFor(r: RuleResult, env: EvidenceEnv): EvidenceItem[] {
  if (r.evidenceItems.length) return r.evidenceItems;
  const exps = sessionKeys(r)
    .map((k) => env.bySession.get(k))
    .filter((e): e is Exposure => !!e);
  switch (r.ruleId) {
    case 'B-DOLOR':
      return env.pain.max === null
        ? []
        : [
            {
              id: 'B-DOLOR:molestia',
              origin: 'cuestionario',
              label: 'Molestia máxima reportada en 7 días',
              value: env.pain.max,
              unit: '0–10',
              refs: env.pain.refs,
              derivedFrom: ['molestia'],
              independenceGroup: 'cuestionario:molestia',
            },
          ];
    case 'B-TECNICA': {
      const rv = env.reviews
        .filter((x) => x.lift === env.lift && x.date <= env.cutoff)
        .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      return rv
        ? [
            {
              id: 'B-TECNICA:revision',
              origin: 'observacion_tecnica',
              label: `Revisión técnica del coach: ${rv.verdict}`,
              value: rv.verdict,
              refs: [{ kind: 'review', id: `${rv.lift}:${rv.date}`, date: rv.date }],
              derivedFrom: ['revision'],
              independenceGroup: 'tecnica',
            },
          ]
        : [];
    }
    case 'R-EXPRESSION-A': {
      const series = `series:${env.lift}`;
      const get = (k: string) => r.facts.find((x) => x.key === k);
      const mk = (
        k: string,
        origin: EvidenceItem['origin'],
        group: string,
        from: string,
      ): EvidenceItem | null => {
        const x = get(k);
        return x && x.value !== null
          ? {
              id: `R-EXPRESSION-A:${k}`,
              origin,
              label: x.label,
              value: typeof x.value === 'boolean' ? String(x.value) : x.value,
              ...(x.unit ? { unit: x.unit } : {}),
              refs: [],
              derivedFrom: [from],
              independenceGroup: group,
            }
          : null;
      };
      return [
        mk('fr', 'rendimiento', `rendimiento:${env.lift}`, series),
        mk('trend', 'rendimiento', `rendimiento:${env.lift}`, series),
        mk('acwr', 'carga', `carga:${env.lift}`, `inol:${env.lift}`),
        mk('peak_index', 'carga', `carga:${env.lift}`, `inol:${env.lift}`),
      ].filter((x): x is EvidenceItem => !!x);
    }
    case 'R-FREQUENCY': {
      const fat = env.feedback.filter(
        (x) => exps.some((e) => e.sessionKey === x.sessionKey) && x.endFatigue !== null,
      );
      return [
        ...performanceItems(r, exps).filter((i) => i.origin !== 'cumplimiento'),
        ...fat.map((x): EvidenceItem => ({
          id: `R-FREQUENCY:fatiga:${x.sessionKey}`,
          origin: 'cuestionario',
          label: `Fatiga de fin de sesión (${x.sessionKey})`,
          value: x.endFatigue,
          unit: '1–10',
          refs: [{ kind: 'session', id: x.sessionKey }],
          derivedFrom: ['fatiga'],
          independenceGroup: 'cuestionario:fatiga',
        })),
      ];
    }
    default: {
      const items = performanceItems(r, exps);
      if (['R-EXPRESSION-B', 'R-PR', 'R-VOLUME'].includes(r.ruleId)) {
        const rd = readinessItem(env);
        if (rd) items.push(rd);
      }
      if (r.ruleId === 'R-PR') {
        const rv = env.reviews
          .filter((x) => x.lift === env.lift && x.date <= env.cutoff)
          .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        if (rv)
          items.push({
            id: 'R-PR:revision',
            origin: 'observacion_tecnica',
            label: `Revisión técnica del coach: ${rv.verdict}`,
            value: rv.verdict,
            refs: [{ kind: 'review', id: `${rv.lift}:${rv.date}`, date: rv.date }],
            derivedFrom: ['revision'],
            independenceGroup: 'tecnica',
          });
      }
      return items;
    }
  }
}

const worst = (xs: CompatState[]): CompatState => {
  if (!xs.length) return { state: 'desconocida', reasons: ['sin exposiciones'] };
  const order: Comparability[] = ['no_comparable', 'parcial', 'desconocida', 'comparable'];
  const s = [...xs].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state))[0] as CompatState;
  return { state: s.state, reasons: [...new Set(xs.flatMap((x) => x.reasons))] };
};

export function assess(r: RuleResult, env: EvidenceEnv): EvidenceAssessment {
  const items = r.evidenceItems;
  const { groups } = dependenciesOf(items);
  const reasons: string[] = [];
  const cmp = r.exposureId
    ? (env.comparability.get(r.exposureId) ?? {
        state: 'desconocida' as const,
        reasons: ['sin información de comparabilidad'],
      })
    : worst([...env.comparability.values()]);
  reasons.push(...cmp.reasons);
  let recency: EvidenceAssessment['recency'] = 'desconocida';
  if (r.dataUntil) {
    const age = daysBetween(env.cutoff, r.dataUntil);
    recency = age <= env.params.windowDays ? 'vigente' : 'desactualizada';
    if (recency === 'desactualizada')
      reasons.push(`El último dato usado tiene ${age} días (ventana de ${env.params.windowDays}).`);
  }
  if (items.some((i) => i.stale)) {
    recency = 'desactualizada';
    reasons.push('Un cuestionario usado está vencido.');
  }
  if (r.missing.length) reasons.push(`Faltan datos: ${r.missing.slice(0, 2).join('; ')}.`);
  return {
    sufficiency: r.sufficiency,
    recency,
    comparability: cmp.state,
    independentGroups: groups,
    items: items.length,
    correlationNote: correlationNote(items),
    reasons: [...new Set(reasons)],
  };
}
