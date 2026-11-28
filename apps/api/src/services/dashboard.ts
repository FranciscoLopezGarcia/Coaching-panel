import type { DashboardData, Lift } from '@coaching/contracts';
import { daysBetween, planningStatus } from '@coaching/engine';
import type { AthletesRepo } from '../repositories/athletes.js';
import type { DecisionsRepo } from '../repositories/decisions.js';
import type { HistoryRepo } from '../repositories/history.js';
import type { ProgrammingRepo } from '../repositories/programming.js';
import type { RecordsRepo } from '../repositories/records.js';

const REVIEW = ['revision_coach', 'posible_fin_respuesta'];
const OPPORTUNITY = [
  'candidato_pr',
  'ventana_expresion',
  'margen_carga',
  'candidato_volumen',
  'candidato_frecuencia',
];

/** Inicio: gestión diaria. Solo lectura; "requieren revisión" y "oportunidades" salen de lo ya evaluado, sin recalcular. */
export class DashboardService {
  constructor(
    private athletes: AthletesRepo,
    private records: RecordsRepo,
    private decisions: DecisionsRepo,
    private history: HistoryRepo,
    private programming: ProgrammingRepo,
  ) {}

  async build(today: string): Promise<DashboardData> {
    const list = await this.athletes.list();
    const name = new Map(list.map((a) => [a.id, a.name]));
    const data: DashboardData = {
      today,
      cards: { active: list.length, needReview: 0, blocksEnding: 0, pendingCheckins: 0 },
      priorities: [],
      opportunities: [],
      competitions: [],
      planning: [],
      recent: [],
    };
    for (const a of list) {
      const ev = await this.decisions.latestEvaluation(a.id);
      const rows = (await this.decisions.list(a.id, 'vigente')).filter((r) => r.isPrincipal);
      let review = false;
      for (const r of rows) {
        const base = {
          athleteId: a.id,
          athleteName: a.name,
          lift: r.lift as Lift,
          status: r.status,
          summary: r.summary,
        };
        if (REVIEW.includes(r.status)) {
          review = true;
          data.priorities.push({ ...base, since: r.dataUntil || r.evaluatedOn });
        } else if (OPPORTUNITY.includes(r.status) && r.coachDecision === 'Pendiente')
          data.opportunities.push({ ...base, key: r.key });
      }
      if (review) data.cards.needReview++;
      const [days, mesos, micros] = await Promise.all([
        this.records.listActivePlanDays(a.id),
        this.programming.listMesos(a.id),
        this.programming.listMicros(a.id),
      ]);
      const plan = planningStatus(days, [...mesos, ...micros], today);
      const blockName = (key: string) => mesos.find((m) => m.blockKey === key)?.name ?? key;
      const lastCheckIn =
        (await this.records.listCheckIns(a.id))
          .map((c) => c.date)
          .filter((d) => d <= today)
          .sort()
          .pop() ?? null;
      const checkInPending = !lastCheckIn || daysBetween(today, lastCheckIn) > 7;
      // Bloque a mostrar: el de la sesión más cercana hasta el fin de esta semana; si no hay, el primero que venga.
      const dated = [...days].sort((x, y) => (x.date < y.date ? -1 : 1));
      const current = dated.filter((x) => x.date <= plan.currentWeek.to).at(-1) ?? dated[0];
      data.planning.push({
        athleteId: a.id,
        athleteName: a.name,
        hasCurrent: plan.hasCurrent,
        hasNext: plan.hasNext,
        plannedUntil: plan.plannedUntil,
        endingBlocks: plan.endingBlocks.map((b) => ({ ...b, name: blockName(b.blockKey) })),
        currentBlock: current ? blockName(current.blockKey) : null,
        lastCheckIn,
        checkInPending,
      });
      if (plan.endingBlocks.length) data.cards.blocksEnding++;
      if (checkInPending) data.cards.pendingCheckins++;
      const lastDone = await this.records.lastRecordDate(a.id);
      if (lastDone)
        data.recent.push({
          date: lastDone,
          athleteId: a.id,
          athleteName: a.name,
          kind: 'sesion',
          text: 'Última sesión registrada',
        });
      for (const e of (await this.history.listEvents(a.id)).slice(-2))
        data.recent.push({
          date: e.detectedOn,
          athleteId: a.id,
          athleteName: a.name,
          kind: 'cambio',
          text: e.changes.map((c) => c.summary).join(' ') || 'Cambio de programación detectado',
        });
      if (ev)
        data.recent.push({
          date: ev.cutoff,
          athleteId: a.id,
          athleteName: a.name,
          kind: 'evaluacion',
          text: 'Evaluación del motor',
        });
    }
    for (const c of await this.history.listCompetitions()) {
      const daysLeft = daysBetween(c.date, today);
      if (daysLeft >= 0)
        data.competitions.push({
          id: c.id,
          athleteId: c.athleteId,
          athleteName: name.get(c.athleteId) ?? '',
          name: c.name,
          date: c.date,
          daysLeft,
          phase: c.phase,
        });
    }
    data.competitions.sort((x, y) => x.daysLeft - y.daysLeft);
    data.priorities.sort((x, y) => (x.since < y.since ? -1 : 1));
    data.recent.sort((x, y) => (x.date < y.date ? 1 : -1));
    data.recent = data.recent.slice(0, 10);
    return data;
  }
}
