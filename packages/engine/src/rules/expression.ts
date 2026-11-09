import { daysBetween } from '../dates.js';
import { f, median } from '../format.js';
import { acwrPrg, dailyInol, frPrg, peakIndexPrg, trend2128 } from '../prg.js';
import type { Exposure, RuleResult } from '../types.js';
import { evaluateChange } from '../change.js';
import type { RuleCtx } from './ctx.js';
import { exposureText, support } from './progress.js';
import { fact, result } from './result.js';

const NOT_PEAK =
  'Es una ventana favorable observada: no es un pico fisiológico confirmado ni una predicción.';
const mark = (ok: boolean | null) => (ok === null ? '? sin dato' : ok ? '✓' : '✗');

/**
 * R-EXPRESSION modo A — PRG_RECONSTRUIDO [recuperado del TEXTO de ayuda de PRG, no del motor completo]:
 * FR ≥ 1, tendencia estable/ascendente, ACWR entre 0,8 y 1,3 y PeakIndex ≥ umbral. e1RM = tabla del proyecto (sustitución declarada).
 * Devuelve siempre un resultado: "ventana_expresion" si se cumplen todas, o "sin_senal" explicando qué falta.
 */
export function ruleExpressionA(compAll: Exposure[], c: RuleCtx): RuleResult {
  const base = { ruleId: 'R-EXPRESSION-A' as const, exposureId: '' };
  const days = dailyInol(c.allPlanned, c.allActual, c.lift, c.cutoff, 28);
  const acwr = acwrPrg(days);
  const peak = peakIndexPrg(days);
  const byDay = new Map<string, number>();
  for (const e of compAll) byDay.set(e.date, Math.max(byDay.get(e.date) ?? 0, e.e as number));
  const obs = [...byDay.entries()].map(([date, value]) => ({ date, value }));
  const win = obs
    .filter((o) => daysBetween(c.cutoff, o.date) >= 0 && daysBetween(c.cutoff, o.date) < 21)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const fr = win.length >= 2 ? frPrg(win.map((o) => o.value)) : null;
  const tr = trend2128(obs, c.cutoff);
  const okFr = fr === null ? null : fr >= 1;
  const okTr = tr === null ? null : tr !== 'Descendente';
  const okAc = acwr.value === null ? null : acwr.value >= 0.8 && acwr.value <= 1.3;
  const okPk = peak === null ? null : peak >= c.p.peakIndexMin;
  const conds = [
    `FR ≥ 1: ${mark(okFr)}${fr !== null ? ` (${f(fr, 3)})` : ''}`,
    `Tendencia estable/ascendente: ${mark(okTr)}${tr ? ` (${tr})` : ''}`,
    `ACWR 0,8–1,3: ${mark(okAc)}${acwr.value !== null ? ` (${f(acwr.value, 2)})` : ` — ${acwr.reason}`}`,
    `PeakIndex ≥ ${c.p.peakIndexMin} %: ${mark(okPk)}${peak !== null ? ` (${f(peak, 0)} %)` : ' (cobertura de 7 días incompleta o sin series válidas)'}`,
  ];
  const checks = [okFr, okTr, okAc, okPk];
  const dataUntil = compAll.at(-1)?.date ?? '';
  const factsA = [
    fact('fr', 'Fatigue Ratio (modelo PRG)', fr, 'ratio', 'metrica', 'fatigue_ratio_prg'),
    fact('trend', 'Tendencia 21–28 (e1RM)', tr, undefined, 'metrica', 'e1rm_table_rpe'),
    fact('acwr', 'ACWR (modelo PRG)', acwr.value, 'ratio', 'metrica', 'acwr_prg'),
    fact('peak_index', 'Peak Index (modelo PRG)', peak, '%', 'metrica', 'peak_index_prg'),
  ];
  const common = {
    ...base,
    facts: factsA,
    dataUntil,
    evidence: [
      'Modo A (reglas del Glosario de PRG, reconstruidas desde texto; no es el motor completo verificado)',
      ...conds,
    ],
    support: support(compAll.slice(-3)),
  };
  if (checks.every((x) => x === true)) {
    return result({
      ...common,
      status: 'ventana_expresion',
      sufficiency: 'parcial',
      summary: `Señal de expresión según la regla de PRG (modo A): se cumplen FR, tendencia, ACWR y PeakIndex. ${NOT_PEAK}`,
      proposal:
        'Considerar la ventana en la planificación del coach. No se intenta ningún máximo automáticamente.',
      reviewWhen: 'Con la próxima sesión del lift.',
    });
  }
  const missing = checks.map((x, i) => (x === null ? conds[i] : null)).filter((x): x is string => x !== null);
  return result({
    ...common,
    status: 'sin_senal',
    sufficiency: 'insuficiente',
    summary: `Modo A (PRG reconstruido): no se cumplen o faltan condiciones (${checks.filter((x) => x === true).length} de 4 cumplidas).`,
    missing,
  });
}

