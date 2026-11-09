import type { DashboardData, Lift } from '@coaching/contracts';
import { daysBetween } from '@coaching/engine';
import type { AthletesRepo } from '../repositories/athletes.js';
import type { DecisionsRepo } from '../repositories/decisions.js';
import type { HistoryRepo } from '../repositories/history.js';
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
  ) {}

  build(today: string): DashboardData {
    const list = this.athletes.list();
    const name = new Map(list.map((a) => [a.id, a.name]));
    const data: DashboardData = {
      today,
      cards: { active: list.length, needReview: 0, blocksEnding: 0, pendingCheckins: 0 },
      priorities: [],
      opportunities: [],
      competitions: [],
      recent: [],
    };
    for (const a of list) {
      const ev = this.decisions.latestEvaluation(a.id);
      const rows = this.decisions.list(a.id, 'vigente').filter((r) => r.isPrincipal);
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
      data.cards.blocksEnding += (ev?.blocks ?? []).filter(
        (b) => !b.closed && daysBetween(b.endDate, today) >= 0 && daysBetween(b.endDate, today) <= 14,
      ).length;
      const last = this.records
        .listCheckIns(a.id)
        .map((c) => c.date)
        .sort()
        .pop();
      if (!last || daysBetween(today, last) > 7) data.cards.pendingCheckins++;
      const lastDone = this.records.lastRecordDate(a.id);
      if (lastDone)
        data.recent.push({
          date: lastDone,
          athleteId: a.id,
          athleteName: a.name,
          kind: 'sesion',
          text: 'Última sesión registrada',
        });
      for (const e of this.history.listEvents(a.id).slice(-2))
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
    for (const c of this.history.listCompetitions()) {
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
