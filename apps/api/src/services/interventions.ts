import { randomUUID } from 'node:crypto';
import {
  createIntervention,
  interventionFollowUp,
  linkEvent,
  transition,
  type Intervention,
  type InterventionFollowUp,
} from '@coaching/engine';
import type { InterventionCreateInput, InterventionTransitionInput } from '@coaching/contracts';
import type { DecisionsRepo } from '../repositories/decisions.js';
import type { InterventionsRepo } from '../repositories/interventions.js';
import type { DataLoader } from './data.js';
import { NotFoundError, UnprocessableError } from './errors.js';

export interface InterventionView {
  intervention: Intervention;
  followUp: InterventionFollowUp | null;
}

/** Hallazgo → propuesta → decisión → intervención → seguimiento. Aceptar NO es aplicar; cada hito tiene su propia fecha; reevaluar no duplica ni borra nada. */
export class InterventionService {
  constructor(
    private repo: InterventionsRepo,
    private decisions: DecisionsRepo,
    private loader: DataLoader,
    private today: () => string,
    private nowIso: () => string,
  ) {}

  async create(athleteId: string, input: InterventionCreateInput): Promise<Intervention> {
    const on = input.on ?? this.today();
    if (input.proposalKey) {
      const dec = await this.decisions.get(athleteId, input.proposalKey);
      if (!dec) throw new NotFoundError('La propuesta indicada no existe');
      const existing = await this.repo.byProposal(athleteId, input.proposalKey);
      if (existing) return existing; // idempotente: una propuesta, una intervención
      const i = createIntervention({
        id: randomUUID(),
        origin: 'propuesta',
        proposalKey: input.proposalKey,
        lift: dec.lift,
        exposureId: dec.exposureId,
        detectedOn: dec.detectedOn,
        on,
        coachNote: input.coachNote,
      });
      await this.repo.save(athleteId, i, this.nowIso());
      await this.decisions.setLifecycle(athleteId, input.proposalKey, 'detectada', { interventionId: i.id });
      return i;
    }
    if (!input.lift) throw new UnprocessableError('Una intervención manual necesita el lift');
    const i = createIntervention({
      id: randomUUID(),
      origin: 'manual',
      lift: input.lift,
      exposureId: input.exposureId ?? null,
      on,
      appliedOn: input.appliedOn,
      appliedDescription: input.appliedDescription,
      linkedEventId: input.linkedEventId,
      coachNote: input.coachNote,
    });
    await this.repo.save(athleteId, i, this.nowIso());
    return i;
  }

  async transition(athleteId: string, id: string, t: InterventionTransitionInput): Promise<Intervention> {
    const cur = await this.repo.get(athleteId, id);
    if (!cur) throw new NotFoundError('Intervención inexistente');
    const r = transition(cur, {
      to: t.to,
      on: t.on ?? this.today(),
      note: t.note,
      appliedOn: t.appliedOn,
      appliedDescription: t.appliedDescription,
      deviatesFromProposal: t.deviatesFromProposal,
      linkedEventId: t.linkedEventId,
    });
    if (!r.ok) throw new UnprocessableError(r.error, { from: cur.state, to: t.to });
    await this.repo.save(athleteId, r.intervention, this.nowIso());
    if (cur.proposalKey)
      await this.decisions.setLifecycle(athleteId, cur.proposalKey, r.intervention.state, {
        interventionId: id,
        coachNote: r.intervention.coachNote,
        decidedOn: r.intervention.decidedOn ?? '',
      });
    return r.intervention;
  }

  /** Vincula una modificación manual del plan (evento detectado) con la intervención. */
  async link(athleteId: string, id: string, eventId: string): Promise<Intervention> {
    const cur = await this.repo.get(athleteId, id);
    if (!cur) throw new NotFoundError('Intervención inexistente');
    if (!(await this.loader.load(athleteId)).events.some((e) => e.id === eventId))
      throw new NotFoundError('Evento de cambio inexistente');
    const next = linkEvent(cur, eventId, this.today());
    await this.repo.save(athleteId, next, this.nowIso());
    return next;
  }

  /** Las intervenciones ya aplicadas pasan a "seguimiento" cuando su fecha de aplicación llegó. Idempotente. */
  async refresh(athleteId: string): Promise<void> {
    const today = this.today();
    for (const i of await this.repo.list(athleteId)) {
      if (i.state === 'aplicada' && i.appliedOn && i.appliedOn <= today) {
        const r = transition(i, { to: 'seguimiento', on: today, note: 'Inicio automático del seguimiento' });
        if (r.ok) await this.repo.save(athleteId, r.intervention, this.nowIso());
      }
    }
  }

  async list(athleteId: string, cutoff: string): Promise<InterventionView[]> {
    await this.refresh(athleteId);
    const d = await this.loader.load(athleteId, cutoff);
    return (await this.repo.list(athleteId)).map((intervention) => ({
      intervention,
      followUp: interventionFollowUp(intervention, {
        planned: d.planned,
        actual: d.actual,
        readiness: d.readinessHistory,
        competitionExercises: d.competitionExercises,
        cutoff,
        params: d.params,
        events: d.events,
        otherInterventions: d.interventions,
      }),
    }));
  }
}
