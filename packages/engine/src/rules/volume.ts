import { daysBetween } from '../dates.js';
import { evaluateChange } from '../change.js';
import { f, median } from '../format.js';
import type { Exposure, RuleResult } from '../types.js';
import type { RuleCtx } from './ctx.js';
import { exposureText, support } from './progress.js';
import { result } from './result.js';

/**
 * R-VOLUME [propuesta] (rules.md §7): candidato a ENSAYO de más volumen. Nunca una instrucción automática.
 * No basta con "tolera": exige respuesta estable sin cambio relevante (si ya progresa NO se agrega trabajo), adherencia, recuperación estable
 * y ausencia de deterioro; y además una dosis histórica productiva mayor documentada O la confirmación del coach de un ensayo exploratorio.
 */
export function ruleVolume(
  comp: Exposure[],
  endFired: boolean,
  freqPattern: boolean,
  exposureId: string,
  c: RuleCtx,
): RuleResult | null {
  const B = c.p.volumeStableN;
  const N = c.p.nExposures;
  if (comp.length < B || daysBetween(c.cutoff, (comp.at(-1) as Exposure).date) >= 2 * c.p.prevDays)
    return null;
  const six = comp.slice(-B);
  const base = {
    ruleId: 'R-VOLUME' as const,
    exposureId,
    dataUntil: (six.at(-1) as Exposure).date,
    support: support(six),
  };
  const prev = six.slice(0, N);
  const rec = six.slice(-N);
  const ch = evaluateChange(
    median(prev.map((e) => e.e as number)),
    median(rec.map((e) => e.e as number)) - median(prev.map((e) => e.e as number)),
    c.cfg,
  );
  if (!ch.defined)
    return result({
      ...base,
      status: 'datos_insuficientes',
      summary: 'No se puede juzgar si la respuesta es estable: falta el cambio mínimo relevante.',
      missing: ['Cambio mínimo relevante del lift.'],
    });
  const stable = !ch.exceeds;
  const adherence = six.every((e) => e.compliance >= c.p.minCompliance);
  const since = c.readinessHistory
    .filter((r) => r.date <= c.cutoff && daysBetween(c.cutoff, r.date) < 35)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const last3 = since.slice(0, c.p.volumeRecoveryN).map((r) => r.value);
  const recStable =
    last3.length < c.p.volumeRecoveryN
      ? null
      : Math.max(...last3) - Math.min(...last3) <= 2 &&
        Math.min(...last3) >= since.reduce((a, r) => a + r.value, 0) / since.length - 1;
  const noDeterioration = !endFired && !freqPattern;
  // dosis actual (NL/semana realizado, últimas 3 semanas con datos) vs dosis histórica productiva (bloques con respuesta favorable)
  const cur = c.blocks.filter((b) => b.actual).sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0];
  const curNl = cur?.actual?.perWeek.nl ?? null;
  const productive =
    curNl === null
      ? []
      : c.blocks.filter(
          (b) =>
            b.favorable === true &&
            b.actual &&
            b.blockKey !== cur?.blockKey &&
            b.actual.perWeek.nl > curNl * 1.05,
        );
  const conds = [
    `Respuesta estable en ${B} benchmarks (sin cambio relevante ${ch.kg >= 0 ? '+' : ''}${f(ch.kg, 1)} kg): ${stable ? '✓' : '✗ (ya hay cambio relevante: no se agrega trabajo por defecto)'}`,
    `Adherencia ≥ ${Math.round(c.p.minCompliance * 100)} %: ${adherence ? '✓' : '✗'}`,
    `Recuperación estable en ≥ ${c.p.volumeRecoveryN} respuestas: ${recStable === null ? '? hay ' + since.length + ' check-ins en 35 días' : recStable ? '✓' : '✗'}`,
    `Sin patrón de deterioro (R-END / R-FREQUENCY): ${noDeterioration ? '✓' : '✗'}`,
  ];
  const evid = [...conds, ...six.map(exposureText)];
  if (!stable || !adherence || !noDeterioration || recStable === false)
    return result({
      ...base,
      status: 'sin_senal',
      summary: 'No es candidato a un ensayo de volumen.',
      evidence: evid,
    });
  if (recStable === null)
    return result({
      ...base,
      status: 'datos_insuficientes',
      summary: 'Respuesta estable, pero faltan check-ins para confirmar la recuperación.',
      evidence: evid,
      missing: [`≥ ${c.p.volumeRecoveryN} respuestas semanales de recuperación (hay ${since.length}).`],
    });
  if (!productive.length && !c.cfg.explorationApproved) {
    return result({
      ...base,
      status: 'sin_senal',
      sufficiency: 'suficiente',
      summary:
        'Respuesta estable; dosis óptima desconocida. No se afirma subentrenamiento: no hay una dosis histórica mayor y productiva documentada ni un ensayo exploratorio confirmado por el coach.',
      evidence: [...evid, `Dosis actual: ${curNl === null ? 'sin datos' : f(curNl, 1) + ' NL/semana'}`],
      missing: ['Dosis histórica productiva documentada o confirmación del coach (ensayo exploratorio).'],
    });
  }
  return result({
    ...base,
    status: 'candidato_volumen',
    sufficiency: productive.length ? 'suficiente' : 'parcial',
    summary: `Candidato a ensayo de volumen: respuesta estable y ${productive.length ? `una dosis histórica mayor fue productiva (${productive.map((b) => `${b.blockKey}: ${f(b.actual?.perWeek.nl as number, 1)} NL/sem`).join(', ')}; hoy ${f(curNl as number, 1)})` : 'el coach confirmó un ensayo exploratorio'}.`,
    evidence: [...evid, `Dosis actual: ${curNl === null ? 'sin datos' : f(curNl, 1) + ' NL/semana'}`],
    proposal: `Experimento propuesto (no una instrucción): añadir 1 serie semanal a UN slot que elija el coach, manteniendo frecuencia y esfuerzo objetivo, durante ${c.p.trialWeeks} semanas. Definí antes la salida: por ejemplo, volver a la dosis previa si el RPE real supera el objetivo en 2 exposiciones o si E baja más que el cambio mínimo. Vigilar mejora, esfuerzo, ejecución y recuperación, no solo la subida de E. Registrar el cambio y el resultado posterior.`,
    reviewWhen: `Al completar ${c.p.trialWeeks} semanas del ensayo.`,
    alternatives: [],
  });
}