/**
 * R-EXPRESSION modo B — MOTOR_PROPIO [propuesta]: progreso o estabilidad favorable en los 3 benchmarks recientes, sin deterioro relevante,
 * esfuerzo dentro del objetivo, recuperación vigente no empeorada y ejecución comparable. No depende de CTL/ATL ni de una cuota del 85 %.
 */
export function ruleExpressionB(
  comp: Exposure[],
  deteriorated: boolean,
  exposureId: string,
  c: RuleCtx,
): RuleResult {
  const N = c.p.nExposures;
  const base = { ruleId: 'R-EXPRESSION-B' as const, exposureId };
  const rec = comp.filter((e) => daysBetween(c.cutoff, e.date) < c.p.windowDays).slice(-N);
  if (rec.length < N)
    return result({
      ...base,
      status: 'datos_insuficientes',
      summary: `Modo B: faltan benchmarks recientes (${rec.length} de ${N}).`,
      missing: [`${N} exposiciones comparables en ${c.p.windowDays} días`],
    });
  const prev = comp.filter((e) => e.date < (rec[0] as Exposure).date).slice(-N);
  const first = (rec[0] as Exposure).e as number;
  const last = (rec.at(-1) as Exposure).e as number;
  let favorable: boolean | null;
  let favTxt: string;
  if (prev.length === N) {
    const ch = evaluateChange(
      median(prev.map((e) => e.e as number)),
      median(rec.map((e) => e.e as number)) - median(prev.map((e) => e.e as number)),
      c.cfg,
    );
    favorable = !ch.defined ? null : !(ch.exceeds && ch.kg < 0);
    favTxt = ch.defined
      ? `Mediana de E vs ${N} previas: ${f(ch.kg, 1)} kg (sin caída relevante)`
      : 'Cambio mínimo no definido: no se puede juzgar la estabilidad';
  } else {
    favorable = last >= first;
    favTxt = `Sin ${N} previas: se compara último vs primero (${f(last, 1)} vs ${f(first, 1)} kg)`;
  }
  const effort = rec.every((e) => e.rpeDev !== null)
    ? rec.every((e) => (e.rpeDev as number) <= c.p.rpeTolerance)
    : null;
  const exec = rec.every((e) => e.compliance >= c.p.minCompliance);
  const rd = c.readinessHistory.filter((r) => r.date <= c.cutoff).sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = rd[0];
  const current = latest ? daysBetween(c.cutoff, latest.date) <= c.p.readinessValidityDays : false;
  const prior = rd.slice(1, 5).map((r) => r.value);
  const notWorse =
    latest && prior.length
      ? latest.value >= prior.reduce((a, b) => a + b, 0) / prior.length - 1
      : latest
        ? true
        : null;
  const recOk = !latest ? null : !current ? null : notWorse;
  const conds = [
    `Progreso/estabilidad favorable: ${mark(favorable)} — ${favTxt}`,
    `Sin deterioro relevante (caída de E o patrón de fatiga dentro de la sesión): ${mark(!deteriorated)}`,
    `Esfuerzo dentro del objetivo (RPE real − objetivo ≤ ${c.p.rpeTolerance}): ${mark(effort)}`,
    `Recuperación vigente y no empeorada: ${mark(recOk)}${latest ? ` (${latest.date}, ${f(latest.value, 1)}/10${current ? '' : ', vencido'})` : ' (sin check-in)'}`,
    `Ejecución comparable (cumplimiento ≥ ${Math.round(c.p.minCompliance * 100)} %): ${mark(exec)}`,
  ];
  const checks = [favorable, !deteriorated, effort, recOk, exec];
  const common = {
    ...base,
    dataUntil: (rec.at(-1) as Exposure).date,
    evidence: ['Modo B (motor propio, propuesta V0.1)', ...conds, ...rec.map(exposureText)],
    support: support(rec),
  };
  if (checks.every((x) => x === true)) {
    return result({
      ...common,
      status: 'ventana_expresion',
      sufficiency: 'parcial',
      summary: `Ventana favorable según el motor propio (modo B): se cumplen las 5 condiciones. ${NOT_PEAK}`,
      proposal:
        'Considerar la ventana en la planificación del coach. No se intenta ningún máximo automáticamente.',
      reviewWhen: 'Con la próxima exposición comparable.',
    });
  }
  return result({
    ...common,
    status: 'sin_senal',
    summary: `Modo B: ${checks.filter((x) => x === true).length} de 5 condiciones cumplidas.`,
    missing: checks.map((x, i) => (x === null ? conds[i] : null)).filter((x): x is string => x !== null),
  });
}
