import { daysBetween } from '../dates.js';
import { changeText, evaluateChange } from '../change.js';
import { f, median, signed } from '../format.js';
import type { EngineParams, LiftConfig } from '../params.js';
import type { Exposure, RuleResult } from '../types.js';
import type { RuleCtx } from './ctx.js';
import { exposureText, support } from './progress.js';
import { fact, result } from './result.js';

const PROGRESS_OBJ = /fuerza|rendimiento|progres|pico|peak|acumul/i;
const NON_PROGRESS_OBJ = /manten|descarga|deload|t[eé]cnic|hipertrof|volumen|reduc|rehab|retorno/i;

/** Qué se espera del e1RM según el objetivo declarado. Si no hay objetivo, no se interpreta una estabilidad. */
export function objectiveKind(objective: string | null): 'progreso' | 'no_progreso' | 'desconocido' {
  if (!objective) return 'desconocido';
  if (NON_PROGRESS_OBJ.test(objective)) return 'no_progreso';
  if (PROGRESS_OBJ.test(objective)) return 'progreso';
  return 'desconocido';
}

/**
 * R-END [propuesta]. Dos lecturas distintas:
 *  (A) CAÍDA: `endN` exposiciones consecutivas por debajo de la mediana de las N previas más allá del cambio mínimo
 *      → "posible fin de respuesta / revisión del bloque". Si cambió el estímulo en la ventana, la comparación queda parcial.
 *  (B) ESTABILIDAD: `endStableN` exposiciones sin cambio relevante → "estabilidad observada". NO se clasifica como fin de respuesta
 *      por el solo hecho de ser estable: depende del objetivo, la duración, la comparabilidad y los cambios del estímulo.
 *      Solo con objetivo de PROGRESO declarado, duración ≥ `stabilityMinWeeks` y sin cambio de estímulo se informa una "posible meseta".
 * No usa TTP histórico ni recomienda "más estrés".
 */
