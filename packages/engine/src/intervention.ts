import type { ChangeEvent } from './diff.js';
import { observeAfter, type FollowUpInput, type Outcome } from './outcomes.js';
import type { Lift } from './types.js';

/**
 * Hallazgo → propuesta → decisión del coach → intervención aplicada → seguimiento → cierre.
 * Aprobar una propuesta NO significa que se aplicó. Cada hito tiene su propia fecha: detección, revisión, decisión, aplicación, cierre.
 * El motivo del coach es opcional; el sistema no infiere intención ni causalidad.
 */
export type Lifecycle =
  'detectada' | 'revisada' | 'aceptada' | 'descartada' | 'aplicada' | 'seguimiento' | 'cerrada';

export const LIFECYCLES: readonly Lifecycle[] = [
  'detectada',
  'revisada',
  'aceptada',
  'descartada',
  'aplicada',
  'seguimiento',
  'cerrada',
];

/** Transiciones permitidas. Se puede aceptar o descartar directamente desde "detectada" (la revisión queda implícita en esa fecha). */
export const TRANSITIONS: Record<Lifecycle, Lifecycle[]> = {
  detectada: ['revisada', 'aceptada', 'descartada'],
  revisada: ['aceptada', 'descartada'],
  aceptada: ['aplicada', 'descartada'],
  descartada: ['revisada'],
  aplicada: ['seguimiento', 'cerrada'],
  seguimiento: ['cerrada'],
  cerrada: [],
};

export interface InterventionEvent {
  on: string;
  from: Lifecycle | null;
  to: Lifecycle;
  note: string;
}

