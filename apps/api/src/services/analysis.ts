import { ANALYSIS_METRICS, buildPeriods, knownAt, type Granularity, type Lift } from '@coaching/engine';
import type { AnalysisResult, DistributionBasis } from '@coaching/contracts';
import type { HistoryRepo } from '../repositories/history.js';
import type { BlockAnalysisService } from './block-analysis.js';
import type { DataLoader } from './data.js';
import type { HistoryService } from './history.js';
import type { QueryService } from './queries.js';

const ANALYSIS_FRAME_VERSION = 'analysis-frame-v1';

const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * Analizar: UNA respuesta con todo lo que la pantalla muestra (períodos, bloques, distribución, récords, TTP). Solo lectura.
 * Reutiliza los servicios existentes (no recalcula nada) y la web solo presenta: sin agregación en el navegador.
 * Todo respeta el corte `asOf`; lo previsto y lo realizado viajan por separado.
 */
export class AnalysisService {
  constructor(
    private loader: DataLoader,
    private history: HistoryRepo,
    private blockAnalysis: BlockAnalysisService,
    private queries: QueryService,
    private historyService: HistoryService,
  ) {}

  async build(
    athleteId: string,
    o: {
      asOf: string;
      from?: string;
      to?: string;
      lift: Lift | 'ALL';
      granularity: Granularity;
      block?: string;
      blocksSource?: 'planned' | 'actual';
    },
  ): Promise<AnalysisResult> {
    const d = await this.loader.load(athleteId, o.asOf);
    const k = knownAt(
      {
        plannedSets: d.planned,
        actualSets: d.actual,
        snapshots: await this.history.listVersions(athleteId),
        sessionFeedback: d.feedback,
        coachReviews: d.reviews,
        changeEvents: d.events,
      },
      o.asOf,
    );
    const from = o.from ?? addDays(o.asOf, -182);
    const to = o.to ?? o.asOf;
    const periods = buildPeriods({
      planned: k.plannedSets,
      actual: k.actualSets,
      feedback: k.sessionFeedback,
      cutoff: o.asOf,
      from,
      to,
      lift: o.lift,
      granularity: o.granularity,
    });
    const blocks = await this.blockAnalysis.build(athleteId, {
      asOf: o.asOf,
      block: o.block,
      source: o.blocksSource ?? 'actual',
      lift: o.lift,
    });
    const cutoff = o.asOf;
    const lift = o.lift === 'ALL' ? undefined : o.lift;
    const slim = async (basis: 'realizado' | 'previsto'): Promise<DistributionBasis> => {
      const core = await this.queries.core(athleteId, {
        from,
        to: basis === 'previsto' ? to : to > cutoff ? cutoff : to,
        cutoff: basis === 'previsto' && to > cutoff ? to : cutoff,
        lift,
        domain: 'recomendado',
        view: 'weeks',
        basis,
      });
      const weeks = core.weeks.map((w) => ({
        from: w.week.from,
        to: w.week.to,
        muscles: w.muscles.rows.map((r) => ({
          muscle: r.muscle,
          label: r.label,
          directSets: r.directSets,
          indirectSets: r.indirectSets,
          equivalentSets: r.equivalentSets,
        })),
        patterns: w.patterns.rows.map((r) => ({
          pattern: r.pattern,
          sets: r.sets,
          nl: r.nl,
          tonnage: r.tonnage,
        })),
      }));
      return {
        weeks,
        muscles: core.muscles.rows.map((r) => ({
          muscle: r.muscle,
          label: r.label,
          directSets: r.directSets,
          indirectSets: r.indirectSets,
          equivalentSets: r.equivalentSets,
        })),
        patterns: core.patterns.rows.map((r) => ({
          pattern: r.pattern,
          sets: r.sets,
          nl: r.nl,
          tonnage: r.tonnage,
        })),
      };
    };
    const [actual, planned, recs, summary] = await Promise.all([
      slim('realizado'),
      slim('previsto'),
      this.queries.records(athleteId, cutoff),
      this.historyService.blocks(athleteId, cutoff),
    ]);
    return {
      version: ANALYSIS_FRAME_VERSION,
      athleteId,
      asOf: o.asOf,
      from,
      to,
      lift: o.lift,
      granularity: o.granularity,
      metrics: ANALYSIS_METRICS,
      periods,
      blocks,
      distribution: { actual, planned },
      records: recs.records.map((r) => ({
        type: r.type,
        exercise: r.exercise,
        variantKey: r.variantKey,
        key: r.key,
        value: r.value,
        unit: r.unit,
        date: r.date,
        isRealPR: r.isRealPR,
      })),
      references: d.references
        .filter((r) => r.asOf <= o.asOf)
        .map((r) => ({ exercise: r.exerciseName, kg: r.kg, source: r.source, date: r.asOf })),
      summary,
    };
  }
}
