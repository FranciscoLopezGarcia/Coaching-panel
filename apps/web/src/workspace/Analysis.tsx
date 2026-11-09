import { EssentialAnalysis } from './EssentialAnalysis';
import { BlockDashboard } from './BlockDashboard';
import { useState } from 'react';
import type { MetricDefinition, MetricResult, PeriodComparison } from '@coaching/contracts';
import { workspaceApi as w, get, query } from './api';
import { useLoad } from '../hooks';
import { Async } from '../components/Async';
import { PerformanceCurve } from '../performance/PerformanceCurve';
import { CompareTab } from '../pages/athlete/CompareTab';
import { LoadTab } from '../pages/athlete/LoadTab';
import { MicrocyclesTab } from '../pages/athlete/MicrocyclesTab';
import { Detail, Empty, Modal, Message, number, dateLabel, shift, today } from './ui';
export const metricNames: Record<string, string> = {
  nl: 'NL · repeticiones',
  sets: 'Series',
  tonnage: 'Tonelaje',
  frequency: 'Frecuencia',
  si_rts_total: 'SI · RTS aproximado',
  e1rm_table_rpe: 'e1RM · curva RPE',
  e1rm_prg_formulas: 'e1RM · 6 fórmulas PRG',
  si_rts_central: 'SI central · RTS aproximado',
  si_rts_peripheral: 'SI periférico · RTS aproximado',
  si_prg: 'SI · PRG',
  si_efort_xl: 'XL · EFORT',
  inol_prg: 'INOL · PRG',
  intensity_rel: 'Intensidad relativa',
};
export function MetricHelp({
  metric,
  onClose,
  result,
}: {
  metric: MetricDefinition;
  onClose: () => void;
  result?: MetricResult;
}) {
  return (
    <Modal title={metric.name} onClose={onClose}>
      <p>{metric.definition}</p>
      <div className="chip">
        {metric.unit} · {metric.method} · {metric.version} · {metric.provenance}
      </div>
      <h3>Cálculo y alcance</h3>
      <p>{metric.method}</p>
      <p>{metric.domain}</p>
      <p className="small muted">Referencia: {metric.reference}</p>
      <details>
        <summary>Entradas incluidas y exclusiones</summary>
        <Detail
          value={{ entradas: metric.inputs, exclusiones: metric.exclusions, agregación: metric.aggregation }}
        />
      </details>
      <h3>Cómo interpretar el cambio</h3>
      <Detail value={metric.interpretation} />
      <details>
        <summary>Límites y conclusiones que no permite</summary>
        <Detail value={[...metric.limitations, ...metric.doesNotConclude]} />
      </details>
      {result && (
        <details open>
          <summary>Resultado y registros usados</summary>
          <Detail value={result} />
        </details>
      )}
    </Modal>
  );
}
function Bars({
  rows,
  unit,
}: {
  rows: { label: string; planned: number | null; actual: number | null; partial: boolean }[];
  unit: string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.planned ?? 0, r.actual ?? 0]));
  return rows.length ? (
    <div className="bars">
      <div className="row chart-legend">
        <span>
          <i className="planned-swatch" />
          Planificado
        </span>
        <span>
          <i className="actual-swatch" />
          Realizado
        </span>
        <span className="muted">{unit}</span>
      </div>
      {rows.map((r, i) => (
        <div className="bar-row" key={i}>
          <div className="bar-label">
            {r.label}
            {r.partial && <span className="chip">parcial</span>}
          </div>
          <div className="bar-pair">
            {(['planned', 'actual'] as const).map((k) => (
              <div className="bar-track" key={k}>
                <div
                  className={'bar ' + k}
                  style={{ width: r[k] === null ? '0%' : `${(100 * r[k]!) / max}%` }}
                />
                <span>{r[k] === null ? 'Sin dato' : number(r[k])}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <Empty title="Sin dosis para este período">Elegí otro rango o registrá entrenamientos.</Empty>
  );
}
function AdvancedAnalysis({
  id,
  from,
  to,
  onPeriod,
  compact = false,
  cutoff = today(),
}: {
  id: string;
  from: string;
  to: string;
  onPeriod: (from: string, to: string) => void;
  compact?: boolean;
  cutoff?: string;
}) {
  const [view, setView] = useState('trends');
  const [dose, setDose] = useState('nl');
  const [group, setGroup] = useState('movement');
  const [movement, setMovement] = useState('');
  const [seriesKey, setSeries] = useState('');
  const [help, setHelp] = useState<{ metric: MetricDefinition; result?: MetricResult } | null>(null);
  const data = useLoad(async () => {
    const [weekly, series, catalog, muscles, annotations, records] = await Promise.all([
      get<import('./api').Weekly[]>(id, 'weekly' + query({ from, to, cutoff })),
      get<import('./api').Series>(id, 'series' + query({ from, to, cutoff })),
      w.catalog(),
      get<import('./api').MuscleData>(id, 'weekly-muscles' + query({ from, to, cutoff })),
      get<{ date: string; kind: string; label: string }[]>(id, 'annotations' + query({ from, to })),
      get<{
        records: {
          type: string;
          exercise: string;
          variantKey: string;
          key: string;
          value: number;
          unit: string;
          date: string;
          isRealPR: boolean;
        }[];
        note: string;
      }>(id, 'records' + query({ cutoff })),
    ]);
    return { weekly, series, catalog, muscles, annotations, records };
  }, [id, from, to, cutoff]);
  const definition = (key: string) => data.data?.catalog.metrics.find((m) => m.id === key);
  const explain = (key: string, result?: MetricResult) => {
    const metric = definition(key);
    if (metric) setHelp({ metric, result });
  };
  const movements = [
    ...new Set(data.data?.weekly.map((r) => r.movement.exerciseName + ' / ' + r.movement.variantKey) ?? []),
  ];
  const selected = movement || movements[0] || '';
  const rows =
    data.data?.weekly.filter((r) => r.movement.exerciseName + ' / ' + r.movement.variantKey === selected) ??
    [];
  const series = data.data?.series.performance ?? [];
  const selectedSeries =
    series.find((s) => `${s.exercise}|${s.variantKey}|${s.methodId}` === seriesKey) ??
    series.find((s) => s.exercise === selected.split(' / ')[0]) ??
    series[0];
  return (
    <section className={compact ? 'analysis compact-analysis' : 'analysis'}>
      <div className="row between section-heading">
        <div>
          <h2>{compact ? 'Evolución del período' : 'Análisis'}</h2>
          <p className="muted small">Dosis, esfuerzo y rendimiento; cada uno en su contexto.</p>
        </div>
        <div className="row period-controls">
          <label>
            Desde
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => e.target.value && onPeriod(e.target.value, to)}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              min={from}
              value={to}
              onChange={(e) => e.target.value && onPeriod(from, e.target.value)}
            />
          </label>
        </div>
      </div>
      {!compact && (
        <div className="row tabs">
          <button className={view === 'trends' ? 'on' : ''} onClick={() => setView('trends')}>
            Evolución
          </button>
          <button className={view === 'compare' ? 'on' : ''} onClick={() => setView('compare')}>
            Comparativas
          </button>
          <button className={view === 'blocks' ? 'on' : ''} onClick={() => setView('blocks')}>
            Bloques y TTP
          </button>
          <button className={view === 'load' ? 'on' : ''} onClick={() => setView('load')}>
            Detalle de dosis
          </button>
        </div>
      )}
      {view === 'trends' && (
        <Async state={data}>
          {(d) => (
            <>
              <div className="row toolbar">
                <label>
                  Agrupar
                  <select value={group} onChange={(e) => setGroup(e.target.value)}>
                    <option value="movement">Por movimiento y variante</option>
                    <option value="muscle">Por grupo muscular</option>
                  </select>
                </label>
                {group === 'movement' && (
                  <label>
                    Movimiento
                    <select value={selected} onChange={(e) => setMovement(e.target.value)}>
                      {movements.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                )}
                <span className="small muted">Período compartido por todos los gráficos</span>
              </div>
              <div className="analysis-grid">
                <article className="chart-panel">
                  <div className="row between">
                    <h3>Volumen</h3>
                    <div className="row">
                      {group === 'movement' && (
                        <select
                          aria-label="Métrica de volumen"
                          value={dose}
                          onChange={(e) => setDose(e.target.value)}
                        >
                          <option value="nl">NL</option>
                          <option value="sets">Series</option>
                          <option value="tonnage">Tonelaje</option>
                        </select>
                      )}
                      <button
                        className="help-button"
                        aria-label="Explicar volumen"
                        onClick={() => explain(group === 'movement' ? dose : 'muscle_sets_equivalent')}
                      >
                        ?
                      </button>
                    </div>
                  </div>
                  {group === 'movement' ? (
                    <Bars
                      unit={definition(dose)?.unit ?? ''}
                      rows={rows.map((r) => ({
                        label: dateLabel(r.week.from),
                        planned: r.planned?.[dose as 'nl' | 'sets' | 'tonnage'] ?? null,
                        actual: r.actual[dose]?.value ?? null,
                        partial: r.week.partial,
                      }))}
                    />
                  ) : (
                    <>
                      <p className="small muted">
                        Directo × {d.muscles.convention.directWeight}; indirecto ×{' '}
                        {d.muscles.convention.indirectWeight}. Grupos superpuestos: no se suman.
                      </p>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Semana</th>
                              <th>Músculo</th>
                              <th>Directas</th>
                              <th>Indirectas</th>
                              <th>Equivalentes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.muscles.rows.map((r, i) => (
                              <tr key={i}>
                                <td>
                                  {dateLabel(r.week.from)}
                                  {r.week.partial ? ' · parcial' : ''}
                                </td>
                                <td>{r.muscle}</td>
                                <td>{number(r.directSets)}</td>
                                <td>{number(r.indirectSets)}</td>
                                <td>{number(r.equivalentSets)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {d.muscles.warnings.map((x) => (
                        <p className="small muted" key={x}>
                          {x}
                        </p>
                      ))}
                      <Message>
                        La API muscular entrega ejecución. El desglose muscular planificado no está
                        disponible.
                      </Message>
                    </>
                  )}
                </article>
                <article className="chart-panel">
                  <div className="row between">
                    <h3>Estrés por movimiento</h3>
                    <button
                      className="help-button"
                      aria-label="Explicar Stress Index"
                      onClick={() => explain('si_rts_total')}
                    >
                      ?
                    </button>
                  </div>
                  <p className="small muted">
                    Modelo rts-aprox-v1 · aproximado. SI faltante permanece sin dato.
                  </p>
                  <Bars
                    unit="SI · adimensional"
                    rows={rows.map((r) => ({
                      label: dateLabel(r.week.from),
                      planned: r.planned?.siTotal ?? null,
                      actual: r.actual.si_rts_total?.value ?? null,
                      partial: r.week.partial,
                    }))}
                  />
                </article>
                <article className="chart-panel performance-panel">
                  <div className="row between">
                    <h3>Rendimiento estimado</h3>
                    <button
                      className="help-button"
                      aria-label="Explicar e1RM"
                      onClick={() =>
                        explain(
                          selectedSeries?.methodId === 'prg-6-formulas'
                            ? 'e1rm_prg_formulas'
                            : 'e1rm_table_rpe',
                        )
                      }
                    >
                      ?
                    </button>
                  </div>
                  <label>
                    Ejercicio, variante y método
                    <select
                      value={
                        selectedSeries
                          ? `${selectedSeries.exercise}|${selectedSeries.variantKey}|${selectedSeries.methodId}`
                          : ''
                      }
                      onChange={(e) => setSeries(e.target.value)}
                    >
                      {series.map((s) => (
                        <option
                          key={`${s.exercise}|${s.variantKey}|${s.methodId}`}
                          value={`${s.exercise}|${s.variantKey}|${s.methodId}`}
                        >
                          {s.exercise} · {s.variantKey} · {s.methodId}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedSeries ? (
                    <>
                      <p className="small muted">
                        Método {selectedSeries.methodId} · {selectedSeries.methodVersion} · e1RM no es una
                        marca real.
                      </p>
                      <PerformanceCurve
                        cutoff={cutoff}
                        id={id}
                        exercise={selectedSeries.exercise}
                        variant={selectedSeries.variantKey}
                        method={selectedSeries.methodId}
                        from={from}
                        to={to}
                        historical={selectedSeries.points.filter((p) => p.date >= from && p.date <= to)}
                      />
                    </>
                  ) : (
                    <Empty title="Sin estimaciones disponibles">
                      La curva requiere carga, repeticiones y RPE real válidos.
                    </Empty>
                  )}
                </article>
                <article className="chart-panel">
                  <h3>Marcas reales</h3>
                  <p className="small muted">
                    Histórico hasta el corte del servidor, separado de estimaciones.
                  </p>
                  <div className="record-list">
                    {d.records.records
                      .filter(
                        (r) =>
                          r.isRealPR &&
                          (!selectedSeries ||
                            (r.exercise === selectedSeries.exercise &&
                              r.variantKey === selectedSeries.variantKey)),
                      )
                      .slice(0, 8)
                      .map((r, i) => (
                        <div key={i} className="row between">
                          <span>
                            {r.key}
                            <small className="muted"> · {dateLabel(r.date)}</small>
                          </span>
                          <strong>
                            {number(r.value)} {r.unit}
                          </strong>
                        </div>
                      ))}
                  </div>
                  {!d.records.records.some((r) => r.isRealPR) && (
                    <p className="muted">Todavía no hay marcas registradas.</p>
                  )}
                </article>
              </div>
              <details>
                <summary>Valores semanales y calidad de cálculo</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Semana</th>
                        <th>NL plan / real</th>
                        <th>Series plan / real</th>
                        <th>Tonelaje plan / real</th>
                        <th>Frecuencia plan / real</th>
                        <th>Intensidad real</th>
                        <th>Disponibilidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td>
                            {r.week.from} {r.week.partial ? '· parcial' : ''}
                          </td>
                          {(['nl', 'sets', 'tonnage', 'frequency'] as const).map((k) => (
                            <td key={k}>
                              <button className="text-button" onClick={() => explain(k, r.actual[k])}>
                                {number(r.planned?.[k])} / {number(r.actual[k]?.value)}
                              </button>
                            </td>
                          ))}
                          <td>
                            <button
                              className="text-button"
                              onClick={() => explain('intensity_rel', r.actual.intensity_rel)}
                            >
                              {number(r.actual.intensity_rel?.value)}
                            </button>
                          </td>
                          <td>
                            {Object.values(r.actual).some((x) => x.status === 'partial')
                              ? 'Resultado parcial'
                              : Object.keys(r.actual).length
                                ? 'Con datos'
                                : 'Sin ejecución'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <details open={!!d.annotations.length}>
                <summary>Competencias, cambios e intervenciones · {d.annotations.length}</summary>
                {d.annotations.map((a, i) => (
                  <div className="timeline-entry" key={i}>
                    <time>{a.date}</time>
                    <span className="chip">{a.kind}</span>
                    <span>{a.label}</span>
                  </div>
                ))}
                {!d.annotations.length && (
                  <p className="small muted">Sin anotaciones disponibles en este período.</p>
                )}
              </details>
              <details>
                <summary>Catálogo y métodos disponibles</summary>
                <div className="catalog-grid">
                  {d.catalog.metrics.map((m) => (
                    <button key={m.id} onClick={() => setHelp({ metric: m })}>
                      {m.name}{' '}
                      <span className="muted">
                        {m.unit} · {m.implementation}
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            </>
          )}
        </Async>
      )}
      {view === 'compare' && (
        <>
          <PeriodCompare id={id} cutoff={cutoff} />
          <details>
            <summary>Comparar dos mesociclos · prescripción o ejecución</summary>
            <CompareTab id={id} />
          </details>
        </>
      )}
      {view === 'blocks' && <MicrocyclesTab id={id} />} {view === 'load' && <LoadTab id={id} />}
      {help && <MetricHelp {...help} onClose={() => setHelp(null)} />}
    </section>
  );
}
function PeriodCompare({ id, cutoff }: { id: string; cutoff: string }) {
  const [aFrom, setAF] = useState(shift(cutoff, -13));
  const [aTo, setAT] = useState(shift(cutoff, -7));
  const [bFrom, setBF] = useState(shift(cutoff, -6));
  const [bTo, setBT] = useState(cutoff);
  const [lift, setLift] = useState('ALL');
  const [exercise, setExercise] = useState('');
  const [result, setResult] = useState<PeriodComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="card">
      <h3>Comparar semanas o períodos</h3>
      <p className="small muted">
        Ejecución y respuesta observada. Las métricas aditivas se normalizan por semana; compará prescripción
        entre mesos en la sección siguiente.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (aFrom > aTo || bFrom > bTo) {
            setError('Revisá los intervalos.');
            return;
          }
          setBusy(true);
          setError('');
          try {
            setResult(await w.period(id, { aFrom, aTo, bFrom, bTo, lift, exercise, cutoff }));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {(
            [
              ['A · desde', aFrom, setAF],
              ['A · hasta', aTo, setAT],
              ['B · desde', bFrom, setBF],
              ['B · hasta', bTo, setBT],
            ] as const
          ).map(([l, v, set]) => (
            <label key={l}>
              {l}
              <input
                type="date"
                required
                value={v}
                onChange={(e) => {
                  set(e.target.value);
                  setResult(null);
                }}
              />
            </label>
          ))}
          <label>
            Movimiento
            <select
              value={lift}
              onChange={(e) => {
                setLift(e.target.value);
                setResult(null);
              }}
            >
              <option value="ALL">Todos</option>
              <option value="SQ">Sentadilla</option>
              <option value="BP">Banca</option>
              <option value="DL">Peso muerto</option>
            </select>
          </label>
          <label>
            Ejercicio exacto (opcional)
            <input
              value={exercise}
              onChange={(e) => {
                setExercise(e.target.value);
                setResult(null);
              }}
            />
          </label>
        </div>
        <button disabled={busy} className="primary">
          {busy ? 'Comparando…' : 'Comparar períodos'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setResult(await get<PeriodComparison>(id, 'week-compare' + query({ lift, exercise, cutoff })));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Actual contra anterior (semanas calendario)
        </button>
      </form>
      {error && <Message error>{error}</Message>}
      {result && (
        <>
          <p className="small">
            A: {result.a.period.from} → {result.a.period.to} ({result.a.days} días
            {result.a.partial ? ', parcial' : ''}) · B: {result.b.period.from} → {result.b.period.to} (
            {result.b.days} días{result.b.partial ? ', parcial' : ''})
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Métrica</th>
                  <th>A</th>
                  <th>B</th>
                  <th>Δ absoluto</th>
                  <th>A / semana</th>
                  <th>B / semana</th>
                  <th>Δ / semana</th>
                  <th>Disponibilidad</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.metricId}>
                    <td>
                      {metricNames[r.metricId] ?? r.metricId}
                      <small> · {r.unit}</small>
                    </td>
                    <td>{number(r.a)}</td>
                    <td>{number(r.b)}</td>
                    <td>{number(r.diff)}</td>
                    <td>{number(r.aPerWeek)}</td>
                    <td>{number(r.bPerWeek)}</td>
                    <td>{number(r.diffPerWeek)}</td>
                    <td>
                      {(
                        {
                          available: 'Disponible',
                          partial: 'Parcial',
                          unavailable: 'Cálculo no disponible',
                        } as Record<string, string>
                      )[r.statusA] ?? r.statusA}{' '}
                      /{' '}
                      {(
                        {
                          available: 'Disponible',
                          partial: 'Parcial',
                          unavailable: 'Cálculo no disponible',
                        } as Record<string, string>
                      )[r.statusB] ?? r.statusB}
                      <p className="small muted">{r.note}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.notes.map((n) => (
            <Message key={n}>{n}</Message>
          ))}
        </>
      )}
    </div>
  );
}

export function Analysis(props: Parameters<typeof AdvancedAnalysis>[0]) {
  const [advanced, setAdvanced] = useState(false);
  return (
    <>
      <BlockDashboard
        id={props.id}
        classic={
          <EssentialAnalysis
            id={props.id}
            from={props.from}
            to={props.to}
            cutoff={props.cutoff ?? today()}
            onPeriod={props.onPeriod}
          />
        }
      />
      <details className="advanced-analysis" onToggle={(e) => setAdvanced(e.currentTarget.open)}>
        <summary>Análisis avanzado · otras métricas, proyecciones y comparativas</summary>
        {advanced && <AdvancedAnalysis {...props} compact={false} />}
      </details>
    </>
  );
}
