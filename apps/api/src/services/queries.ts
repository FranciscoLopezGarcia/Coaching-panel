import { inputsFingerprint } from './fingerprint.js';
import {
  computeCore,
  CATALOG_VERSION,
  AVAILABILITY_MATRIX,
  METRIC_CATALOG,
  MUSCLE_CONVENTION_VERSION,
  annotations,
  comparePeriods,
  compareWeeks,
  computeObservedMetrics,
  computeRecords,
  e1rmCandles,
  macroSummary,
  mesoSummary,
  missingConfig,
  performanceSeries,
  recoverySeries,
  dailyLoad,
  weeklyByMovement,
  weeklyByMuscle,
  comparableTail,
  buildExposures,
  emptyQuality,
  type Exposure,
  type Lift,
  type ObservedSet,
  type PlannedSet,
} from '@coaching/engine';
import type { AthleteStateData, MetricsData } from '@coaching/contracts';
import type { DecisionsRepo } from '../repositories/decisions.js';
import type { HistoryRepo } from '../repositories/history.js';
import type { ProgrammingRepo } from '../repositories/programming.js';
import type { RecordsRepo } from '../repositories/records.js';
import type { DataLoader } from './data.js';
import { NotFoundError } from './errors.js';

const bySource = (obs: ObservedSet[], source?: string) =>
  source ? obs.filter((o) => o.source === source) : obs;

/** Consultas de LECTURA para el frontend. Nada escribe. Cada resultado indica período, fuente y limitaciones. */
export class QueryService {
  constructor(
    private loader: DataLoader,
    private decisions: DecisionsRepo,
    private history: HistoryRepo,
    private programming: ProgrammingRepo,
    private recordsRepo: RecordsRepo,
  ) {}

  catalog() {
    return {
      version: CATALOG_VERSION,
      metrics: METRIC_CATALOG,
      availability: AVAILABILITY_MATRIX,
      muscleConvention: MUSCLE_CONVENTION_VERSION,
    };
  }