export interface Intervention {
  id: string;
  /** 'propuesta': nace de un hallazgo del motor; 'manual': el coach la registra sin propuesta previa. */
  origin: 'propuesta' | 'manual';
  /** Clave del hallazgo/propuesta (DecisionRow.key). null en una intervención manual. */
  proposalKey: string | null;
  lift: Lift | null;
  exposureId: string | null;
  state: Lifecycle;
  /** Fecha en que el motor detectó el hallazgo (null si es manual). */
  detectedOn: string | null;
  reviewedOn: string | null;
  /** Fecha de la decisión del coach (aceptar/descartar). */
  decidedOn: string | null;
  decision: 'aceptada' | 'descartada' | null;
  /** Fecha de aplicación real: puede ser distinta de la decisión. */
  appliedOn: string | null;
  /** Qué se aplicó, tal como lo dice el coach. Puede ser distinto de la propuesta. */
  appliedDescription: string | null;
  deviatesFromProposal: boolean;
  /** Evento de cambio del plan vinculado (modificación manual del plan asociada a esta intervención). */
  linkedEventId: string | null;
  closedOn: string | null;
  coachNote: string;
  history: InterventionEvent[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface CreateInput {
  id: string;
  origin: Intervention['origin'];
  proposalKey?: string | null;
  lift?: Lift | null;
  exposureId?: string | null;
  detectedOn?: string | null;
  on: string;
  /** Una intervención manual puede nacer ya aplicada. */
  appliedOn?: string | null;
  appliedDescription?: string | null;
  linkedEventId?: string | null;
  coachNote?: string;
}

export function createIntervention(i: CreateInput): Intervention {
  const applied = i.origin === 'manual' && !!i.appliedOn;
  const state: Lifecycle = applied ? 'aplicada' : 'detectada';
  return {
    id: i.id,
    origin: i.origin,
    proposalKey: i.proposalKey ?? null,
    lift: i.lift ?? null,
    exposureId: i.exposureId ?? null,
    state,
    detectedOn: i.origin === 'propuesta' ? (i.detectedOn ?? i.on) : null,
    reviewedOn: null,
    decidedOn: applied ? i.on : null,
    decision: applied ? 'aceptada' : null,
    appliedOn: applied ? (i.appliedOn as string) : null,
    appliedDescription: i.appliedDescription ?? null,
    deviatesFromProposal: false,
    linkedEventId: i.linkedEventId ?? null,
    closedOn: null,
    coachNote: i.coachNote ?? '',
    history: [
      {
        on: i.on,
        from: null,
        to: state,
        note: i.origin === 'manual' ? 'Intervención registrada sin propuesta previa' : 'Hallazgo detectado',
      },
    ],
  };
}

export interface TransitionInput {
  to: Lifecycle;
  on: string;
  note?: string;
  /** Para 'aplicada': fecha real de aplicación (por defecto, la de la transición) y qué se aplicó. */
  appliedOn?: string;
  appliedDescription?: string;
  /** El coach aplicó algo distinto de lo propuesto. */
  deviatesFromProposal?: boolean;
  linkedEventId?: string;
}

export type TransitionResult = { ok: true; intervention: Intervention } | { ok: false; error: string };

/** Aplica una transición validada. No muta el original. */
export function transition(cur: Intervention, t: TransitionInput): TransitionResult {
  if (!ISO.test(t.on)) return { ok: false, error: 'Fecha inválida (yyyy-mm-dd)' };
  if (t.appliedOn !== undefined && !ISO.test(t.appliedOn))
    return { ok: false, error: 'Fecha de aplicación inválida (yyyy-mm-dd)' };
  if (!TRANSITIONS[cur.state].includes(t.to))
    return { ok: false, error: `Transición no permitida: ${cur.state} → ${t.to}` };
  const next: Intervention = {
    ...cur,
    history: [...cur.history, { on: t.on, from: cur.state, to: t.to, note: t.note ?? '' }],
  };
  next.state = t.to;
  if (t.note !== undefined && t.note !== '') next.coachNote = t.note;
  if (t.linkedEventId) next.linkedEventId = t.linkedEventId;
  switch (t.to) {
    case 'revisada':
      next.reviewedOn = t.on;
      next.decision = null;
      next.decidedOn = null;
      break;
    case 'aceptada':
    case 'descartada':
      next.reviewedOn ??= t.on;
      next.decision = t.to;
      next.decidedOn = t.on;
      break;
    case 'aplicada':
      next.appliedOn = t.appliedOn ?? t.on;
      next.appliedDescription = t.appliedDescription ?? next.appliedDescription;
      next.deviatesFromProposal = t.deviatesFromProposal ?? false;
      break;
    case 'cerrada':
      next.closedOn = t.on;
      break;
    default:
      break;
  }
  return { ok: true, intervention: next };
}

/** Vincula una modificación manual del plan (evento detectado) con una intervención, sin cambiar su estado. */
export function linkEvent(cur: Intervention, eventId: string, on: string): Intervention {
  return {
    ...cur,
    linkedEventId: eventId,
    history: [
      ...cur.history,
      { on, from: cur.state, to: cur.state, note: `Vinculada al cambio de plan ${eventId}` },
    ],
  };
}

/** ¿La intervención ya está aplicada y su seguimiento puede evaluarse? */
export const isApplied = (i: Intervention): boolean =>
  i.state === 'aplicada' || i.state === 'seguimiento' || i.state === 'cerrada';

export interface InterventionFollowUp extends Outcome {
  interventionId: string;
}

/**
 * Seguimiento posterior de una intervención APLICADA: describe lo observado después de la fecha de aplicación, considerando otros cambios
 * del plan y otras intervenciones que caen en la ventana. Si todavía no hay exposiciones suficientes: "seguimiento pendiente".
 */
export function interventionFollowUp(
  i: Intervention,
  inp: Omit<FollowUpInput, 'events'> & { events: ChangeEvent[]; otherInterventions: Intervention[] },
): InterventionFollowUp | null {
  if (!isApplied(i) || !i.appliedOn || !i.lift) return null;
  const lift = i.lift;
  const o = observeAfter(
    {
      label: `la intervención (${i.appliedDescription ?? 'sin descripción'})`,
      eventId: i.id,
      lift,
      blockKey: '',
      status: 'aplicado',
      effectiveOn: i.appliedOn,
      effectiveEstimated: false,
      competingFinder: (from, to) => [
        ...inp.events
          .filter(
            (e) =>
              e.id !== i.linkedEventId &&
              e.status === 'aplicado' &&
              e.effectiveOn &&
              e.effectiveOn >= from &&
              e.effectiveOn <= to &&
              e.changes.some((x) => x.lift === lift),
          )
          .map((e) => `cambio ${e.id} (${e.effectiveOn})`),
        ...inp.otherInterventions
          .filter(
            (x) =>
              x.id !== i.id && x.appliedOn && x.lift === lift && x.appliedOn >= from && x.appliedOn <= to,
          )
          .map((x) => `intervención ${x.id} (${x.appliedOn})`),
      ],
    },
    inp,
  );
  return { ...o, interventionId: i.id };
}
