import { daysBetween } from '../dates.js';
import { changeText, evaluateChange } from '../change.js';
import { f, median, signed } from '../format.js';
import type { EngineParams, LiftConfig } from '../params.js';
import type { Exposure, RuleResult } from '../types.js';
import { fact, result } from './result.js';

export const exposureText = (e: Exposure): string =>
  `${e.date}: E ${f(e.e as number, 1)} kg (${e.best?.kg}×${e.best?.reps}@${e.best?.rpe})`;
export const support = (xs: Exposure[]): string[] => xs.map((e) => `${e.date} (${e.sessionKey})`);

/**
 * R-PROGRESS [propuesta] (rules.md §5). Mediana de E de las últimas N exposiciones comparables del slot vs las N anteriores,
 * con RPE dentro de objetivo+tolerancia y cumplimiento suficiente. Con solo la ventana reciente: "tendencia inicial", nunca "sostenido".
 */
export function ruleProgress(
  comp: Exposure[],
  cfg: LiftConfig,
  p: EngineParams,
  cutoff: string,
  exposureId: string,
): RuleResult {
  const N = p.nExposures;
  const recent = comp.filter((e) => daysBetween(cutoff, e.date) < p.windowDays).slice(-N);
  const base = { ruleId: 'R-PROGRESS' as const, exposureId };
  if (recent.length < N) {
    return result({
      ...base,
      status: 'datos_insuficientes',
      dataUntil: comp.at(-1)?.date ?? '',
      summary: `Faltan exposiciones comparables para evaluar progreso (${recent.length} de ${N} en los últimos ${p.windowDays} días).`,
      evidence: comp.slice(-N).map(exposureText),
      missing: [
        `Se necesitan ${N} exposiciones del mismo slot, hechas y con RPE real, dentro de ${p.windowDays} días (hay ${recent.length}). Si este slot se entrena con poca frecuencia, ampliá la ventana.`,
      ],
      support: support(comp.slice(-N)),
    });
  }
  const first = recent[0] as Exposure;
  const prev = comp
    .filter((e) => e.date < first.date && daysBetween(first.date, e.date) <= p.prevDays)
    .slice(-N);
  const devs = recent.map((e) => e.rpeDev);
  const noTarget = devs.some((d) => d === null);
  const devMed = noTarget ? null : median(devs as number[]);
  const complianceOk = recent.every((e) => e.compliance >= p.minCompliance);
  const common = {
    ...base,
    dataUntil: (recent.at(-1) as Exposure).date,
    support: support([...prev, ...recent]),
  };
  const evid = [...prev, ...recent].map(exposureText);
  const notes = [
    `RPE real − objetivo (mediana de las ${N} recientes): ${devMed === null ? 'sin objetivo de RPE cargado' : signed(devMed, 1)}`,
    `Cumplimiento de series: ${recent.map((e) => `${Math.round(e.compliance * 100)}%`).join(' · ')}`,
  ];
  const missedReps = recent.reduce((s, e) => s + Math.max(0, e.repsPlanned - e.repsDone), 0);
  if (missedReps > 0)
    notes.push(`Reps previstas no realizadas (aparte, aunque la serie figure hecha): ${missedReps}`);

  if (prev.length < N) {
    const asc = recent.every(
      (e, i) => i === 0 || (e.e as number) > ((recent[i - 1] as Exposure).e as number),
    );
    const c0 = evaluateChange(
      first.e as number,
      ((recent.at(-1) as Exposure).e as number) - (first.e as number),
      cfg,
    );
    if (asc && c0.defined && c0.exceeds && complianceOk && devMed !== null && devMed <= p.rpeTolerance) {
      return result({
        ...common,
        status: 'tendencia_inicial_favorable',
        trend: 'mejora',
        sufficiency: 'parcial',
        summary: `Tendencia inicial favorable: E sube en ${N} exposiciones seguidas (${changeText(c0)}). Aún sin ${N} previas para confirmarla.`,
        evidence: [...evid, ...notes],
        missing: [`Exposiciones previas comparables: ${prev.length} de ${N}`],
        proposal: 'Mantener la estructura y la progresión ya previstas.',
        reviewWhen: `Al completar ${N} exposiciones previas comparables.`,
      });
    }
    return result({
      ...common,
      status: 'sin_senal',
      summary: `Sin comparación robusta: hay ${prev.length} de ${N} exposiciones previas.`,
      evidence: [...evid, ...notes],
      missing: [
        `Exposiciones previas comparables: ${prev.length} de ${N}`,
        ...(c0.defined ? [] : ['Cambio mínimo relevante no definido para este lift.']),
      ],
    });
  }

  const mPrev = median(prev.map((e) => e.e as number));
  const d = median(recent.map((e) => e.e as number)) - mPrev;
  const c = evaluateChange(mPrev, d, cfg);
  const med = `Mediana E recientes ${f(mPrev + d, 1)} kg vs previas ${f(mPrev, 1)} kg: ${changeText(c)}`;
  if (!c.defined) {
    return result({
      ...common,
      status: 'datos_insuficientes',
      summary: `Δ de E = ${changeText(c)}, pero no hay cambio mínimo relevante definido: no se clasifica.`,
      evidence: [med, ...evid, ...notes],
      missing: ['Cambio mínimo relevante del lift (porcentaje y/o kg).'],
    });
  }
  if (c.exceeds && d > 0) {
    if (devMed === null) {
      return result({
        ...common,
        status: 'datos_insuficientes',
        summary: `E sube (${changeText(c)}) pero falta el RPE objetivo para confirmar el esfuerzo.`,
        evidence: [med, ...evid, ...notes],
        missing: ['RPE objetivo explícito (prescripción por RPE, o nota de RPE si se prescribe en kg).'],
      });
    }
    if (devMed > p.rpeTolerance || !complianceOk) {
      return result({
        ...common,
        status: 'sin_senal',
        sufficiency: 'parcial',
        summary: `E sube (${changeText(c)}) pero ${devMed > p.rpeTolerance ? 'con RPE por encima del objetivo' : 'con cumplimiento bajo'}: no se confirma progreso sostenido.`,
        evidence: [med, ...evid, ...notes],
        alternatives: ['Mejora con esfuerzo mayor al previsto: la comparación no es limpia.'],
      });
    }
    return result({
      ...common,
      status: 'progreso_sostenido',
      trend: 'mejora',
      facts: [
        fact('median_prev', `Mediana de las ${N} previas`, mPrev, 'kg', 'metrica', 'e1rm_table_rpe'),
        fact('median_recent', `Mediana de las ${N} recientes`, mPrev + d, 'kg', 'metrica', 'e1rm_table_rpe'),
        fact('delta_kg', 'Cambio', d, 'kg'),
        fact('delta_pct', 'Cambio relativo', c.pct, '%'),
        fact('rpe_dev', 'RPE real − objetivo (mediana)', devMed, 'RPE', 'metrica', 'rpe_deviation'),
      ],
      sufficiency: 'suficiente',
      summary: `Progreso sostenido: la mediana de E de las ${N} últimas supera a la de las ${N} anteriores (${changeText(c)}) con RPE dentro de lo previsto.`,
      evidence: [med, ...evid, ...notes],
      proposal: 'Mantener la estructura y la progresión ya previstas. No se agrega volumen por defecto.',
      reviewWhen: 'Con la próxima exposición comparable.',
    });
  }
  return result({
    ...common,
    status: 'sin_senal',
    trend: d < 0 && c.exceeds ? 'baja' : 'estable',
    facts: [
      fact('median_prev', `Mediana de las ${N} previas`, mPrev, 'kg', 'metrica', 'e1rm_table_rpe'),
      fact('median_recent', `Mediana de las ${N} recientes`, mPrev + d, 'kg', 'metrica', 'e1rm_table_rpe'),
      fact('delta_kg', 'Cambio', d, 'kg'),
      fact('delta_pct', 'Cambio relativo', c.pct, '%'),
    ],
    sufficiency: 'suficiente',
    summary:
      d < 0 && c.exceeds
        ? `E baja (${changeText(c)}); ver R-END.`
        : `Sin cambio relevante en E (${changeText(c)}).`,
    evidence: [med, ...evid, ...notes],
  });
}