  /** Variables núcleo (NL, SI, tonelaje, volumen muscular, fatiga) por sesión y semana. Solo lo observado hasta el corte. */
  async core(
    athleteId: string,
    q: {
      from: string;
      to: string;
      cutoff: string;
      lift?: Lift;
      source?: string;
      domain: 'recomendado' | 'amplio';
      view: 'weeks' | 'sessions' | 'all';
      basis?: 'realizado' | 'previsto';
    },
  ) {
    const d = await this.loader.load(athleteId, q.cutoff);
    const previsto = q.basis === 'previsto';
    const obs = previsto
      ? d.planned
          .filter((s) => !s.isWarmup)
          .map((s): ObservedSet => ({
            id: s.id,
            source: 'previsto',
            sessionKey: s.sessionKey,
            date: s.plannedDate,
            exerciseName: s.exerciseName,
            exerciseId: s.exerciseName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, ''),
            lift: s.lift,
            variantKey: s.variantKey,
            setType: 'work',
            kg: s.plannedKg,
            reps: s.reps,
            rpe: s.targetRpe,
            loadKind: 'total',
            plannedSetId: null,
            setNo: s.setNo,
            refKg: s.refKg,
            refSource: s.refKg ? 'plan' : null,
            refAsOf: null,
          }))
      : d.observed;
    const r = computeCore({
      obs,
      cutoff: q.cutoff,
      from: q.from,
      to: q.to,
      lift: q.lift,
      source: q.source,
      references: d.references,
      feedback: d.feedback,
      readiness: d.readinessHistory,
      planned: d.planned,
      domain: q.domain,
    });
    return {
      ...r,
      sessions: q.view === 'weeks' ? [] : r.sessions,
      weeks: q.view === 'sessions' ? [] : r.weeks,
      view: q.view,
      basis: previsto ? 'previsto' : 'realizado',
    };
  }

  async state(athleteId: string): Promise<AthleteStateData> {
    const d = await this.loader.load(athleteId);
    const ev = await this.decisions.latestEvaluation(athleteId);
    const lifts: AthleteStateData['lifts'] = {};
    if (ev) for (const l of Object.keys(ev.lifts) as Lift[]) if (ev.lifts[l]) lifts[l] = ev.lifts[l]!.state;
    return {
      cutoff: ev?.cutoff ?? '',
      rulesVersion: ev?.rulesVersion ?? '',
      paramsVersion: ev?.paramsVersion ?? '',
      lifts,
      missingConfig: missingConfig(d.params, Object.keys(d.competitionExercises) as Lift[]).map((m) => ({
        id: m.id,
        lift: m.lift,
        label: m.label,
        suspends: m.suspends,
      })),
      legacyEvaluation: !ev && (await this.decisions.hasLegacyEvaluation(athleteId)),
      freshness: ev
        ? await (async () => {
            const current = await inputsFingerprint(this.loader, this.history, athleteId, ev.cutoff);
            return {
              evaluatedCutoff: ev.cutoff,
              storedFingerprint: ev.inputFingerprint ?? null,
              currentFingerprint: current,
              inputsChangedSinceEvaluation: ev.inputFingerprint ? ev.inputFingerprint !== current : null,
            };
          })()
        : null,
    };
  }

  async metrics(
    athleteId: string,
    q: {
      from: string;
      to: string;
      lift: Lift | 'ALL';
      exercise?: string;
      referenceMode: 'original' | 'retrospective';
      cutoff: string;
      source?: string;
    },
  ): Promise<MetricsData> {
    const d = await this.loader.load(athleteId, q.cutoff);
    return {
      cutoff: q.cutoff,
      period: { from: q.from, to: q.to },
      source: q.source ?? 'todas',
      referenceMode: q.referenceMode,
      metrics: computeObservedMetrics({
        obs: bySource(d.observed, q.source),
        cutoff: q.cutoff,
        from: q.from,
        to: q.to,
        scope: { athleteId, lift: q.lift, exercise: q.exercise },
        references: d.references,
        referenceMode: q.referenceMode,
      }),
    };
  }

  async records(athleteId: string, cutoff: string, source?: string) {
    const d = await this.loader.load(athleteId, cutoff);
    return {
      cutoff,
      source: source ?? 'todas',
      records: computeRecords(bySource(d.observed, source), cutoff),
      note: 'Los récords reales (single, carga para reps, reps con carga, marca a un RPE) están separados del mejor e1RM estimado, que NO es un PR.',
    };
  }

  async weekly(athleteId: string, q: { from: string; to: string; cutoff: string; source?: string }) {
    const d = await this.loader.load(athleteId, q.cutoff);
    return weeklyByMovement({
      planned: d.planned,
      observed: bySource(d.observed, q.source),
      from: q.from,
      to: q.to,
      cutoff: q.cutoff,
      references: d.references,
    });
  }
  async weeklyMuscles(athleteId: string, q: { from: string; to: string; cutoff: string; source?: string }) {
    return weeklyByMuscle(
      bySource((await this.loader.load(athleteId, q.cutoff)).observed, q.source),
      q.from,
      q.to,
      q.cutoff,
    );
  }
  async weekCompare(
    athleteId: string,
    q: { lift: Lift | 'ALL'; exercise?: string; cutoff: string; source?: string },
  ) {
    const d = await this.loader.load(athleteId, q.cutoff);
    return compareWeeks({
      observed: bySource(d.observed, q.source),
      cutoff: q.cutoff,
      scope: { lift: q.lift, exercise: q.exercise },
      references: d.references,
    });
  }
  async comparePeriods(
    athleteId: string,
    q: {
      aFrom: string;
      aTo: string;
      bFrom: string;
      bTo: string;
      lift: Lift | 'ALL';
      exercise?: string;
      cutoff: string;
      source?: string;
    },
  ) {
    const d = await this.loader.load(athleteId, q.cutoff);
    return comparePeriods({
      observed: bySource(d.observed, q.source),
      a: { from: q.aFrom, to: q.aTo },
      b: { from: q.bFrom, to: q.bTo },
      cutoff: q.cutoff,
      scope: { lift: q.lift, exercise: q.exercise },
      references: d.references,
    });
  }

  /** Series de rendimiento por método (con velas OHLC solo si hay ≥ 2 observaciones comparables), carga solo en días con registro y recuperación. */
  async series(athleteId: string, q: { from: string; to: string; cutoff: string; source?: string }) {
    const d = await this.loader.load(athleteId, q.cutoff);
    const obs = bySource(d.observed, q.source);
    const perf = performanceSeries(obs, q.cutoff);
    return {
      cutoff: q.cutoff,
      performance: perf.series.map((s) => ({ ...s, ...e1rmCandles(s, q.cutoff) })),
      methodTransitions: perf.methodTransitions,
      load: dailyLoad(obs, q.from, q.to),
      recovery: recoverySeries(d.readinessHistory, q.from, q.to),
      notes: [
        'Los métodos de e1RM y las variantes van en series separadas; no se unen en una tendencia.',
        'La carga solo aparece en días con registro: un día sin registro no es un descanso confirmado.',
      ],
    };
  }

  async annotations(athleteId: string, q: { from: string; to: string }) {
    const d = await this.loader.load(athleteId);
    return annotations({
      changes: d.events.map((e) => ({
        id: e.id,
        effectiveOn: e.effectiveOn,
        detectedOn: e.detectedOn,
        summary: e.changes.map((c) => c.summary).join(' ') || 'Cambio de programación',
      })),
      interventions: d.interventions.map((i) => ({
        id: i.id,
        appliedOn: i.appliedOn,
        description: i.appliedDescription,
      })),
      competitions: (await this.history.listCompetitions(athleteId)).map((c) => ({
        id: c.id,
        date: c.date,
        name: c.name,
      })),
      from: q.from,
      to: q.to,
    });
  }

  async macros(athleteId: string) {
    return await this.programming.listMacros(athleteId);
  }
  async macro(athleteId: string, id: string, cutoff: string) {
    const d = await this.loader.load(athleteId, cutoff);
    const macro = d.macros.find((m) => m.id === id);
    if (!macro) throw new NotFoundError('Macro inexistente');
    return macroSummary({ macro, mesos: d.mesos, planned: d.planned, cutoff });
  }
  /** Macro activo. Con varios activos devuelve el de inicio más reciente (o el pedido por id) e informa los demás: no se elige en silencio. */
  async activeMacro(athleteId: string, cutoff: string, macroId?: string) {
    const d = await this.loader.load(athleteId, cutoff);
    const actives = d.macros.filter((m) => m.status === 'activo');
    const macro = macroId ? (d.macros.find((m) => m.id === macroId) ?? null) : (actives[0] ?? null);
    if (macroId && !macro) throw new NotFoundError('Macro inexistente');
    if (!macro) return null;
    return {
      ...macroSummary({ macro, mesos: d.mesos, planned: d.planned, cutoff }),
      selection: macroId
        ? 'explicita'
        : actives.length > 1
          ? 'mas_reciente_entre_varios_activos'
          : 'unico_activo',
      otherActiveMacros: actives
        .filter((m) => m.id !== macro.id)
        .map((m) => ({ id: m.id, name: m.name, startDate: m.startDate })),
    };
  }
  async meso(athleteId: string, blockKey: string, cutoff: string) {
    const d = await this.loader.load(athleteId, cutoff);
    // un meso creado y todavía sin series existe (resumen vacío); solo es 404 si no hay ni meso ni series
    if (!d.planned.some((s) => s.blockKey === blockKey) && !d.mesos.some((m) => m.blockKey === blockKey))
      throw new NotFoundError('Meso inexistente');
    return mesoSummary({
      blockKey,
      meta: d.mesos.find((m) => m.blockKey === blockKey) ?? null,
      micro: d.micros,
      planned: d.planned,
      actual: d.actual,
      observed: d.observed,
      competitionExercises: d.competitionExercises,
      readiness: d.readinessHistory,
      params: d.params,
      cutoff,
    });
  }

  /** Detalle de una exposición: sus instancias (programación y ejecución), segmentos de comparabilidad y origen de la identidad. */
  async exposure(athleteId: string, exposureId: string, cutoff: string) {
    const d = await this.loader.load(athleteId, cutoff);
    const sets = d.planned.filter((s) => s.exposureId === exposureId);
    if (!sets.length) throw new NotFoundError('Exposición inexistente');
    const amap = new Map(d.actual.map((a) => [a.plannedSetId, a]));
    const bench = sets.filter((s) => !s.isWarmup);
    const exps: Exposure[] = buildExposures(bench, amap, cutoff, emptyQuality());
    const { current, breaks } = comparableTail(exps);
    const sessions = [...new Set(sets.map((s) => s.sessionKey))].map((k) => {
      const ss = sets.filter((s) => s.sessionKey === k).sort((a, b) => a.setNo - b.setNo) as PlannedSet[];
      return {
        sessionKey: k,
        date: ss[0]!.plannedDate,
        location: {
          slotKey: ss[0]!.slotKey,
          dayNo: ss[0]!.dayNo,
          weekNo: ss[0]!.weekNo,
          blockKey: ss[0]!.blockKey,
        },
        variantKey: ss[0]!.variantKey,
        copiedFrom: ss.map((s) => s.copiedFrom).find((x) => x) ?? null,
        sets: ss.map((s) => ({
          setNo: s.setNo,
          planned: {
            reps: s.reps,
            targetRpe: s.targetRpe,
            kg: s.plannedKg,
            kgSource: s.plannedKgSource,
            protocol: s.protocol,
          },
          actual: amap.get(s.id) ?? null,
        })),
      };
    });
    return {
      exposureId,
      role: sets[0]!.exposureRole,
      priority: sets[0]!.priority,
      exercise: sets[0]!.exerciseName,
      identity: {
        source: await this.recordsRepo.identitySource(athleteId, exposureId),
        links: d.appliedLinks.filter((l) => l.to === exposureId || l.from === exposureId),
        note: 'La identidad es estable al mover la sesión; compartirla NO implica comparabilidad (ver segmentos).',
      },
      comparability: { segments: breaks.length + 1, breaks, currentSegmentExposures: current.length },
      sessions: sessions.sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
  }
  /** Abre los registros que sustentan una recomendación: sesiones (con series previstas y hechas), check-ins y revisiones. */
  async evidence(athleteId: string, key: string, cutoff: string) {
    const dec = await this.decisions.get(athleteId, key);
    if (!dec) throw new NotFoundError('Recomendación inexistente');
    const d = await this.loader.load(athleteId, cutoff);
    const amap = new Map(d.actual.map((a) => [a.plannedSetId, a]));
    const refs = dec.explanation?.refs ?? [];
    return {
      key,
      explanation: dec.explanation,
      assessment: dec.assessment,
      records: refs.map((r) => {
        if (r.kind === 'session')
          return {
            ref: r,
            sets: d.planned
              .filter((s) => s.sessionKey === r.id)
              .map((s) => ({ planned: s, actual: amap.get(s.id) ?? null })),
          };
        if (r.kind === 'checkin')
          return { ref: r, checkin: d.readinessHistory.find((x) => x.date === r.id) ?? null };
        if (r.kind === 'review')
          return { ref: r, review: d.reviews.find((x) => `${x.lift}:${x.date}` === r.id) ?? null };
        return { ref: r };
      }),
    };
  }
}
