import { projectPerformance, type PerformanceProjection, type ProjectionConfig } from '@coaching/engine';
import type { PerformanceProjectionQuery } from '@coaching/contracts';
import type { Db } from '../db/connection.js';
import { NotFoundError, UnprocessableError } from './errors.js';
import type { DataLoader } from './data.js';

/**
 * Proyección de rendimiento (EXPERIMENTAL, solo lectura). Resuelve filtros y vistas (macro/meso/período) y delega en el motor.
 * Nunca usa datos posteriores al corte: la vista se recorta al corte y el motor vuelve a filtrar.
 */
export class ProjectionService {
  constructor(
    private loader: DataLoader,
    private db: Db,
    private today: () => string,
  ) {}

  run(athleteId: string, q: PerformanceProjectionQuery): PerformanceProjection {
    const cutoff = q.cutoff ?? this.today();
    const d = this.loader.load(athleteId, cutoff);
    let exercise = q.exercise;
    let variantKey = q.variantKey;
    if (q.exposureId) {
      const sets = d.planned.filter((s) => s.exposureId === q.exposureId);
      if (!sets.length) throw new UnprocessableError('exposureId inexistente para este atleta');
      const s = sets[sets.length - 1]!;
      exercise = exercise ?? s.exerciseName;
      variantKey = variantKey ?? s.variantKey;
    }
    // vista: macro | meso | período libre (siempre recortada al corte)
    let view: {
      kind: 'cutoff' | 'macro' | 'meso' | 'free';
      from: string | null;
      to: string | null;
      label: string | null;
    } = {
      kind: 'cutoff',
      from: null,
      to: null,
      label: null,
    };
    if (q.blockKey) {
      const meta = d.mesos.find((m) => m.blockKey === q.blockKey);
      const ds = d.planned
        .filter((s) => s.blockKey === q.blockKey)
        .map((s) => s.plannedDate)
        .sort();
      const from = meta?.startDate ?? ds[0];
      const to = meta?.endDate ?? ds.at(-1);
      if (!from) throw new NotFoundError('Meso inexistente o sin fechas');
      view = { kind: 'meso', from, to: to ?? cutoff, label: meta?.name ?? q.blockKey };
    } else if (q.macroId) {
      const m = d.macros.find((x) => x.id === q.macroId);
      if (!m) throw new NotFoundError('Macro inexistente');
      view = { kind: 'macro', from: m.startDate, to: m.endDate ?? cutoff, label: m.name };
    } else if (q.from || q.to) {
      view = { kind: 'free', from: q.from ?? null, to: q.to ?? null, label: null };
    }
    if (view.to && view.to > cutoff) view = { ...view, to: cutoff };

    const config: Partial<ProjectionConfig> = {
      horizonDays: q.horizonDays,
      aggregate: q.aggregate,
      levelK: q.levelK,
      halfLifeDays: q.halfLifeDays,
      rangeNominal: q.rangeNominal,
    };
    return projectPerformance({
      athleteId,
      obs: d.observed,
      cutoff,
      filters: { lift: q.lift, exercise, variantKey, source: q.source },
      variable: q.variable,
      config,
      scope: q.scope,
      view,
      liftConfigs: d.params.perLift,
      references: d.references,
      availableOn: this.availability(athleteId),
    });
  }

  /** Fecha en que cada registro quedó disponible, SOLO cuando existe (revisión de creación o lote de importación); si no, no se inventa. */
  private availability(athleteId: string): Map<string, string> {
    const m = new Map<string, string>();
    for (const r of this.db
      .prepare(
        "SELECT entity_key, MIN(at) AS at FROM record_revisions WHERE athlete_id = ? AND entity = 'actual_set' AND action = 'create' GROUP BY entity_key",
      )
      .all(athleteId) as { entity_key: string; at: string }[])
      m.set(r.entity_key, r.at.slice(0, 10));
    for (const r of this.db
      .prepare(
        'SELECT o.id AS id, b.created_at AS at FROM observed_sets o JOIN import_batches b ON b.id = o.batch_id WHERE o.athlete_id = ?',
      )
      .all(athleteId) as { id: string; at: string }[])
      m.set(r.id, r.at.slice(0, 10));
    return m;
  }
}
