import { daysBetween } from '../dates.js';
import { e1rm, pctFromTable } from '../e1rm.js';
import { METHOD_CURVE } from '../e1rm-methods.js';
import { f, floorToStep, median } from '../format.js';
import { evaluateChange } from '../change.js';
import { prEffortGapFor, prExtrapolationRepsFor, prRpeFor, singleMaxAllowed, stepFor } from '../params.js';
import type { PrCandidate, PrScenario } from '../pr-candidate.js';
import { recordLoadForReps } from '../records.js';
import type { Exposure, RuleResult } from '../types.js';
import type { RuleCtx } from './ctx.js';
import type { NextTarget } from './load.js';
import { exposureText, support } from './progress.js';
import { fact, result } from './result.js';

const modeOf = (xs: number[]): number => {
  const m = new Map<number, number>();
  xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] as number;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * R-PR [propuesta]: candidato a récord de CARGA para repeticiones, con RPE objetivo configurable (no universal). Single máximo apagado por defecto.
 * Un mejor e1RM NO es un PR real. La estimación se lee bajo escenarios de RPE (0, +s, +2s; s = `rpeSensitivity`): son lecturas de sensibilidad,
 * NO un intervalo de confianza ni un margen de seguridad estadístico.
 *  Candidato defendible = la carga supera el récord previo en ≥ 1 paso bajo el escenario +s Y +2s, sin extrapolar repeticiones ni esfuerzo.
 *  Si la oportunidad depende del RPE reportado, extrapola reps/esfuerzo o está al borde (récord + un paso), NO se afirma un candidato:
 *  se emite "oportunidad pendiente de evaluación". Nunca se redondea hacia arriba para fabricar un récord.
 */
