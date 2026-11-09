import { inolPrg } from './prg.js';
import type { CurveDomain } from './e1rm.js';
import { estimateCurve, estimatePrg, METHOD_CURVE, METHOD_PRG } from './e1rm-methods.js';
import {
  metricResult,
  periodOf,
  type MetricResult,
  type MetricScope,
  type RecordRef,
} from './metric-result.js';
import { isWorkSet, type ObservedSet } from './observed.js';
import { referenceAt, toInfo, type ReferenceInfo, type StrengthReference } from './references.js';
import {
  SI_MODEL,
  SI_MODEL_EFORT,
  SI_MODEL_PRG,
  exertionLoadEfort,
  stressIndexPrg,
  stressOfSet,
} from './si.js';

export interface ObservedMetricsInput {
  obs: ObservedSet[];
  cutoff: string;
  from: string;
  to: string;
  scope: MetricScope;
  /** Referencias de fuerza fechadas (fuente aparte de las estimaciones). */
  references?: StrengthReference[];
  /** 'original': referencia vigente A LA FECHA de cada serie. 'retrospective': la vigente al corte para todas (recálculo; se rotula). */
  referenceMode?: 'original' | 'retrospective';
  /** Período de comparación; si se da, cada métrica incluye el valor del baseline en el mismo método. */
  baseline?: { from: string; to: string };
  /** Dominio de la curva RPE para el e1RM por curva: 'recomendado' (default) o 'amplio' (reps 1–50, RPE 1–10). */
  domain?: CurveDomain;
}

const CAP = 200;
const refOf = (s: ObservedSet): RecordRef => ({ kind: 'set', id: s.id, date: s.date });

/** Agrupa exclusiones por motivo (con cantidad y algunos ejemplos) para no devolver una lista por serie. */
function exclusions(items: { s: ObservedSet; reason: string }[]): MetricResult['excluded'] {
  const by = new Map<string, ObservedSet[]>();
  for (const i of items) by.set(i.reason, [...(by.get(i.reason) ?? []), i.s]);
  return [...by.entries()].map(([reason, sets]) => ({
    reason: `${reason} (${sets.length} serie${sets.length === 1 ? '' : 's'})`,
    ref: refOf(sets[0] as ObservedSet),
  }));
}
const used = (sets: ObservedSet[]): { refs: RecordRef[]; warn: string[] } => ({
  refs: sets.slice(0, CAP).map(refOf),
  warn: sets.length > CAP ? [`Lista de registros truncada a ${CAP} de ${sets.length}.`] : [],
});

/** ¿La serie tiene una carga total interpretable para tonelaje/e1RM? Mancuernas por lado y peso corporal NO se duplican ni se asumen. */
function loadProblem(s: ObservedSet): string | null {
  if (s.kg === null || !(s.kg > 0))
    return s.loadKind === 'bodyweight' ? 'peso corporal sin carga añadida' : 'sin carga';
  if (s.loadKind === 'per_side') return 'carga por lado (no se asume carga total)';
  if (s.loadKind === 'assisted') return 'ejercicio asistido (la carga resta ayuda)';
  if (s.loadKind === 'unknown') return 'tipo de carga desconocido';
  return null;
}

