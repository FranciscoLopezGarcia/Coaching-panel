import { daysBetween } from '../dates.js';
import { f } from '../format.js';
import type { ActualSet, Exposure, PlannedSet, RuleResult } from '../types.js';
import type { RuleCtx } from './ctx.js';
import { exposureText, support } from './progress.js';
import { result } from './result.js';

/** Deterioro NO programado entre series de igual tarea (mismo kg y reps previstas): +1 RPE respecto del objetivo, o reps no completadas. */
export function sessionDeterioration(
  e: Exposure,
  actual: Map<string, ActualSet>,
): { deteriorated: boolean; why: string[] } {
  const why: string[] = [];
  const groups = new Map<string, PlannedSet[]>();
  for (const s of e.plannedSets) {
    const a = actual.get(s.id);
    if (a?.status !== 'done' || a.kg === null) continue;
    groups.set(`${a.kg}|${s.reps}`, [...(groups.get(`${a.kg}|${s.reps}`) ?? []), s]);
  }
  for (const [key, sets] of groups) {
    const ord = [...sets].sort((a, b) => a.setNo - b.setNo);
    const first = ord[0] as PlannedSet;
    const last = ord.at(-1) as PlannedSet;
    const fa = actual.get(first.id) as ActualSet;
    const la = actual.get(last.id) as ActualSet;
    // se compara el DESVÍO contra el objetivo: una progresión de RPE programada no cuenta como deterioro
    if (
      ord.length >= 2 &&
      fa.rpe !== null &&
      la.rpe !== null &&
      first.targetRpe !== null &&
      last.targetRpe !== null &&
      la.rpe - last.targetRpe - (fa.rpe - first.targetRpe) >= 1
    ) {
      why.push(`a ${key.split('|')[0]} kg el desvío de RPE subió ≥ 1 entre la 1.ª y la última serie`);
    }
  }
  for (const s of e.plannedSets) {
    const a = actual.get(s.id);
    if (a?.status === 'done' && a.reps !== null && a.reps < s.reps)
      why.push(`serie ${s.setNo}: ${a.reps} de ${s.reps} reps`);
  }
  return { deteriorated: why.length > 0, why };
}

/** ¿Hay patrón de deterioro intra-sesión con fatiga de final de sesión en ≥ N de las últimas exposiciones? */
export function frequencyPattern(
  all: Exposure[],
  c: RuleCtx,
): { pattern: boolean; bad: Exposure[]; returned: boolean; details: string[] } {
  const last = all.filter((e) => daysBetween(c.cutoff, e.date) < 2 * c.p.windowDays).slice(-4);
  const bad: Exposure[] = [];
  const details: string[] = [];
  for (const e of last) {
    const d = sessionDeterioration(e, c.actual);
    const fat = c.feedback.get(e.sessionKey) ?? null;
    if (d.deteriorated && fat !== null && fat >= c.p.fatigueThreshold) {
      bad.push(e);
      details.push(`${e.date}: ${d.why.join('; ')} · fatiga de final de sesión ${fat}/10`);
    }
  }
  const firstBad = bad[0] ? last.indexOf(bad[0]) : -1;
  const returned =
    firstBad >= 0 &&
    last
      .slice(firstBad + 1)
      .some((e) => !bad.includes(e) && e.rpeDev !== null && e.rpeDev <= c.p.rpeTolerance);
  return { pattern: bad.length >= c.p.freqDeteriorationN, bad, returned, details };
}

/**
 * R-FREQUENCY [propuesta] (rules.md §8): candidato a redistribuir el MISMO volumen semanal en más días.
 * Requiere deterioro no programado en ≥ 2 sesiones comparables junto con fatiga de final de sesión registrada, y que la siguiente exposición
 * vuelva a la referencia habitual. No atribuye causalidad si también cambian el volumen, el ejercicio o el esfuerzo.
 */
export function ruleFrequency(
  all: Exposure[],
  exposureId: string,
  c: RuleCtx,
  weekly: { sets: number; freq: number } | null,
): RuleResult | null {
  const fp = frequencyPattern(all, c);
  if (!fp.pattern) return null;
  const base = {
    ruleId: 'R-FREQUENCY' as const,
    exposureId,
    dataUntil: (fp.bad.at(-1) as Exposure).date,
    support: support(fp.bad),
  };
  const evid = [
    ...fp.details,
    ...all.slice(-4).map((e) => (e.e !== null ? exposureText(e) : `${e.date}: sin E`)),
  ];
  if (!fp.returned) {
    return result({
      ...base,
      status: 'sin_senal',
      summary:
        'Hay deterioro dentro de la sesión, pero la exposición siguiente no volvió a la referencia habitual: solo una hipótesis, no un candidato.',
      evidence: evid,
    });
  }
  const ws = weekly
    ? `${weekly.sets} series/semana en ${weekly.freq} día${weekly.freq === 1 ? '' : 's'} → ${weekly.freq + 1} días (≈ ${f(weekly.sets / (weekly.freq + 1), 1)} por día)`
    : 'mismo volumen semanal en un día más';
  return result({
    ...base,
    status: 'candidato_frecuencia',
    sufficiency: 'parcial',
    summary: `Candidato a redistribuir frecuencia: deterioro no programado y fatiga de final de sesión en ${fp.bad.length} sesiones comparables; la exposición siguiente volvió a la referencia.`,
    evidence: evid,
    proposal: `Redistribuir el MISMO volumen semanal en más días (${ws}), sujeto a la disponibilidad del atleta y a la revisión del coach. Medir si baja el deterioro sin empeorar la exposición siguiente.`,
    alternatives: [
      'No atribuir causalidad a la frecuencia si en el mismo período cambian también el volumen, el ejercicio o el esfuerzo.',
      'Si el deterioro coincide con una progresión de RPE programada, no corresponde.',
    ],
    reviewWhen: 'Después de 2–3 exposiciones con el nuevo reparto.',
  });
}
