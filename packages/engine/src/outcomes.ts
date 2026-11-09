import { daysBetween } from './dates.js';
import { evaluateChange } from './change.js';
import type { ChangeEvent } from './diff.js';
import { LIFT_LABEL } from './diff.js';
import { buildExposures, emptyQuality } from './exposures.js';
import { f, median, signed } from './format.js';
import type { EngineParams } from './params.js';
import type { ActualSet, Exposure, Lift, PlannedSet, Readiness } from './types.js';

export type OutcomeState = 'pendiente' | 'evaluado' | 'afectado' | 'sin_referencia' | 'sin_fecha_efectiva';

/** Qué ocurrió DESPUÉS de un cambio. Lenguaje descriptivo ("tras el cambio se observó…"): no afirma causalidad. */
export interface Outcome {
  eventId: string;
  lift: Lift;
  blockKey: string;
  state: OutcomeState;
  horizonN: number;
  before: number | null;
  after: number | null;
  deltaKg: number | null;
  deltaPct: number | null;
  /** null = sin cambio mínimo definido (no se clasifica). */
  exceeds: boolean | null;
  rpeDevAfter: number | null;
  complianceAfter: number | null;
  readinessBefore: number | null;
  readinessAfter: number | null;
  /** Otros cambios del programa (u otras variaciones) que caen dentro de la ventana de seguimiento. */
  competing: string[];
  coverage: string;
  text: string;
}