export function computeObservedMetrics(inp: ObservedMetricsInput): Record<string, MetricResult> {
  const { cutoff } = inp;
  const to = inp.to > cutoff ? cutoff : inp.to;
  const period = periodOf(inp.from, inp.to, cutoff);
  const inScope = (o: ObservedSet) =>
    o.date >= inp.from &&
    o.date <= to &&
    (!inp.scope.lift || inp.scope.lift === 'ALL' || o.lift === inp.scope.lift) &&
    (!inp.scope.exercise || o.exerciseName === inp.scope.exercise);
  const all = inp.obs.filter(inScope);
  const work = all.filter(isWorkSet);
  const warmups = all.filter((o) => !isWorkSet(o));
  const base = { cutoff, period, scope: inp.scope } as const;
  const out: Record<string, MetricResult> = {};
  const warmupExcl = warmups.length
    ? [{ reason: `calentamientos (${warmups.length} serie${warmups.length === 1 ? '' : 's'})` }]
    : [];

  // --- NL, series, frecuencia (no requieren RPE)
  {
    const ok = work.filter((s) => s.reps !== null && s.reps > 0);
    const bad = work
      .filter((s) => !(s.reps !== null && s.reps > 0))
      .map((s) => ({ s, reason: 'sin repeticiones' }));
    const u = used(ok);
    out.nl = metricResult({
      metricId: 'nl',
      unit: 'repeticiones',
      method: { id: 'sum-reps', version: 'v1' },
      ...base,
      value: ok.length ? ok.reduce((a, s) => a + (s.reps as number), 0) : null,
      status: !ok.length ? 'unavailable' : bad.length ? 'partial' : 'available',
      usedRecords: u.refs,
      excluded: [...warmupExcl, ...exclusions(bad)],
      missing: ok.length ? [] : ['series de trabajo con repeticiones'],
      warnings: [...u.warn, 'NL es la suma de repeticiones, no la cantidad de series.'],
    });
    out.sets = metricResult({
      metricId: 'sets',
      unit: 'series',
      method: { id: 'count-sets', version: 'v1' },
      ...base,
      value: ok.length || null,
      status: ok.length ? (bad.length ? 'partial' : 'available') : 'unavailable',
      usedRecords: u.refs,
      excluded: [...warmupExcl, ...exclusions(bad)],
      missing: ok.length ? [] : ['series de trabajo'],
      warnings: u.warn,
    });
    const days = new Set(work.map((s) => s.date));
    out.frequency = metricResult({
      metricId: 'frequency',
      unit: 'días/semana',
      method: { id: 'distinct-days', version: 'v1' },
      ...base,
      value: days.size && period.weeks > 0 ? days.size / period.weeks : null,
      status: days.size ? (period.partial ? 'partial' : 'available') : 'unavailable',
      usedRecords: [...days].sort().map((d) => ({ kind: 'session' as const, id: d, date: d })),
      warnings: [
        'Cuenta días con exposición; un día sin registro no es un descanso confirmado.',
        ...(period.partial
          ? ['Período parcial: la frecuencia semanal se normaliza por los días considerados.']
          : []),
      ],
      missing: days.size ? [] : ['series con fecha'],
    });
  }
  // --- tonelaje
  {
    const ok: ObservedSet[] = [];
    const bad: { s: ObservedSet; reason: string }[] = [];
    for (const s of work) {
      const p = loadProblem(s);
      if (p || !(s.reps !== null && s.reps > 0)) bad.push({ s, reason: p ?? 'sin repeticiones' });
      else ok.push(s);
    }
    const u = used(ok);
    out.tonnage = metricResult({
      metricId: 'tonnage',
      unit: 'kg',
      method: { id: 'sum-kg-x-reps', version: 'v1' },
      ...base,
      value: ok.length ? ok.reduce((a, s) => a + (s.kg as number) * (s.reps as number), 0) : null,
      status: !ok.length ? 'unavailable' : bad.length ? 'partial' : 'available',
      usedRecords: u.refs,
      excluded: [...warmupExcl, ...exclusions(bad)],
      missing: ok.length ? [] : ['series con carga total y repeticiones'],
      warnings: u.warn,
    });
  }
  // --- intensidad relativa e INOL / SI PRG (requieren referencia fechada)
  const refs = inp.references ?? [];
  const retro = inp.referenceMode === 'retrospective';
  const refFor = (s: ObservedSet): { kg: number; info: ReferenceInfo | null } | null => {
    if (retro) {
      const r = referenceAt(refs, s.exerciseName, cutoff);
      return r ? { kg: r.kg, info: toInfo(r) } : null;
    }
    if (s.refKg)
      return {
        kg: s.refKg,
        info: {
          id: null,
          kg: s.refKg,
          source: s.refSource ?? 'plan',
          asOf: s.refAsOf,
          exercise: s.exerciseName,
          version: null,
        },
      };
    const r = referenceAt(refs, s.exerciseName, s.date);
    return r ? { kg: r.kg, info: toInfo(r) } : null;
  };
  const refVersion = retro ? 'v1:retrospectivo' : 'v1';
  const refWarn = retro
    ? ['Recálculo RETROSPECTIVO con la referencia vigente al corte: no es el cálculo original de cada fecha.']
    : [];
  {
    const ok: { s: ObservedSet; ref: number; info: ReferenceInfo | null }[] = [];
    const bad: { s: ObservedSet; reason: string }[] = [];
    for (const s of work) {
      const r = refFor(s);
      const p = loadProblem(s);
      if (p) bad.push({ s, reason: p });
      else if (!r) bad.push({ s, reason: 'sin referencia de fuerza vigente a esa fecha' });
      else ok.push({ s, ref: r.kg, info: r.info });
    }
    const infos = [...new Set(ok.map((x) => JSON.stringify(x.info)))];
    const sameRef = infos.length === 1 ? (JSON.parse(infos[0] as string) as ReferenceInfo) : null;
    const u = used(ok.map((x) => x.s));
    out.intensity_rel = metricResult({
      metricId: 'intensity_rel',
      unit: '% de la referencia',
      method: { id: 'kg-over-reference', version: refVersion },
      ...base,
      value: ok.length ? ok.reduce((a, x) => a + (100 * (x.s.kg as number)) / x.ref, 0) / ok.length : null,
      status: !ok.length ? 'unavailable' : bad.length ? 'partial' : 'available',
      usedRecords: u.refs,
      excluded: [...warmupExcl, ...exclusions(bad)],
      missing: ok.length ? [] : ['referencia de fuerza fechada'],
      reference: sameRef,
      warnings: [
        ...refWarn,
        ...u.warn,
        ...(infos.length > 1
          ? [
              'Se usaron varias referencias (cambió la referencia en el período): la media mezcla bases distintas.',
            ]
          : []),
      ],
    });
    const inol = ok
      .filter((x) => (x.s.reps as number) > 0)
      .map((x) => ({ x, v: inolPrg(x.s.reps as number, x.s.kg as number, x.ref) }));
    const inolOk = inol.filter((i) => i.v !== null);
    out.inol_prg = metricResult({
      metricId: 'inol_prg',
      unit: 'INOL',
      method: { id: 'prg-inol', version: refVersion },
      ...base,
      value: inolOk.length ? inolOk.reduce((a, i) => a + (i.v as number), 0) : null,
      status: !inolOk.length ? 'unavailable' : bad.length ? 'partial' : 'available',
      usedRecords: used(inolOk.map((i) => i.x.s)).refs,
      excluded: [...warmupExcl, ...exclusions(bad)],
      missing: inolOk.length ? [] : ['referencia de fuerza fechada'],
      reference: sameRef,
      warnings: refWarn,
    });
    const withRpe = ok.filter((x) => x.s.rpe !== null);
    const noRpe = ok
      .filter((x) => x.s.rpe === null)
      .map((x) => ({ s: x.s, reason: 'sin RPE real (no se usa el RPE implícito de PRG)' }));
    const siPrg = withRpe
      .map((x) => stressIndexPrg(x.s.kg as number, x.s.reps as number, x.s.rpe as number, x.ref))
      .filter((v): v is number => v !== null);
    out.si_prg = metricResult({
      metricId: 'si_prg',
      unit: `SI (${SI_MODEL_PRG})`,
      method: { id: SI_MODEL_PRG, version: refVersion },
      ...base,
      value: siPrg.length ? siPrg.reduce((a, b) => a + b, 0) : null,
      status: !siPrg.length ? 'unavailable' : bad.length || noRpe.length ? 'partial' : 'available',
      usedRecords: used(withRpe.map((x) => x.s)).refs,
      excluded: [...exclusions(bad), ...exclusions(noRpe)],
      missing: siPrg.length ? [] : ['RPE real', 'referencia de fuerza'],
      reference: sameRef,
      warnings: [
        ...refWarn,
        'Escala propia de PRG: no se suma ni se compara con el SI de RTS ni con el XL de eFort.',
        ...(noRpe.length ? ['Valor parcial: solo series con RPE real.'] : []),
      ],
    });
  }
  // --- SI aproximado de RTS y XL de eFort (requieren RPE real)
  {
    const withRpe = work.filter((s) => s.reps !== null && s.reps > 0 && s.rpe !== null);
    const noRpe = work
      .filter((s) => s.reps !== null && s.reps > 0 && s.rpe === null)
      .map((s) => ({ s, reason: 'sin RPE real registrado' }));
    const sums = withRpe.reduce(
      (a, s) => {
        const x = stressOfSet(s.reps as number, s.rpe as number);
        return { c: a.c + x.central, p: a.p + x.peripheral, t: a.t + x.total };
      },
      { c: 0, p: 0, t: 0 },
    );
    const status = !withRpe.length ? 'unavailable' : noRpe.length ? 'partial' : 'available';
    const u = used(withRpe);
    const warn = [
      ...u.warn,
      `Modelo ${SI_MODEL}: aproximación experimental de RTS, no su fórmula exacta; no comparable con otros SI.`,
      ...(noRpe.length
        ? ['Valor PARCIAL: suma solo las series con RPE real; no es el SI total del período.']
        : []),
    ];
    for (const [id, v, label] of [
      ['si_rts_total', sums.t, 'total'],
      ['si_rts_central', sums.c, 'central'],
      ['si_rts_peripheral', sums.p, 'periférico'],
    ] as const) {
      out[id] = metricResult({
        metricId: id,
        unit: `SI (${SI_MODEL})`,
        method: { id: SI_MODEL, version: SI_MODEL },
        ...base,
        value: withRpe.length ? v : null,
        status,
        usedRecords: u.refs,
        excluded: [...warmupExcl, ...exclusions(noRpe)],
        missing: withRpe.length ? [] : ['RPE real'],
        warnings: [...warn, `Componente: ${label}.`],
      });
    }
    const okXl = withRpe.filter((s) => !loadProblem(s));
    out.si_efort_xl = metricResult({
      metricId: 'si_efort_xl',
      unit: `XL (${SI_MODEL_EFORT})`,
      method: { id: SI_MODEL_EFORT, version: SI_MODEL_EFORT },
      ...base,
      value: okXl.length
        ? okXl.reduce((a, s) => a + exertionLoadEfort(s.kg as number, s.reps as number, s.rpe as number), 0)
        : null,
      status: !okXl.length
        ? 'unavailable'
        : noRpe.length || okXl.length < withRpe.length
          ? 'partial'
          : 'available',
      usedRecords: used(okXl).refs,
      excluded: exclusions(noRpe),
      missing: okXl.length ? [] : ['RPE real', 'carga total'],
      warnings: ['Escala propia de eFort (RIR = 10 − RPE): no se suma ni se compara con SI.'],
    });
  }
  // --- e1RM: dos métodos SEPARADOS
  {
    const eligible = work.filter((s) => s.setType !== 'dropset');
    for (const [id, fn, method] of [
      ['e1rm_table_rpe', (s: ObservedSet) => estimateCurve(s.kg, s.reps, s.rpe, inp.domain), METHOD_CURVE],
      ['e1rm_prg_formulas', (s: ObservedSet) => estimatePrg(s.kg, s.reps), METHOD_PRG],
    ] as const) {
      let best: { s: ObservedSet; v: number } | null = null;
      const bad: { s: ObservedSet; reason: string }[] = [];
      const warns = new Set<string>();
      for (const s of eligible) {
        const lp = loadProblem(s);
        if (lp) {
          bad.push({ s, reason: lp });
          continue;
        }
        const e = fn(s);
        if (e.value === null) {
          bad.push({ s, reason: e.reason ?? 'no disponible' });
          continue;
        }
        e.warnings.forEach((w) => warns.add(w));
        if (!best || e.value > best.v) best = { s, v: e.value };
      }
      out[id] = metricResult({
        metricId: id,
        unit: 'kg',
        method,
        ...base,
        value: best?.v ?? null,
        status: !best ? 'unavailable' : bad.length ? 'partial' : 'available',
        usedRecords: best ? [refOf(best.s)] : [],
        excluded: [
          ...(work.length > eligible.length
            ? [{ reason: `dropsets (${work.length - eligible.length})` }]
            : []),
          ...warmupExcl,
          ...exclusions(bad),
        ],
        missing: best ? [] : id === 'e1rm_table_rpe' ? ['RPE real'] : ['series con reps 1–10'],
        warnings: [
          ...warns,
          'Valor = mejor serie del período con este método; no se une con el otro método.',
        ],
      });
    }
  }
  if (inp.baseline) {
    const b = computeObservedMetrics({
      ...inp,
      from: inp.baseline.from,
      to: inp.baseline.to,
      baseline: undefined,
    });
    for (const [id, r] of Object.entries(out))
      r.baseline = { period: inp.baseline, value: b[id]?.value ?? null };
  }
  return out;
}
