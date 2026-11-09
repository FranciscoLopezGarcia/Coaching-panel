import type { EvidenceAssessment } from './evidence.js';
import type { RuleResult, Status } from './types.js';

/**
 * Qué acción propone cada hallazgo. Sirve para evitar órdenes simultáneas incompatibles sobre el mismo contexto
 * (intentar un PR, aumentar volumen, reducir fatiga): hay UNA acción principal y el resto se difiere con explicación o se secuencia.
 */
export type ActionKind =
  | 'revisar_tolerancia'
  | 'revisar_bloque'
  | 'redistribuir'
  | 'intentar_marca'
  | 'evaluar_oportunidad'
  | 'progresar_carga'
  | 'aumentar_estimulo'
  | 'mantener'
  | 'contexto'
  | 'completar_datos'
  | 'ninguna';

export const PROTECTIVE: readonly ActionKind[] = ['revisar_tolerancia', 'revisar_bloque', 'redistribuir'];
const OFFENSIVE_ACTIONS: readonly ActionKind[] = [
  'intentar_marca',
  'evaluar_oportunidad',
  'progresar_carga',
  'aumentar_estimulo',
];

export function actionOf(r: Pick<RuleResult, 'status' | 'tag'>): ActionKind {
  const m: Record<Status, ActionKind> = {
    revision_coach: 'revisar_tolerancia',
    posible_fin_respuesta: 'revisar_bloque',
    datos_insuficientes: 'completar_datos',
    candidato_pr: 'intentar_marca',
    oportunidad_pendiente: 'evaluar_oportunidad',
    ventana_expresion: 'contexto',
    margen_carga: 'progresar_carga',
    progreso_sostenido: 'mantener',
    tendencia_inicial_favorable: 'mantener',
    estabilidad_observada: 'ninguna',
    candidato_volumen: 'aumentar_estimulo',
    candidato_frecuencia: 'redistribuir',
    sin_senal: 'ninguna',
  };
  return m[r.status];
}

export type ConflictKind = 'incompatible' | 'secuenciable' | 'compatible';

export interface Conflict {
  a: string;
  b: string;
  kind: ConflictKind;
  /** Cómo se resolvió, sin esconder la evidencia de ninguno de los dos. */
  resolution: string;
}

export const ruleKey = (r: Pick<RuleResult, 'ruleId' | 'exposureId'>): string =>
  `${r.ruleId}${r.exposureId ? `@${r.exposureId}` : ''}`;

function relation(p: ActionKind, x: ActionKind): { kind: ConflictKind; text: string } {
  const prot = PROTECTIVE.includes(p);
  const xOff = OFFENSIVE_ACTIONS.includes(x);
  if (prot && xOff)
    return {
      kind: 'incompatible',
      text: `se difiere: primero se resuelve la revisión/ajuste (${p.replace(/_/g, ' ')}); la propuesta (${x.replace(/_/g, ' ')}) no se emite como acción concurrente`,
    };
  if (prot && PROTECTIVE.includes(x))
    return { kind: 'compatible', text: 'ambas son revisiones; se muestran juntas' };
  if (x === 'contexto' || x === 'mantener' || x === 'ninguna')
    return { kind: 'compatible', text: 'señal de otra dimensión, compatible: se conserva como contexto' };
  const pair = [p, x].sort().join('+');
  if (pair === ['aumentar_estimulo', 'intentar_marca'].sort().join('+'))
    return {
      kind: 'incompatible',
      text: 'no se proponen a la vez: primero se evalúa el intento de marca (corto) y, resuelto, se considera el ensayo de volumen',
    };
  if (pair === ['aumentar_estimulo', 'progresar_carga'].sort().join('+'))
    return {
      kind: 'incompatible',
      text: 'no se proponen a la vez: primero la progresión de carga prevista; el ensayo de volumen queda para después',
    };
  if (pair === ['intentar_marca', 'progresar_carga'].sort().join('+'))
    return {
      kind: 'secuenciable',
      text: 'secuencia: la progresión de carga sigue su curso en el plan; el intento de marca es un evento aparte sujeto a validación',
    };
  if (p === 'evaluar_oportunidad' || x === 'evaluar_oportunidad')
    return {
      kind: 'secuenciable',
      text: 'se evalúa la oportunidad pendiente antes de cualquier otra propuesta ofensiva',
    };
  return { kind: 'compatible', text: 'sin conflicto conocido' };
}

export interface Resolution {
  principal: RuleResult | null;
  conflicts: Conflict[];
  /** Acciones diferidas por incompatibilidad con la principal. */
  deferred: { key: string; action: ActionKind; reason: string }[];
  sequence: string[];
}

/**
 * Elige la conclusión principal y decide qué hacer con las demás señales. Orden: acciones protectoras primero, luego por prioridad.
 * "Datos insuficientes" solo manda si no hay otra evaluación; "sin señal" no compite.
 */
export function resolvePrincipal(results: RuleResult[]): Resolution {
  const live = results.filter((r) => r.status !== 'sin_senal' && r.status !== 'datos_insuficientes');
  const pool = (
    live.length ? live : results.filter((r) => r.ruleId === 'R-PROGRESS' || r.status !== 'sin_senal')
  ).slice();
  pool.sort(
    (x, y) =>
      Number(!PROTECTIVE.includes(actionOf(x))) - Number(!PROTECTIVE.includes(actionOf(y))) ||
      x.rank - y.rank ||
      (x.dataUntil < y.dataUntil ? 1 : x.dataUntil > y.dataUntil ? -1 : 0),
  );
  const principal = pool[0] ?? results[0] ?? null;
  const conflicts: Conflict[] = [];
  const deferred: Resolution['deferred'] = [];
  const sequence: string[] = [];
  if (principal) {
    const pa = actionOf(principal);
    for (const x of live) {
      if (x === principal) continue;
      const xa = actionOf(x);
      const rel = relation(pa, xa);
      // Un mismo tipo de acción en otra exposición (p. ej. otro slot) es una alternativa, no un conflicto.
      conflicts.push({ a: ruleKey(principal), b: ruleKey(x), kind: rel.kind, resolution: rel.text });
      if (rel.kind === 'incompatible') deferred.push({ key: ruleKey(x), action: xa, reason: rel.text });
      if (rel.kind === 'secuenciable' || rel.kind === 'incompatible')
        sequence.push(`${ruleKey(principal)} → ${ruleKey(x)}: ${rel.text}`);
    }
  }
  return { principal, conflicts, deferred, sequence };
}

export type DimensionId = 'rendimiento' | 'recuperacion' | 'respuesta' | 'oportunidades' | 'calidad_datos';

export interface DimensionState {
  id: DimensionId;
  status: string;
  summary: string;
  /** Reglas/métricas de las que sale (para abrir la evidencia). */
  signals: string[];
  assessment: EvidenceAssessment | null;
}

export interface LiftState {
  lift: string;
  cutoff: string;
  objective: { value: string | null; available: boolean; note: string };
  dimensions: DimensionState[];
  principal: {
    key: string;
    status: Status;
    headline: string;
    action: ActionKind;
    actionText: string | null;
    assessment: EvidenceAssessment | null;
  } | null;
  conflicts: Conflict[];
  deferred: Resolution['deferred'];
  sequence: string[];
  /** Señales de dimensiones distintas que no se contradicen. */
  compatibleSignals: string[];
}