export function ruleEnd(
  comp: Exposure[],
  cfg: LiftConfig,
  p: EngineParams,
  cutoff: string,
  exposureId: string,
  c: RuleCtx,
): RuleResult | null {
  const n = p.endN;
  const N = p.nExposures;
  const lastExp = comp.at(-1);
  if (comp.length < n + N || !lastExp || daysBetween(cutoff, lastExp.date) >= p.prevDays) return null;
  const last = comp.slice(-n);
  const ref = comp.slice(-(n + N), -n);
  const m = median(ref.map((e) => e.e as number));
  const cs = last.map((e) => evaluateChange(m, (e.e as number) - m, cfg));
  if (!(cs[0] as ReturnType<typeof evaluateChange>).defined) return null; // sin cambio mínimo lo informa R-PROGRESS
  const devs = last.map((e) => e.rpeDev).filter((d): d is number => d !== null);
  const devMed = devs.length ? median(devs) : null;
  const complianceOk = [...last, ...ref].every((e) => e.compliance >= p.minCompliance);
  const winFrom = (ref[0] as Exposure).date;
  const changed = c.stimulusChanges.filter((x) => x.effectiveOn >= winFrom && x.effectiveOn <= lastExp.date);
  const changeNote = changed.length
    ? [
        `Cambió el estímulo dentro de la ventana (${changed.map((x) => `${x.classification.replace(/_/g, ' ')} el ${x.effectiveOn}`).join('; ')}): la comparación es parcial y no se atribuye a una sola causa.`,
      ]
    : [];
  const effort = [
    `RPE real − objetivo (últimas ${n}): ${devMed === null ? 'sin objetivo cargado' : signed(devMed, 1)}`,
    `Cumplimiento de series: ${[...ref, ...last].map((e) => `${Math.round(e.compliance * 100)}%`).join(' · ')}`,
  ];
  const alt = [
    'Si el bloque tiene un objetivo técnico o de volumen, o hubo enfermedad/viaje/cambio de variante, esto no indica fin de respuesta.',
    'No se recomienda agregar estrés automáticamente frente a una caída.',
    'Historia de TTP/familias de microciclo: no se compara con ventanas históricas en esta regla.',
    ...changeNote,
  ];
  const dataUntil = (last.at(-1) as Exposure).date;
  if (cs.every((x) => x.exceeds && x.kg < 0)) {
    const excess = devMed !== null && devMed > p.rpeTolerance;
    return result({
      ruleId: 'R-END',
      exposureId,
      status: 'posible_fin_respuesta',
      tag: 'caida',
      rankKey: excess ? 'posible_fin_respuesta_esfuerzo' : 'posible_fin_respuesta',
      sufficiency: complianceOk && devMed !== null && !changed.length ? 'suficiente' : 'parcial',
      dataUntil,
      support: support([...ref, ...last]),
      summary: `Posible fin de respuesta / revisión del bloque: las últimas ${n} exposiciones quedaron por debajo de la mediana de las ${N} previas (${cs.map(changeText).join(' · ')})${excess ? ', con esfuerzo por encima del objetivo.' : '.'}`,
      evidence: [
        `Mediana de las ${N} previas: ${f(m, 1)} kg`,
        ...[...ref, ...last].map(exposureText),
        ...effort,
      ],
      alternatives: alt,
      proposal:
        'Revisar el bloque y el contexto con el atleta antes de decidir cambios. No es un diagnóstico.',
      reviewWhen: 'En la próxima exposición comparable.',
      missing: complianceOk
        ? []
        : [
            `Cumplimiento < ${Math.round(p.minCompliance * 100)} % en alguna exposición: la comparación puede estar afectada.`,
          ],
      facts: [
        fact('median_prev', `Mediana de las ${N} previas`, m, 'kg', 'metrica', 'e1rm_table_rpe'),
        ...cs.map((x, i) =>
          fact(`delta_${i + 1}`, `Δ de la exposición ${i + 1} vs la mediana previa`, x.kg, 'kg'),
        ),
        fact('rpe_dev', 'RPE real − objetivo', devMed, 'RPE', 'metrica', 'rpe_deviation'),
      ],
    });
  }
  const B = p.endStableN;
  const six = comp.slice(-B);
  if (six.length === B && daysBetween(cutoff, (six[0] as Exposure).date) <= 2 * p.prevDays) {
    const es = six.map((e) => e.e as number);
    const range = Math.max(...es) - Math.min(...es);
    const c6 = evaluateChange(median(es), range, cfg);
    if (c6.defined && !c6.exceeds) {
      const kind = objectiveKind(c.objective);
      const weeks = daysBetween((six[B - 1] as Exposure).date, (six[0] as Exposure).date) / 7;
      const sixChanged = c.stimulusChanges.filter(
        (x) => x.effectiveOn >= (six[0] as Exposure).date && x.effectiveOn <= (six[B - 1] as Exposure).date,
      );
      const meseta =
        kind === 'progreso' && weeks >= p.stabilityMinWeeks && !sixChanged.length && complianceOk;
      const base = {
        ruleId: 'R-END' as const,
        exposureId,
        tag: 'estabilidad',
        dataUntil: (six[B - 1] as Exposure).date,
        support: support(six),
        evidence: [
          ...six.map(exposureText),
          ...effort,
          `Duración observada: ${f(weeks, 1)} semanas`,
          `Objetivo declarado: ${c.objective ?? 'no disponible'}`,
        ],
        facts: [
          fact('range', `Rango de E en ${B} exposiciones`, range, 'kg', 'metrica', 'e1rm_table_rpe'),
          fact('weeks', 'Duración observada', weeks, 'semanas'),
          fact('objective', 'Objetivo declarado', c.objective),
          fact('stable_n', 'Exposiciones estables', B),
        ],
      };
      if (meseta) {
        return result({
          ...base,
          status: 'posible_fin_respuesta',
          sufficiency: 'parcial',
          summary: `Posible meseta: ${B} exposiciones durante ${f(weeks, 1)} semanas con rango de E ${f(range, 1)} kg (${f(c6.pct as number, 1)} %), por debajo del cambio mínimo, con un objetivo de progreso y sin cambios de estímulo.`,
          alternatives: [
            ...alt,
            'Una meseta no es un fin de respuesta confirmado: puede deberse a variables no registradas.',
          ],
          proposal: 'Revisar si el estímulo sigue produciendo respuesta; decisión del coach.',
          reviewWhen: `Después de ${n} exposiciones más.`,
        });
      }
      const why =
        kind === 'desconocido'
          ? 'El objetivo del bloque no está disponible: la estabilidad no se interpreta (ni como mantenimiento buscado ni como falta de respuesta).'
          : kind === 'no_progreso'
            ? `Compatible con el objetivo declarado (${c.objective}): no se espera una suba de e1RM.`
            : sixChanged.length
              ? 'Cambió el estímulo durante la observación: no hay una base estable para hablar de meseta.'
              : !complianceOk
                ? 'El cumplimiento fue bajo: la comparación puede estar afectada.'
                : `Con objetivo de progreso, la duración (${f(weeks, 1)} semanas) es menor que la mínima para informar una meseta (${p.stabilityMinWeeks}).`;
      return result({
        ...base,
        status: 'estabilidad_observada',
        sufficiency: kind === 'desconocido' ? 'parcial' : 'suficiente',
        summary: `Estabilidad observada: ${B} exposiciones con rango de E ${f(range, 1)} kg (${f(c6.pct as number, 1)} %), por debajo del cambio mínimo. ${why}`,
        alternatives: [...alt, ...changeNote],
        proposal:
          kind === 'desconocido'
            ? 'Declarar el objetivo del bloque para poder interpretar la estabilidad.'
            : 'Sin acción propuesta por esta lectura.',
        reviewWhen: `Después de ${n} exposiciones más.`,
        missing: kind === 'desconocido' ? ['Objetivo declarado del bloque o familia.'] : [],
      });
    }
  }
  return null;
}
