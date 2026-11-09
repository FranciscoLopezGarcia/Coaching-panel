import { daysBetween } from '../dates.js';
import { pctFromTable } from '../e1rm.js';
import { f, floorToStep, signed } from '../format.js';
import { stepFor, type EngineParams, type LiftConfig } from '../params.js';
import type { ActualSet, Lift, Exposure, PlannedSet, RuleResult } from '../types.js';
import { exposureText, support } from './progress.js';
import { fact, result } from './result.js';

export interface NextTarget {
  reps: number;
  rpe: number;
  plannedKg: number | null;
  date: string;
}

/**
 * R-LOAD [propuesta] (rules.md §6). Propone kg; NUNCA lo aplica ni busca un PR.
 * Requiere las últimas `loadN` exposiciones completas y más holgadas que el objetivo (RPE real ≤ objetivo − margen).
 * Referencia conservadora = mínimo de E de las últimas N comparables; carga redondeada HACIA ABAJO al paso y limitada a `loadMaxSteps`.
 */
export function ruleLoad(
  comp: Exposure[],
  all: Exposure[],
  cfg: LiftConfig,
  p: EngineParams,
  cutoff: string,
  exposureId: string,
  next: NextTarget | null,
  actual: Map<string, ActualSet>,
  lift: Lift,
): RuleResult | null {
  const N = p.nExposures;
  const inWin = (e: Exposure) => daysBetween(cutoff, e.date) < p.windowDays;
  const last = all.filter(inWin).slice(-p.loadN);
  const refs = comp.filter(inWin).slice(-N);
  if (last.length < p.loadN || refs.length < N) return null; // sin base: lo informa R-PROGRESS
  const roomy = last.every(
    (e) =>
      e.setsDone === e.setsPlanned &&
      e.repsDone >= e.repsPlanned &&
      e.rpeDev !== null &&
      e.rpeDev <= -p.loadRpeMargin,
  );
  if (!roomy) return null;
  const base = {
    ruleId: 'R-LOAD' as const,
    exposureId,
    dataUntil: (last.at(-1) as Exposure).date,
    support: support(refs),
  };
  const lastExp = all.at(-1) as Exposure;
  const eRef = Math.min(...refs.map((e) => e.e as number));
  let target: (NextTarget & { fromLast?: boolean }) | null = next;
  if (!target) {
    const s = [...lastExp.plannedSets].reverse().find((x: PlannedSet) => x.targetRpe !== null);
    target = s
      ? { reps: s.reps, rpe: s.targetRpe as number, plannedKg: null, date: '', fromLast: true }
      : null;
  }
  if (!target) {
    return result({
      ...base,
      status: 'datos_insuficientes',
      summary: 'Holgura detectada pero no hay reps/RPE objetivo para calcular una carga.',
      missing: ['Una sesión prevista con RPE objetivo explícito.'],
    });
  }
  const pct = pctFromTable(target.reps, target.rpe);
  if (pct === null) {
    return result({
      ...base,
      status: 'datos_insuficientes',
      summary: `La tabla RPE no cubre ${target.reps} reps @ RPE ${target.rpe}.`,
      missing: ['Valor en la tabla RPE para ese objetivo.'],
    });
  }
  const sets = lastExp.doneSetIds.map((id) => actual.get(id) as ActualSet);
  const same = sets.filter((s) => s.reps === target.reps);
  const current = same.length
    ? Math.max(...same.map((s) => s.kg as number))
    : (lastExp.best as NonNullable<Exposure['best']>).kg;
  const step = stepFor(p, lift);
  const calc = floorToStep(eRef * pct, step);
  const cap = current + p.loadMaxSteps * step;
  const limit = cfg.loadLimitKg !== null && cfg.loadLimitKg > 0 ? cfg.loadLimitKg : null;
  let prop = Math.min(calc, cap);
  if (limit !== null) prop = Math.min(prop, limit);
  const evid = [
    `E de referencia conservadora (mínimo de las ${N} últimas): ${f(eRef, 1)} kg`,
    `Objetivo ${target.reps} reps @ RPE ${target.rpe}${target.fromLast ? ' (de la última exposición; no hay sesión prevista)' : ` (próxima sesión prevista ${target.date})`} → tabla ${f(pct * 100, 1)} %`,
    `Carga calculada ${f(calc, 1)} kg; carga actual ${f(current, 1)} kg${same.length ? '' : ` (mejor serie; ninguna con ${target.reps} reps)`}`,
    `Últimas ${p.loadN} exposiciones: series completas, reps cumplidas y RPE real − objetivo = ${last.map((e) => signed(e.rpeDev as number, 1)).join(' · ')}`,
    ...refs.map(exposureText),
  ];
  if (prop <= current) {
    return result({
      ...base,
      status: 'sin_senal',
      sufficiency: 'suficiente',
      summary: `Hay holgura de RPE, pero la carga calculada (${f(calc, 1)} kg) no supera la actual (${f(current, 1)} kg): no se sugiere salto.`,
      evidence: evid,
    });
  }
  if (target.plannedKg !== null && prop <= target.plannedKg) {
    return result({
      ...base,
      status: 'sin_senal',
      sufficiency: 'suficiente',
      summary: `La programación ya prevé ${f(target.plannedKg, 1)} kg (≥ la propuesta de ${f(prop, 1)} kg): no hace falta un cambio.`,
      evidence: evid,
    });
  }
  return result({
    ...base,
    status: 'margen_carga',
    facts: [
      fact('e_ref', 'E de referencia conservadora', eRef, 'kg', 'metrica', 'e1rm_table_rpe'),
      fact('pct_table', 'Fracción de tabla para el objetivo', pct),
      fact('calc_kg', 'Carga calculada', calc, 'kg'),
      fact('current_kg', 'Carga actual', current, 'kg'),
      fact('proposal_kg', 'Carga propuesta', prop, 'kg'),
      fact('step', 'Paso de carga', step, 'kg', 'parametro', 'stepKg'),
    ],
    sufficiency: 'suficiente',
    summary: `Margen para progresar carga: las últimas ${p.loadN} exposiciones salieron más livianas que el objetivo. Propuesta: ${f(prop, 1)} kg para ${target.reps}×@${target.rpe} (actual ${f(current, 1)} kg).`,
    evidence: evid,
    proposal: `Evaluar ${f(prop, 1)} kg (+${f(prop - current, 1)} kg) para ${target.reps} reps @ RPE ${target.rpe}, condicionado a la respuesta del calentamiento. Es una propuesta: no modifica la programación y no busca un PR.`,
    reviewWhen: 'Después de la próxima exposición de este slot.',
    alternatives:
      limit !== null && calc > limit
        ? [`La propuesta quedó limitada por el límite de carga del coach (${f(limit, 1)} kg).`]
        : [],
  });
}
