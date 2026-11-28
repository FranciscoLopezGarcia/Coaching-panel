import { useMemo, useState, type ReactNode } from 'react';
import { MetricChart, DeltaTag, type CBlock, type CRow } from '../workspace/BlockCharts';
import { OverviewChart, type Threshold } from '../workspace/OverviewChart';
import { number } from '../workspace/ui';
import { SERIES_COLORS, periodLabel, tracesFor, valueOf } from './derive';
import type { Family } from './families';
import type { AnalysisState } from './state';
import type { AnalysisMetric, AnalysisResult, Linked, PeriodRow } from './types';

/** Reglas para mostrar varias métricas en un mismo gráfico: misma unidad y misma familia de escala. */
const compatible = (a: AnalysisMetric, b: AnalysisMetric) =>
  a.unit === b.unit && a.modelFamily === b.modelFamily;

export function MetricChips({
  metrics,
  visible,
  onVisible,
  state,
}: {
  metrics: AnalysisMetric[];
  visible: string[];
  onVisible: (ids: string[]) => void;
  state: AnalysisState;
}) {
  const toggleVisible = (m: AnalysisMetric) => {
    if (visible.includes(m.id))
      return onVisible(visible.length > 1 ? visible.filter((v) => v !== m.id) : visible);
    const keep = visible.filter((v) => {
      const o = metrics.find((x) => x.id === v);
      return o && compatible(o, m);
    });
    onVisible([...keep, m.id]);
  };
  return (
    <ul className="an-chips">
      {metrics.map((m) => (
        <li key={m.id} className={state.sel.includes(m.id) ? 'sel' : ''}>
          <input
            type="checkbox"
            checked={state.sel.includes(m.id)}
            onChange={() => state.toggle([m.id])}
            aria-label={`Elegir ${m.label} para comparar`}
            title="Elegir para la comparativa"
          />
          <button
            type="button"
            aria-pressed={visible.includes(m.id)}
            onClick={() => toggleVisible(m)}
            title="Mostrar en el gráfico"
          >
            {m.label}
            <small>{m.unit}</small>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function PeriodTable({
  periods,
  metrics,
  state,
  linked,
  onOpen,
  highlight,
}: {
  periods: PeriodRow[];
  metrics: AnalysisMetric[];
  state: AnalysisState;
  linked: Linked;
  onOpen: (p: PeriodRow) => void;
  highlight: string[];
}) {
  const side = state.source === 'plan' ? 'plan' : 'real';
  return (
    <div className="an-tablewrap">
      <table className="an-table">
        <thead>
          <tr>
            <th>{state.scale === 'week' ? 'Semana' : 'Sesión'}</th>
            {metrics.map((m) => (
              <th key={m.id} className={highlight.includes(m.id) ? 'on' : ''}>
                {m.label}
                <small>{m.unit}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr
              key={p.key}
              className={`${linked.date === p.from ? 'linked' : ''} ${p.future ? 'future' : ''}`}
              onMouseEnter={() => linked.set(p.from)}
              onMouseLeave={() => linked.set(null)}
              onClick={() => onOpen(p)}
            >
              <th scope="row">
                {periodLabel(p, state.scale)}
                <small>{p.blockKey}</small>
              </th>
              {metrics.map((m) => {
                const v = valueOf(p, m.id, side);
                const plan = state.source === 'ambos' && m.hasPlan ? valueOf(p, m.id, 'plan') : null;
                return (
                  <td key={m.id} className={highlight.includes(m.id) ? 'on' : ''}>
                    <span className="num">{v === null ? '—' : number(v, m.decimals)}</span>
                    {plan !== null && <small className="plan">prev. {number(plan, m.decimals)}</small>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockTable({
  rows,
  blocks,
  labels,
}: {
  rows: CRow[];
  blocks: CBlock[];
  labels: Record<string, string>;
}) {
  return (
    <div className="an-tablewrap">
      <table className="an-table">
        <thead>
          <tr>
            <th>Bloque</th>
            {rows.map((r) => (
              <th key={r.metricId}>
                {labels[r.metricId] ?? r.metricId}
                <small>{r.unit}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blocks.map((b, i) => (
            <tr key={b.blockKey} className={b.closed ? '' : 'future'}>
              <th scope="row">
                B{i} · {b.blockKey}
                <small>
                  {b.weeks} sem{b.closed ? '' : ' · en curso'}
                </small>
              </th>
              {rows.map((r) => {
                const v = r.values[i] ?? null;
                return (
                  <td key={r.metricId}>
                    <span className="num">
                      {v === null ? 'No observada' : number(v, r.metricId.includes('tonnage') ? 0 : 1)}
                    </span>
                    {i > 0 && <DeltaTag d={r.deltas[i - 1]} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FamilyCard({
  family,
  data,
  periods,
  state,
  linked,
  onOpen,
  bands,
  blockExtra,
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
  family: Family;
  data: AnalysisResult;
  periods: PeriodRow[];
  state: AnalysisState;
  linked: Linked;
  onOpen: (p: PeriodRow) => void;
  bands: { from: string; to: string; color: string; label: string }[];
  /** Contenido propio de la vista por bloque (p. ej. zonas de intensidad en Carga). */
  blockExtra?: ReactNode;
}) {
  const metrics = useMemo(
    () =>
      family.metrics
        .map((id) => data.metrics.find((m) => m.id === id))
        .filter((m): m is AnalysisMetric => !!m),
    [family, data.metrics],
  );
  const [visible, setVisible] = useState<string[]>(() =>
    (family.showAll ? metrics : metrics.slice(0, 1)).map((m) => m.id),
  );
  const mode = family.blockView ? state.mode(family.id) : 'periodo';
  const shown = metrics.filter((m) => visible.includes(m.id));
  const th = data.blocks?.thresholds;
  const thresholds: Threshold[] = [];
  if (th && shown.some((m) => m.id === 'rpe_dev'))
    thresholds.push({
      from: th.rpeTolerance,
      to: 1000,
      color: 'var(--warn)',
      label: `sobre la tolerancia (+${number(th.rpeTolerance, 1)})`,
    });
  if (th && shown.some((m) => m.id === 'compliance_sets'))
    thresholds.push({
      from: 0,
      to: 100 * th.compliance,
      color: 'var(--warn)',
      label: `bajo el mínimo configurado (${number(100 * th.compliance, 0)} %)`,
    });
  if (th && shown.some((m) => m.id === 'fatigue_end'))
    thresholds.push({
      from: th.fatigue,
      to: 10,
      color: 'var(--warn)',
      label: `desde ${number(th.fatigue, 0)}: cuenta para R-FREQUENCY`,
    });

  const blockRows: CRow[] = useMemo(() => {
    const rows = (data.blocks?.rows ?? []) as unknown as CRow[];
    return metrics.flatMap((m) => {
      const r = m.blockRow ? rows.find((x) => x.metricId === m.blockRow) : undefined;
      return r ? [r] : [];
    });
  }, [data.blocks, metrics]);
  const labelByRow = Object.fromEntries(
    metrics.filter((m) => m.blockRow).map((m) => [m.blockRow as string, m.label]),
  );
  const blockOf = (m: AnalysisMetric) => blockRows.find((r) => r.metricId === m.blockRow);
  const focus = shown.find((m) => blockOf(m)) ?? metrics.find((m) => blockOf(m));
  const cblocks = (data.blocks?.window.blocks ?? []) as CBlock[];
  const none = !periods.some((p) =>
    shown.some(
      (m) =>
        valueOf(p, m.id, state.source === 'plan' ? 'plan' : 'real') !== null ||
        valueOf(p, m.id, 'plan') !== null,
    ),
  );

  return (
    <section className="an-card" id={family.id} aria-labelledby={`h-${family.id}`}>
      <header className="an-cardhead">
        <label className="an-all" title="Elegir toda la familia para la comparativa">
          <input
            type="checkbox"
            checked={metrics.every((m) => state.sel.includes(m.id))}
            ref={(el) => {
              if (el)
                el.indeterminate =
                  metrics.some((m) => state.sel.includes(m.id)) &&
                  !metrics.every((m) => state.sel.includes(m.id));
            }}
            onChange={() => state.toggle(metrics.map((m) => m.id))}
            aria-label={`Elegir toda la familia ${family.title}`}
          />
        </label>
        <div>
          <h3 id={`h-${family.id}`}>{family.title}</h3>
          <p>{family.hint}</p>
        </div>
        <button type="button" className="an-fold" aria-expanded={open} onClick={onToggle}>
          {open ? 'Ocultar' : 'Mostrar'}
        </button>
        {open && family.blockView && (
          <div className="an-seg" role="group" aria-label="Vista">
            <button
              type="button"
              aria-pressed={mode === 'periodo'}
              onClick={() => state.setMode(family.id, 'periodo')}
            >
              Por {state.scale === 'week' ? 'semana' : 'sesión'}
            </button>
            <button
              type="button"
              aria-pressed={mode === 'bloque'}
              onClick={() => state.setMode(family.id, 'bloque')}
            >
              Por bloque
            </button>
          </div>
        )}
      </header>
      {open && (
        <>
          <MetricChips metrics={metrics} visible={visible} onVisible={setVisible} state={state} />
          {mode === 'periodo' ? (
            <>
              {none ? (
                <p className="an-empty">
                  Sin registros comparables en este período
                  {state.source === 'plan' ? '' : '. Probá con «Ambos» o ampliá el período'}.
                </p>
              ) : (
                <div className="an-chart">
                  <OverviewChart
                    title={shown.map((m) => m.label).join(' · ')}
                    unit={shown[0]?.unit ?? ''}
                    traces={shown.flatMap((m, i) =>
                      tracesFor(periods, m, state.source, SERIES_COLORS[i % SERIES_COLORS.length] as string),
                    )}
                    bands={bands}
                    thresholds={thresholds}
                    area={shown.length > 1}
                    zoom={!shown.some((m) => ['compliance_sets', 'fatigue_end'].includes(m.id))}
                    domain={
                      shown.some((m) => m.id === 'fatigue_end')
                        ? [0, 10]
                        : shown.some((m) => m.id === 'compliance_sets')
                          ? [0, 100]
                          : undefined
                    }
                    height={250}
                    width={1040}
                    linkedDate={linked.date}
                    onHoverDate={linked.set}
                  />
                </div>
              )}
              <PeriodTable
                periods={periods}
                metrics={metrics}
                state={state}
                linked={linked}
                onOpen={onOpen}
                highlight={visible}
              />
            </>
          ) : blockRows.length && data.blocks ? (
            <>
              {focus && blockOf(focus) && (
                <MetricChart row={blockOf(focus) as CRow} label={focus.label} blocks={cblocks} />
              )}
              <BlockTable rows={blockRows} blocks={cblocks} labels={labelByRow} />
              {blockExtra}
              {blockRows.length < metrics.length && (
                <p className="an-note">
                  {metrics
                    .filter((m) => !m.blockRow)
                    .map((m) => m.label)
                    .join(', ')}
                  : sin vista por bloque; se ve por {state.scale === 'week' ? 'semana' : 'sesión'}.
                </p>
              )}
            </>
          ) : (
            <p className="an-empty">No hay bloques con datos para comparar en este período.</p>
          )}
        </>
      )}
    </section>
  );
}
