import {
  evaluateAthlete,
  knownAt,
  latestFrom,
  mergeDecisions,
  toDecisionRows,
  type AthleteEvaluation,
  type DecisionRow,
} from '@coaching/engine';
import type { Db } from '../db/connection.js';
import type { HistoryRepo } from '../repositories/history.js';
import type { DecisionsRepo } from '../repositories/decisions.js';
import type { DataLoader } from './data.js';
import { inputsFingerprint } from './fingerprint.js';

export { NotFoundError } from './errors.js';

/**
 * Caso de uso "evaluar atleta al corte": lee registros → corre el motor puro → fusiona con lo guardado → persiste.
 * Idempotente por (atleta, corte, versión de reglas). No modifica la prescripción ni la ejecución. Conserva el ciclo de vida y la intervención de cada hallazgo.
 */
export class EvaluationService {
  constructor(
    private db: Db,
    private loader: DataLoader,
    private decisions: DecisionsRepo,
    private history?: HistoryRepo,
  ) {}

  async evaluate(
    athleteId: string,
    cutoff: string,
  ): Promise<{ evaluation: AthleteEvaluation; decisions: DecisionRow[] }> {
    const d = await this.loader.load(athleteId, cutoff);
    // Solo lo conocido al corte: programación vigente entonces, ejecución, cuestionarios, revisiones y cambios hasta esa fecha.
    const k = knownAt(
      {
        plannedSets: d.planned,
        actualSets: d.actual,
        snapshots: await this.history?.listVersions(athleteId),
        sessionFeedback: d.feedback,
        coachReviews: d.reviews,
        changeEvents: d.events,
      },
      cutoff,
    );
    const evaluation = evaluateAthlete({
      cutoff,
      params: d.params,
      plannedSets: k.plannedSets,
      actualSets: k.actualSets,
      readiness: latestFrom(d.readinessHistory, cutoff),
      readinessHistory: d.readinessHistory.filter((r) => r.date <= cutoff),
      sessionFeedback: k.sessionFeedback,
      coachReviews: k.coachReviews,
      families: d.families,
      changeEvents: k.changeEvents,
      competitionExercises: d.competitionExercises,
    });
    evaluation.inputFingerprint = await inputsFingerprint(this.loader, this.history, athleteId, cutoff);
    const merged = mergeDecisions(
      await this.decisions.list(athleteId),
      toDecisionRows(evaluation, d.params),
      cutoff,
    );
    await this.db.transaction(async () => {
      this.decisions.saveAll(athleteId, merged);
      await this.decisions.saveEvaluation(athleteId, evaluation);
    });
    return { evaluation, decisions: merged };
  }
}