export interface FollowUpInput {
  planned: PlannedSet[];
  actual: ActualSet[];
  readiness: Readiness[];
  competitionExercises: Partial<Record<Lift, string>>;
  cutoff: string;
  params: EngineParams;
  /** Todos los eventos del atleta, para detectar cambios competidores. */
  events: ChangeEvent[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface ObserveInput {
  /** Etiqueta para el texto ("tras el cambio (…)" / "tras la intervención (…)"). */
  label: string;
  eventId: string;
  lift: Lift;
  blockKey: string;
  status: 'aplicado' | 'borrador';
  effectiveOn: string | null;
  effectiveEstimated: boolean;
  /** Otros cambios del programa o intervenciones que caen en la ventana de seguimiento. */
  competingFinder: (from: string, to: string) => string[];
}

/** El horizonte (N exposiciones comparables) se define ANTES de evaluar: params.nExposures. */
export function observeAfter(o: ObserveInput, inp: Omit<FollowUpInput, 'events'>): Outcome {
  const N = inp.params.nExposures;
  const amap = new Map(inp.actual.map((a) => [a.plannedSetId, a]));
  const base = {
    eventId: o.eventId,
    lift: o.lift,
    blockKey: o.blockKey,
    horizonN: N,
    before: null,
    after: null,
    deltaKg: null,
    deltaPct: null,
    exceeds: null,
    rpeDevAfter: null,
    complianceAfter: null,
    readinessBefore: null,
    readinessAfter: null,
    competing: [] as string[],
  };
  if (o.status === 'borrador')
    return {
      ...base,
      state: 'pendiente',
      coverage: 'borrador',
      text: 'Versión en borrador: todavía no hay seguimiento.',
    };
  if (!o.effectiveOn)
    return {
      ...base,
      state: 'sin_fecha_efectiva',
      coverage: '—',
      text: 'No se conoce la fecha desde la que rige el cambio: no se puede delimitar un antes y un después.',
    };
  const eff = o.effectiveOn;
  if (eff > inp.cutoff)
    return {
      ...base,
      state: 'pendiente',
      coverage: `rige desde ${eff}`,
      text: `El cambio rige desde ${eff}${o.effectiveEstimated ? ' (fecha estimada)' : ''}: todavía no empezó, así que no hay seguimiento.`,
    };
  const bench = inp.planned.filter(
    (s) => s.lift === o.lift && s.exerciseName === inp.competitionExercises[o.lift] && !s.isWarmup,
  );
  const comp = buildExposures(bench, amap, inp.cutoff, emptyQuality()).filter(
    (e): e is Exposure => e.e !== null,
  );
  const before = comp.filter((e) => e.date < eff).slice(-N);
  const after = comp.filter((e) => e.date >= eff).slice(0, N);
  const cover = `${after.length} de ${N} exposiciones comparables posteriores (${daysBetween(inp.cutoff, eff)} días desde la fecha efectiva${o.effectiveEstimated ? ', estimada' : ''})`;
  if (after.length < N)
    return {
      ...base,
      state: 'pendiente',
      coverage: cover,
      text: `Seguimiento pendiente: ${cover}. No se evalúa todavía ni se da por positivo.`,
    };
  if (before.length < N)
    return {
      ...base,
      state: 'sin_referencia',
      coverage: cover,
      text: `Historial incompleto: solo ${before.length} de ${N} exposiciones comparables previas; no se arma un relato de antes/después.`,
    };
  const mb = median(before.map((e) => e.e as number));
  const ma = median(after.map((e) => e.e as number));
  const c = evaluateChange(mb, ma - mb, inp.params.perLift[o.lift]);
  const lastAfter = (after[after.length - 1] as Exposure).date;
  const competing = o.competingFinder(eff, lastAfter);
  const devs = after.map((e) => e.rpeDev).filter((d): d is number => d !== null);
  const rd = (from: string, to: string) =>
    mean(inp.readiness.filter((r) => r.date >= from && r.date <= to).map((r) => r.value));
  const rb = rd((before[0] as Exposure).date, (before[before.length - 1] as Exposure).date);
  const ra = rd((after[0] as Exposure).date, lastAfter);
  const verbo = competing.length ? 'coincidió con' : 'se observó';
  const dir = !c.defined
    ? `E ${signed(ma - mb, 1)} kg (sin cambio mínimo definido: no se clasifica)`
    : c.exceeds
      ? `E ${ma > mb ? 'subió' : 'bajó'} ${signed(ma - mb, 1)} kg (${signed(c.pct ?? 0, 1)} %)`
      : `E sin cambio relevante (${signed(ma - mb, 1)} kg)`;
  return {
    ...base,
    state: competing.length ? 'afectado' : 'evaluado',
    before: mb,
    after: ma,
    deltaKg: ma - mb,
    deltaPct: c.pct,
    exceeds: c.exceeds,
    rpeDevAfter: devs.length ? median(devs) : null,
    complianceAfter: mean(after.map((e) => e.compliance)),
    readinessBefore: rb,
    readinessAfter: ra,
    competing,
    coverage: cover,
    text:
      `${LIFT_LABEL[o.lift]} · tras ${o.label} ${verbo}: ${dir}; mediana de las ${N} exposiciones previas ${f(mb, 1)} kg → ${f(ma, 1)} kg.` +
      (devs.length ? ` RPE real − objetivo ${signed(median(devs), 1)}.` : '') +
      (competing.length
        ? ` Hubo otros cambios en la ventana (${competing.join(', ')}): no se atribuye el resultado al primero.`
        : '') +
      ' Es una observación, no una prueba de causalidad.',
  };
}

export function followUps(event: ChangeEvent, inp: FollowUpInput): Outcome[] {
  const out: Outcome[] = [];
  for (const ch of event.changes) {
    if (ch.classification === 'bloque_retirado') continue;
    out.push(
      observeAfter(
        {
          label: `el cambio (${ch.classification.replace(/_/g, ' ')})`,
          eventId: event.id,
          lift: ch.lift,
          blockKey: ch.blockKey,
          status: event.status,
          effectiveOn: event.effectiveOn,
          effectiveEstimated: event.effectiveEstimated,
          competingFinder: (from, to) =>
            inp.events
              .filter(
                (e) =>
                  e.id !== event.id &&
                  e.status === 'aplicado' &&
                  e.effectiveOn &&
                  e.effectiveOn >= from &&
                  e.effectiveOn <= to &&
                  e.changes.some((x) => x.lift === ch.lift),
              )
              .map((e) => `${e.id} (${e.effectiveOn})`),
        },
        inp,
      ),
    );
  }
  return out;
}

export interface Deviation {
  lift: Lift;
  blockKey: string;
  weekNo: number;
  plannedNl: number;
  doneNl: number;
  plannedSets: number;
  doneSets: number;
  skippedSets: number;
  compliance: number;
  status: 'sin_registro' | 'cumplido' | 'desviacion';
  text: string;
}

/** Desviación de EJECUCIÓN (previsto vs realizado): no es una decisión del coach por defecto. Solo semanas ya transcurridas. */
export function executionDeviations(
  planned: PlannedSet[],
  actual: ActualSet[],
  cutoff: string,
  minCompliance: number,
): Deviation[] {
  const amap = new Map(actual.map((a) => [a.plannedSetId, a]));
  const groups = new Map<string, PlannedSet[]>();
  for (const s of planned)
    if (s.lift && !s.isWarmup)
      groups.set(`${s.lift}|${s.blockKey}|${s.weekNo}`, [
        ...(groups.get(`${s.lift}|${s.blockKey}|${s.weekNo}`) ?? []),
        s,
      ]);
  const out: Deviation[] = [];
  for (const [key, sets] of groups) {
    if (sets.some((s) => s.plannedDate > cutoff)) continue; // semana todavía en curso o futura
    const [lift, blockKey, week] = key.split('|') as [Lift, string, string];
    const recs = sets
      .map((s) => amap.get(s.id))
      .filter(
        (a): a is ActualSet => !!a && a.status !== 'pending' && !(a.performedOn && a.performedOn > cutoff),
      );
    const done = sets.filter((s) => amap.get(s.id)?.status === 'done');
    const plannedNl = sets.reduce((a, s) => a + s.reps, 0);
    const doneNl = done.reduce((a, s) => a + ((amap.get(s.id) as ActualSet).reps ?? 0), 0);
    const compliance = done.length / sets.length;
    const status =
      recs.length === 0
        ? 'sin_registro'
        : compliance >= minCompliance && doneNl >= plannedNl
          ? 'cumplido'
          : 'desviacion';
    out.push({
      lift,
      blockKey,
      weekNo: Number(week),
      plannedNl,
      doneNl,
      plannedSets: sets.length,
      doneSets: done.length,
      skippedSets: sets.filter((s) => amap.get(s.id)?.status === 'skipped').length,
      compliance,
      status,
      text:
        status === 'sin_registro'
          ? `${LIFT_LABEL[lift]} · ${blockKey} sem ${week}: sin registro (no se interpreta como descarga ni como incumplimiento).`
          : `${LIFT_LABEL[lift]} · ${blockKey} sem ${week}: ejecutó ${doneNl} NL frente a ${plannedNl} previstos (cumplimiento ${Math.round(compliance * 100)} %). Desviación de ejecución, no una reducción elegida por el coach.`,
    });
  }
  return out.sort(
    (a, b) => a.blockKey.localeCompare(b.blockKey) || a.weekNo - b.weekNo || a.lift.localeCompare(b.lift),
  );
}