export function rulePR(
  comp: Exposure[],
  exposureId: string,
  next: NextTarget | null,
  c: RuleCtx,
): RuleResult | null {
  const N = c.p.nExposures;
  const rec = comp.filter((e) => daysBetween(c.cutoff, e.date) < c.p.windowDays).slice(-N);
  if (rec.length < N) return null;
  const base = {
    ruleId: 'R-PR' as const,
    exposureId,
    dataUntil: (rec.at(-1) as Exposure).date,
    support: support(rec),
  };
  const best = rec.map((e) => e.best as NonNullable<Exposure['best']>);
  const attemptRpe = prRpeFor(c.p, c.lift);
  const step = stepFor(c.p, c.lift);
  const reps = c.cfg.prReps ?? next?.reps ?? modeOf(best.map((b) => b.reps));
  const tipo = `carga para ${reps} reps @ RPE ${attemptRpe} (récord de peso para repeticiones; no es un single máximo ni un e1RM)`;
  if (reps === 1 && !singleMaxAllowed(c.p, c.lift)) {
    return result({
      ...base,
      status: 'sin_senal',
      summary:
        'Un single máximo requiere habilitación explícita del coach (apagado por defecto) y contexto de testing o competencia: no se propone.',
      evidence: rec.map(exposureText),
    });
  }
  const prev = comp.filter((e) => e.date < (rec[0] as Exposure).date).slice(-N);
  const medRec = median(rec.map((e) => e.e as number));
  let favorable: boolean;
  if (prev.length === N) {
    const ch = evaluateChange(
      median(prev.map((e) => e.e as number)),
      medRec - median(prev.map((e) => e.e as number)),
      c.cfg,
    );
    favorable = ch.defined ? !(ch.exceeds && ch.kg < 0) : medRec >= median(prev.map((e) => e.e as number));
  } else favorable = (rec.at(-1)?.e as number) >= (rec[0]?.e as number);
  const clean = rec.every(
    (e) =>
      e.compliance >= c.p.minCompliance &&
      e.setsSkipped === 0 &&
      e.rpeDev !== null &&
      e.rpeDev <= c.p.rpeTolerance,
  );
  const evid: string[] = [`Tipo de récord: ${tipo}`, ...rec.map(exposureText)];
  if (!favorable || !clean) {
    return result({
      ...base,
      status: 'sin_senal',
      summary: !favorable
        ? 'No se evalúa un récord: la tendencia reciente no es favorable ni estable.'
        : 'No se evalúa un récord: hubo fallos, series omitidas, cumplimiento bajo o RPE por encima del objetivo (o sin objetivo cargado) en los benchmarks recientes.',
      evidence: evid,
    });
  }
  const pct = pctFromTable(reps, attemptRpe);
  if (pct === null)
    return result({
      ...base,
      status: 'datos_insuficientes',
      summary: `La tabla RPE no cubre ${reps} reps @ RPE ${attemptRpe}.`,
      missing: ['Valor en la tabla RPE para el objetivo del intento.'],
    });
  const exercise = c.bench[0]?.exerciseName ?? '';
  const variantKey = (rec.at(-1) as Exposure).variantKey;
  const record = recordLoadForReps(c.observed, exercise, variantKey, reps, c.cutoff);
  const limit = c.cfg.loadLimitKg;
  const s = c.p.rpeSensitivity;
  const scenarios: PrScenario[] = [];
  for (const shift of [0, s, 2 * s]) {
    const es = best.map((b) => e1rm(b.kg, b.reps, Math.min(10, b.rpe + shift)));
    if (es.some((x) => x === null)) return null;
    const eCons = Math.min(...(es as number[]));
    const kg = floorToStep(eCons * pct, step);
    scenarios.push({
      rpeShift: shift,
      eCons,
      kg,
      holds: record !== null && kg >= record.value + step && (limit === null || kg <= limit),
    });
  }
  evid.push(
    `Escenarios de lectura (RPE reportado + desplazamiento; NO un intervalo estadístico): ${scenarios.map((x) => `+${x.rpeShift}: E ${f(x.eCons, 1)} → ${f(x.kg, 1)} kg`).join(' · ')}`,
    `Récord previo de carga para ≥ ${reps} reps (${exercise}, variante ${variantKey}): ${record ? `${f(record.value, 1)} kg el ${record.date}` : 'sin registro'}`,
  );
  const facts = [
    fact('reps', 'Repeticiones del intento', reps, 'reps'),
    fact('attempt_rpe', 'RPE objetivo del intento', attemptRpe, 'RPE', 'parametro', 'prRpe'),
    fact('step', 'Paso de carga', step, 'kg', 'parametro', 'stepKg'),
    fact('record', 'Récord previo', record?.value ?? null, 'kg', 'metrica', 'record_load_for_reps'),
    ...scenarios.map((x) =>
      fact(`kg_shift_${x.rpeShift}`, `Carga candidata con RPE +${x.rpeShift}`, x.kg, 'kg'),
    ),
  ];
  if (!record)
    return result({
      ...base,
      status: 'sin_senal',
      summary: `No hay un récord previo de ${reps} reps registrado para esta variante: no se puede decir que haya un PR por batir.`,
      evidence: evid,
      missing: [`Series hechas del ejercicio con ≥ ${reps} reps`],
      facts,
    });
  const main = scenarios[1] as PrScenario;
  if (!main.holds) {
    return result({
      ...base,
      status: 'sin_senal',
      sufficiency: 'suficiente',
      summary: `Sin oportunidad de récord: con la lectura de sensibilidad +${s} de RPE la carga calculada (${f(main.kg, 1)} kg) ${main.kg < record.value + step ? `no supera el récord previo (${f(record.value, 1)} kg) más un paso` : `excede el límite del coach (${f(limit as number, 1)} kg)`}. No se redondea hacia arriba.`,
      evidence: evid,
      facts,
    });
  }
  const benchRpeMean = mean(best.map((b) => b.rpe));
  const effortGap = benchRpeMean === null ? null : attemptRpe - benchRpeMean;
  const extrapolatedReps =
    Math.abs(reps - median(best.map((b) => b.reps))) > prExtrapolationRepsFor(c.p, c.lift);
  const extrapolatedEffort = effortGap !== null && effortGap > prEffortGapFor(c.p, c.lift);
  const sensitiveToRpe = !(scenarios[2] as PrScenario).holds;
  const marginal = main.kg === record.value + step;
  const rd = c.readinessHistory
    .filter((r) => r.date <= c.cutoff)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const checkNow = !!rd && daysBetween(c.cutoff, rd.date) <= c.p.prCheckMaxAgeDays;
  const review = c.reviews
    .filter((r) => r.lift === c.lift && r.date <= c.cutoff)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const reviewOk =
    !!review &&
    review.verdict === 'valida' &&
    daysBetween(c.cutoff, review.date) <= c.p.coachReviewValidityDays;
  const validated = checkNow || reviewOk;
  const pendingEval: string[] = [];
  if (extrapolatedReps)
    pendingEval.push(
      `El intento (${reps} reps) se aleja más de ${prExtrapolationRepsFor(c.p, c.lift)} reps de las que se hicieron en los benchmarks (${best.map((b) => b.reps).join(', ')}): extrapolación de repeticiones.`,
    );
  if (extrapolatedEffort)
    pendingEval.push(
      `El intento es a RPE ${attemptRpe} y los benchmarks se hicieron en promedio a RPE ${f(benchRpeMean as number, 1)} (brecha ${f(effortGap as number, 1)} > ${prEffortGapFor(c.p, c.lift)}): extrapolación de esfuerzo.`,
    );
  if (sensitiveToRpe)
    pendingEval.push(
      `La oportunidad desaparece si el RPE reportado estaba subestimado en +${2 * s}: depende de la exactitud del RPE.`,
    );
  const conditions = [
    `ejercicio ${exercise}`,
    `variante ${variantKey}`,
    `carga ${rec.at(-1)?.best ? 'registrada' : ''}`.trim(),
  ];
  const candidate: PrCandidate = {
    type: 'load_for_reps',
    exercise,
    variantKey,
    conditions,
    previousRecord: { kg: record.value, reps, date: record.date, setRef: record.setRef },
    protocol: { reps, rpe: attemptRpe, kg: main.kg },
    step,
    method: METHOD_CURVE,
    scenarios,
    reference: {
      benchmarkReps: best.map((b) => b.reps),
      benchmarkRpeMean: benchRpeMean,
      attemptRpe,
      effortGap,
    },
    recency: {
      lastBenchmark: base.dataUntil,
      daysSince: daysBetween(c.cutoff, base.dataUntil),
      checkIn: checkNow ? (rd?.date ?? null) : null,
      coachReview: reviewOk ? (review?.date ?? null) : null,
    },
    comparability: `Benchmarks de la misma exposición y variante (${variantKey}).`,
    flags: { extrapolatedReps, extrapolatedEffort, sensitiveToRpe, marginal },
    pendingConditions: [
      ...pendingEval,
      ...(validated
        ? []
        : ['Chequeo actual: check-in de ≤ ' + c.p.prCheckMaxAgeDays + ' días o revisión del coach vigente.']),
    ],
    readiness: pendingEval.length ? 'pendiente_evaluacion' : validated ? 'listo' : 'pendiente_validacion',
  };
  evid.push(
    review
      ? `Revisión técnica del coach: ${review.verdict} (${review.date})`
      : 'Técnica no validada en la app',
    `Chequeo actual: ${checkNow ? `check-in del ${rd?.date}` : reviewOk ? 'revisión del coach vigente' : 'no hay check-in de ≤ ' + c.p.prCheckMaxAgeDays + ' días ni revisión del coach vigente'}`,
  );
  const extra = marginal
    ? [
        `La carga candidata es exactamente el récord más un paso (${f(record.value + step, 1)} kg): es un caso al borde, no un margen holgado.`,
      ]
    : [];
  if (pendingEval.length) {
    return result({
      ...base,
      status: 'oportunidad_pendiente',
      sufficiency: 'parcial',
      candidate,
      summary: `Oportunidad pendiente de evaluación: ${f(main.kg, 1)} kg × ${reps} @ RPE ${attemptRpe} (récord previo ${f(record.value, 1)} kg), pero no hay un candidato suficientemente defendible.`,
      evidence: evid,
      missing: pendingEval,
      alternatives: extra,
      proposal:
        'Evaluar con el atleta y el coach si el intento es razonable. Esta lectura no es una probabilidad de éxito ni autoriza un intento.',
      reviewWhen: 'Con más benchmarks cercanos al esfuerzo del intento.',
      facts,
    });
  }
  return result({
    ...base,
    status: 'candidato_pr',
    sufficiency: validated ? 'suficiente' : 'parcial',
    candidate,
    summary: `${validated ? 'Candidato a récord' : 'Oportunidad potencial, pendiente validar'}: ${f(main.kg, 1)} kg × ${reps} @ RPE ${attemptRpe} (récord previo ${f(record.value, 1)} kg).`,
    evidence: evid,
    missing: validated ? [] : candidate.pendingConditions,
    alternatives: extra,
    proposal: `Evaluar ${f(main.kg, 1)} kg × ${reps} reps @ RPE ${attemptRpe} sobre un récord de ${f(record.value, 1)} kg, condicionado a la respuesta del calentamiento y a la validación del coach. Aprobar la propuesta no implica ejecutarla. No es una probabilidad de éxito.`,
    reviewWhen: 'Antes de la sesión, con el chequeo del día.',
    facts,
  });
}
