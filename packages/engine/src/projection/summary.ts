export interface ProjectionSummary {
  trend: {
    label: 'ascendente' | 'estable' | 'descendente' | 'indeterminada';
    basis: string;
    slopeKgPerWeek: number | null;
    changeKgOverSpan: number | null;
    spanDays: number | null;
  };
  projection: {
    valueKg: number;
    horizonDays: number;
    date: string;
    modelId: string;
    versusBaseline: 'mejora' | 'sin_mejora' | 'no_concluyente';
    baselineKg: number;
    range: { lower: number; upper: number } | null;
  } | null;
  limitation: string;
  text: string;
  lines: string[];
}

interface TrendIn {
  slopeKgPerWeek: number;
  changeKg: number;
  spanDays: number;
  exposures: number;
  classified: 'ascendente' | 'estable' | 'descendente' | null;
}
interface ProjIn {
  modelId: string;
  label: string;
  valueKg: number;
  baselineKg: number;
  horizonDays: number;
  date: string;
  verdict: string;
  evaluations: number;
  range: { lower: number; upper: number } | null;
  calibration?: { status: string; observed: number | null; sample: number; nominal: number } | null;
}
const n1 = (x: number): string => x.toFixed(1).replace('.', ',');
const sgn = (x: number): string => `${x >= 0 ? '+' : '−'}${n1(Math.abs(x))}`;

/** Resumen determinista (sin LLM). Nunca promete resultados: describe, condiciona y declara el límite principal. */
export function buildSummary(i: {
  status: string;
  reasons: { code: string; message: string }[];
  trend: TrendIn | null;
  projection: ProjIn | null;
  target: { exercise: string; variantKey: string; indicator: string } | null;
  cfgMin: number;
}): ProjectionSummary {
  const lines: string[] = [];
  let trend: ProjectionSummary['trend'];
  const short = i.target ? i.target.indicator.replace(/\s*\(.*\)\s*$/, '') : '';
  const ctx = i.target ? ` (${short}${i.target.exercise ? `, ${i.target.exercise}` : ''})` : '';
  if (!i.trend) {
    trend = {
      label: 'indeterminada',
      basis: 'Menos de 3 exposiciones con fecha distinta.',
      slopeKgPerWeek: null,
      changeKgOverSpan: null,
      spanDays: null,
    };
    lines.push(
      i.status === 'unavailable'
        ? 'No hay una serie utilizable para describir una tendencia.'
        : 'Hay muy pocas exposiciones para describir una tendencia.',
    );
  } else {
    const w = Math.max(1, Math.round(i.trend.spanDays / 7));
    if (i.trend.classified) {
      trend = {
        label: i.trend.classified,
        basis:
          'Cambio de la tendencia lineal comparado con el cambio mínimo relevante configurado del movimiento.',
        slopeKgPerWeek: i.trend.slopeKgPerWeek,
        changeKgOverSpan: i.trend.changeKg,
        spanDays: i.trend.spanDays,
      };
      const name =
        i.trend.classified === 'estable'
          ? 'Tendencia estable (cambio por debajo del mínimo relevante configurado)'
          : `Tendencia ${i.trend.classified}`;
      lines.push(
        `${name}: ${sgn(i.trend.changeKg)} kg en ${w} semanas${ctx}, ${i.trend.exposures} exposiciones.`,
      );
    } else {
      trend = {
        label: 'indeterminada',
        basis:
          'No hay cambio mínimo relevante configurado para este movimiento: se describe el cambio sin clasificarlo.',
        slopeKgPerWeek: i.trend.slopeKgPerWeek,
        changeKgOverSpan: i.trend.changeKg,
        spanDays: i.trend.spanDays,
      };
      lines.push(
        `Cambio de ${sgn(i.trend.changeKg)} kg en ${w} semanas${ctx}, ${i.trend.exposures} exposiciones; sin cambio mínimo relevante configurado, no se clasifica.`,
      );
    }
  }
  let projection: ProjectionSummary['projection'] = null;
  if (i.projection) {
    const p = i.projection;
    const vs =
      p.verdict === 'mejora_sobre_baseline'
        ? 'mejora'
        : p.verdict === 'sin_mejora'
          ? 'sin_mejora'
          : 'no_concluyente';
    projection = {
      valueKg: p.valueKg,
      horizonDays: p.horizonDays,
      date: p.date,
      modelId: p.modelId,
      versusBaseline: vs,
      baselineKg: p.baselineKg,
      range: p.range,
    };
    const cal = p.calibration;
    const calText = !cal
      ? ''
      : cal.observed !== null && cal.status !== 'not_evaluable'
        ? ` (no calibrado: cobertura observada ${Math.round(cal.observed * 100)} % en ${cal.sample} casos frente a ${Math.round(cal.nominal * 100)} % nominal)`
        : ' (no calibrado: cobertura no evaluable con la muestra disponible)';
    const rg = p.range
      ? `, rango empírico de errores históricos ${n1(p.range.lower)}–${n1(p.range.upper)} kg${calText}`
      : ', sin rango disponible';
    if (p.modelId === 'baseline') {
      const cmp =
        vs === 'sin_mejora'
          ? 'En la validación temporal ninguna tendencia mejoró a este baseline.'
          : vs === 'mejora'
            ? 'En la validación temporal una tendencia lo mejoró.'
            : `Validación no concluyente (${p.evaluations} evaluaciones): se mantiene este baseline como referencia.`;
      lines.push(
        `Si se mantiene el nivel reciente, el indicador se ubicaría en ${n1(p.valueKg)} kg a ${p.horizonDays} días${rg}. ${cmp}`,
      );
    } else {
      lines.push(
        `Si continúa el patrón, el modelo “${p.label}” ubica el indicador en ${n1(p.valueKg)} kg a ${p.horizonDays} días${rg}. En la validación temporal mejoró a mantener el nivel (${n1(p.baselineKg)} kg) con ${p.evaluations} evaluaciones.`,
      );
    }
  } else if (i.status !== 'unavailable') {
    const why = i.reasons.find((r) =>
      ['insufficient_exposures', 'insufficient_span', 'stale_data', 'horizon_exceeds_history'].includes(
        r.code,
      ),
    );
    lines.push(`No se proyecta: ${why ? why.message : 'datos insuficientes.'}`);
  } else {
    lines.push(`No disponible: ${i.reasons[0]?.message ?? 'sin datos.'}`);
  }
  const limitation =
    i.reasons.find((r) =>
      [
        'variant_required',
        'no_rpe',
        'stale_data',
        'horizon_exceeds_history',
        'insufficient_exposures',
        'insufficient_span',
      ].includes(r.code),
    )?.message ??
    i.reasons.find((r) => r.code === 'outliers_flagged')?.message ??
    'Indicador experimental (e1RM estimado): no es un 1RM real ni una predicción de resultado.';
  lines.push(limitation);
  return { trend, projection, limitation, text: lines.join(' '), lines };
}
