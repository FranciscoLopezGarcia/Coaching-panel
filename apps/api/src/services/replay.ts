import { runReplay, type ReplayReport } from '@coaching/engine';
import type { HistoryRepo } from '../repositories/history.js';
import type { DataLoader } from './data.js';

/** Replay histórico: solo datos conocidos a cada corte, incluyendo cuándo se conocía la programación (versiones del plan). No escribe nada. */
export class ReplayService {
  constructor(
    private loader: DataLoader,
    private history: HistoryRepo,
  ) {}

  async run(
    athleteId: string,
    q: { from: string; to: string; step: 'weekly' | 'sessions'; horizonN?: number },
  ): Promise<ReplayReport> {
    const d = await this.loader.load(athleteId);
    return runReplay({
      plannedSets: d.planned,
      actualSets: d.actual,
      snapshots: await this.history.listVersions(athleteId),
      readinessHistory: d.readinessHistory,
      sessionFeedback: d.feedback,
      coachReviews: d.reviews,
      changeEvents: d.events,
      families: d.families,
      competitionExercises: d.competitionExercises,
      params: d.params,
      from: q.from,
      to: q.to,
      step: q.step,
      horizonN: q.horizonN,
    });
  }
}
