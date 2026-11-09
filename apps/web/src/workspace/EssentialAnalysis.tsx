import { prescribedReps } from './prescription';
import { AnalysisOverview } from './AnalysisOverview';
import { useEffect, useState } from 'react';
import type { SessionRow } from '@coaching/contracts';
import { api } from '../api/client';
import { useLoad } from '../hooks';
import { Async } from '../components/Async';
import { fetchCoreSessions } from './core';
import { Curve } from '../performance/PerformanceCurve';
import { get, query, workspaceApi, type Weekly, type Series, type MuscleData } from './api';
import { dateLabel, number, readSearch, updateSearch, Detail, Modal } from './ui';
export type EssentialProps = {
  id: string;
  from: string;
  to: string;
  cutoff: string;
  onPeriod: (from: string, to: string) => void;
};
type RecordRow = {
  type: string;
  exercise: string;
  variantKey: string;
  key: string;
  value: number;
  unit: string;
  date: string;
  isRealPR: boolean;
};
const key = (name: string, variant: string) => JSON.stringify([name, variant]);
const metricValue = (row: Weekly, metric: 'nl' | 'tonnage' | 'siTotal', actual: boolean) =>
  actual
    ? (row.actual[metric === 'siTotal' ? 'si_rts_total' : metric]?.value ?? null)
    : (row.planned?.[metric] ?? null);
function DoseChart({
  rows,
  metric,
}: {
  rows: { label: string; planned: number | null; actual: number | null }[];
  metric: string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.planned ?? 0, r.actual ?? 0]));
  const hasPlan = rows.some((r) => r.planned !== null);
  return (
    <div className="essential-bars">
      <div className="row chart-legend">
        {hasPlan && (
          <span>
            <i className="planned-swatch" />
            Previsto
          </span>
        )}
        <span>
          <i className="actual-swatch" />
          Realizado
        </span>
        <span>{metric}</span>
      </div>
      {rows.length ? (
        rows.map((r, i) => (
          <div className="essential-bar" key={i}>
            <time>{r.label}</time>
            <div>
              {(hasPlan ? (['planned', 'actual'] as const) : (['actual'] as const)).map((k) => (
                <div className="essential-track" key={k}>
                  <span
                    className={'essential-fill ' + k}
                    style={{ width: `${((r[k] ?? 0) / max) * 100}%` }}
                  />
                  <b>{r[k] === null ? '—' : number(r[k])}</b>
                </div>
              ))}
            </div>
          </div>
        ))
      ) : (
        <p className="empty">Sin datos en este período.</p>
      )}
    </div>
  );
}
function DetailedAnalysis({ id, from, to, cutoff, onPeriod }: EssentialProps) {
  const [scale, setScale] = useState(readSearch().get('scale') === 'session' ? 'session' : 'week');
  useEffect(() => {
    const sync = () => setScale(readSearch().get('scale') === 'session' ? 'session' : 'week');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const [selected, setSelected] = useState(readSearch().get('movement') ?? '');
  const [metric, setMetric] = useState<'nl' | 'tonnage' | 'siTotal'>('nl');
  const [method, setMethod] = useState('table-rpe');
  const [strength, setStrength] = useState('estimated');
  const [evidence, setEvidence] = useState<unknown>(null);
  const [muscle, setMuscle] = useState('');
  const [help, setHelp] = useState<string | null>(null);
  const data = useLoad(async () => {
    const [weekly, series, muscles, sessions, records, refs] = await Promise.all([
      get<Weekly[]>(id, 'weekly' + query({ from, to, cutoff })),
      get<Series>(id, 'series' + query({ from, to, cutoff })),
      get<MuscleData>(id, 'weekly-muscles' + query({ from, to, cutoff })),
      api.sessions(id),
      get<{ records: RecordRow[] }>(id, 'records' + query({ cutoff })),
      workspaceApi.references(id),
    ]);
    return { weekly, series, muscles, sessions, records, refs };
  }, [id, from, to, cutoff]);
  const options = Array.from(
    new Map(
      [
        ...(data.data?.weekly.map((r) => ({
          name: r.movement.exerciseName,
          variant: r.movement.variantKey,
        })) ?? []),
        ...(data.data?.series.performance.map((s) => ({ name: s.exercise, variant: s.variantKey })) ?? []),
      ].map((x) => [key(x.name, x.variant), x]),
    ).entries(),
  );
  const selection = options.find(([k]) => k === selected) ?? options[0];
  const exercise = selection?.[1].name ?? '';
  const variant = selection?.[1].variant ?? '';
  const weekly =
    data.data?.weekly.filter((r) => key(r.movement.exerciseName, r.movement.variantKey) === selection?.[0]) ??
    [];
  const periodSessions = (data.data?.sessions ?? []).filter((s) => s.date >= from && s.date <= to);
  const sessions = periodSessions.filter((s) =>
    s.sets.some((x) => x.exerciseName === exercise && x.variantKey === variant),
  );
  const core = useLoad(
    () =>
      scale === 'session'
        ? fetchCoreSessions(id, from, to, cutoff)
        : Promise.resolve({ version: '', sessions: [], warnings: [] }),
    [id, scale, from, to, cutoff],
  );
  const exposures = (core.data?.sessions ?? []).flatMap((s) =>
    s.exercises
      .filter((e) => e.exerciseName === exercise && e.variantKey === variant)
      .map((e) => ({ ...e, key: s.key, sessionKey: s.sessionKey, date: s.date })),
  );
  const catalog = useLoad(() => (help ? workspaceApi.catalog() : Promise.resolve(null)), [help]);
  const muscleRows =
    scale === 'week'
      ? (data.data?.muscles.rows ?? []).map((r) => ({ ...r, sessionLabel: '' }))
      : (core.data?.sessions ?? []).flatMap((s, i) =>
          s.muscles.rows.map((r) => ({
            ...r,
            week: { from: s.date, to: s.date, partial: false },
            sessionKey: s.sessionKey,
            sessionLabel: ' · S' + (i + 1),
          })),
        );
  const groups = [...new Set(muscleRows.map((r) => r.muscle))];
  const activeMuscle = groups.includes(muscle) ? muscle : groups[0];
  const perf = data.data?.series.performance.find(
    (s) => s.exercise === exercise && s.variantKey === variant && s.methodId === method,
  );
  const points =
    scale === 'week'
      ? (perf?.points.filter((p) => p.date >= from && p.date <= to && p.date <= cutoff) ?? [])
      : exposures.flatMap((e) => {
          const m = method === 'table-rpe' ? e.metrics.e1rm.curve : e.metrics.e1rm.prg;
          return m.value === null ? [] : [{ date: e.date, value: m.value }];
        });
  const singlePoints = (data.data?.sessions ?? [])
    .flatMap((s) =>
      s.sets.flatMap((x) => {
        const a = x.actual;
        const date = a?.performedOn ?? s.date;
        return x.exerciseName === exercise &&
          x.variantKey === variant &&
          a?.status === 'done' &&
          a.reps === 1 &&
          a.kg !== null &&
          date >= from &&
          date <= to &&
          date <= cutoff
          ? [{ date, value: a.kg }]
          : [];
      }),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const strengthPoints = strength === 'estimated' ? points : singlePoints;
  const singles =
    data.data?.records.records.filter(
      (r) => r.type === 'single' && r.isRealPR && r.exercise === exercise && r.variantKey === variant,
    ) ?? [];
  const doseRows =
    scale === 'week'
      ? weekly.map((r) => ({
          label: dateLabel(r.week.from) + (r.week.partial ? ' · parcial' : ''),
          planned: metricValue(r, metric, false),
          actual: metricValue(r, metric, true),
        }))
      : exposures.map((e, i) => ({
          label: dateLabel(e.date) + ' · S' + (i + 1),
          planned: null,
          actual: (metric === 'siTotal' ? e.metrics.si.rts.total : e.metrics[metric]).value,
        }));
  const changeScale = (v: string) => {
    setScale(v);
    updateSearch({ scale: v }, true);
  };
  return (
    <section className="essential-analysis">
      <div className="row between section-heading">
        <div>
          <h2>Entrenamiento en números</h2>
          <p className="small muted">SI · NL · Tonelaje · Volumen muscular · 1RM y e1RM</p>
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
              value={to}
              min={from}
              onChange={(e) => e.target.value && onPeriod(from, e.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="row essential-controls">
        <div className="row">
          <button className={scale === 'week' ? 'on' : ''} onClick={() => changeScale('week')}>
            Semana a semana
          </button>
          <button className={scale === 'session' ? 'on' : ''} onClick={() => changeScale('session')}>
            Sesión a sesión
          </button>
        </div>
        <label>
          Ejercicio / variante
          <select
            value={selection?.[0] ?? ''}
            onChange={(e) => {
              setSelected(e.target.value);
              updateSearch({ movement: e.target.value }, true);
            }}
          >
            {options.map(([k, x]) => (
              <option key={k} value={k}>
                {x.name} · {x.variant}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Async state={data}>
        {(d) => (
          <>
            <article className="essential-panel">
              <div className="row between">
                <h3>Carga de entrenamiento</h3>
                <button
                  className="help-button"
                  aria-label="Qué significan SI, NL y tonelaje"
                  onClick={() => setHelp(metric === 'siTotal' ? 'si_rts_total' : metric)}
                >
                  ?
                </button>
              </div>
              <div className="row essential-metrics">
                {(
                  [
                    ['siTotal', 'SI', 'rts-aprox-v1'],
                    ['nl', 'NL', 'repeticiones'],
                    ['tonnage', 'Tonelaje', 'kg'],
                  ] as const
                ).map(([id, label, unit]) => (
                  <button key={id} className={metric === id ? 'selected' : ''} onClick={() => setMetric(id)}>
                    <strong>{label}</strong>
                    <small>{unit}</small>
                  </button>
                ))}
              </div>
              {scale === 'week' ? (
                <DoseChart
                  rows={doseRows}
                  metric={
                    metric === 'siTotal' ? 'SI · rts-aprox-v1' : metric === 'tonnage' ? 'kg' : 'repeticiones'
                  }
                />
              ) : (
                <Async state={core}>
                  {() => (
                    <>
                      <p className="small muted">
                        Valores realizados por sesión y variante. Consultá las series debajo para comparar con
                        la prescripción.
                      </p>
                      <DoseChart
                        rows={doseRows}
                        metric={
                          metric === 'siTotal'
                            ? 'SI · rts-aprox-v1'
                            : metric === 'tonnage'
                              ? 'kg'
                              : 'repeticiones'
                        }
                      />
                    </>
                  )}
                </Async>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{scale === 'week' ? 'Semana' : 'Sesión'}</th>
                      <th>SI</th>
                      <th>NL</th>
                      <th>Tonelaje · kg</th>
                      <th>Series</th>
                      <th>
                        <span className="sr-only">Detalle</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {scale === 'week'
                      ? weekly.map((r, i) => (
                          <tr key={i}>
                            <td>
                              {r.week.from}
                              {r.week.partial ? ' · parcial' : ''}
                            </td>
                            <td>
                              {number(r.planned?.siTotal)} / {number(r.actual.si_rts_total?.value)}
                            </td>
                            <td>
                              {number(r.planned?.nl, 0)} / {number(r.actual.nl?.value, 0)}
                            </td>
                            <td>
                              {number(r.planned?.tonnage)} / {number(r.actual.tonnage?.value)}
                            </td>
                            <td>
                              {number(r.planned?.sets, 0)} / {number(r.actual.sets?.value, 0)}
                            </td>
                            <td>
                              <button onClick={() => setEvidence(r)}>
                                Ver datos
                                {Object.values(r.actual).some((m) => m.status === 'partial')
                                  ? ' · parcial'
                                  : ''}
                              </button>
                            </td>
                          </tr>
                        ))
                      : exposures.map((r, i) => (
                          <tr key={r.key}>
                            <td>
                              {r.date}
                              <small className="muted" title={r.sessionKey}>
                                {' '}
                                · S{i + 1}
                              </small>
                            </td>
                            {[r.metrics.si.rts.total, r.metrics.nl, r.metrics.tonnage, r.metrics.sets].map(
                              (m, i) => (
                                <td key={i}>
                                  {number(m.value)}
                                  {m.status === 'partial' ? ' · parcial' : ''}
                                </td>
                              ),
                            )}
                            <td>
                              <button onClick={() => setEvidence(r)}>Ver datos</button>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted">
                {scale === 'week' ? 'Valores: previsto / realizado. ' : ''}— = sin dato o cálculo no
                disponible; 0 = cero informado. SI aproximado, no predicción de lesión.
              </p>
              {scale === 'session' && (
                <div className="session-observations">
                  {sessions.map((s) => (
                    <details key={s.sessionKey}>
                      <summary>
                        {s.date} · {s.exerciseName} · ver series
                      </summary>
                      <SessionSets s={s} exercise={exercise} variant={variant} />
                      <a
                        href={`#/athlete/${encodeURIComponent(id)}?${new URLSearchParams({ tab: 'registro', session: s.sessionKey, block: s.blockKey, week: String(s.weekNo), cutoff, from, to })}`}
                      >
                        Abrir registro →
                      </a>
                    </details>
                  ))}
                  {!sessions.length && (
                    <p className="muted">
                      Sin sesiones programadas en el período. Los registros importados siguen disponibles en
                      la evolución histórica.
                    </p>
                  )}
                </div>
              )}
            </article>
            <article className="essential-panel">
              <div className="row between">
                <h3>Volumen por grupo muscular</h3>
                <button
                  className="help-button"
                  aria-label="Explicar volumen muscular"
                  onClick={() => setHelp('muscle_sets_equivalent')}
                >
                  ?
                </button>
              </div>
              {scale === 'session' && core.error && (
                <p role="alert" className="message error">
                  No se pudo cargar el volumen por sesión. <button onClick={core.reload}>Reintentar</button>
                </p>
              )}
              <label>
                Grupo muscular
                <select value={activeMuscle ?? ''} onChange={(e) => setMuscle(e.target.value)}>
                  {groups.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <DoseChart
                metric="series equivalentes realizadas"
                rows={muscleRows
                  .filter((r) => r.muscle === activeMuscle)
                  .map((r) => ({
                    label: dateLabel(r.week.from) + r.sessionLabel,
                    planned: null,
                    actual: r.equivalentSets,
                  }))}
              />
              <details>
                <summary>Series directas e indirectas</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Directas</th>
                        <th>Indirectas</th>
                        <th>Equivalentes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {muscleRows
                        .filter((r) => r.muscle === activeMuscle)
                        .map((r, i) => (
                          <tr key={i}>
                            <td>
                              {r.week.from}
                              {r.sessionLabel}
                            </td>
                            <td>{number(r.directSets)}</td>
                            <td>{number(r.indirectSets)}</td>
                            <td>{number(r.equivalentSets)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <p className="small muted">
                  {d.muscles.convention.note} Directo × {d.muscles.convention.directWeight}, indirecto ×{' '}
                  {d.muscles.convention.indirectWeight}. No se suman grupos superpuestos.
                </p>
              </details>
              {d.muscles.warnings.map((x) => (
                <p className="small" key={x}>
                  {x}
                </p>
              ))}
              {d.muscles.unmappedExercises.length > 0 && (
                <p className="small">Sin mapeo muscular: {d.muscles.unmappedExercises.join(', ')}.</p>
              )}
              <p className="small muted">
                Volumen realizado de todos los ejercicios; no cambia al elegir movimiento.
              </p>
            </article>
            <article className="essential-panel performance-panel">
              <div className="row between">
                <h3>Fuerza · 1RM y e1RM</h3>
                <button
                  className="help-button"
                  aria-label="Explicar e1RM"
                  onClick={() => setHelp(method === 'table-rpe' ? 'e1rm_table_rpe' : 'e1rm_prg_formulas')}
                >
                  ?
                </button>
              </div>
              <div className="force-readings">
                <div>
                  <small>1RM registrado · mejor single hasta el corte</small>
                  <strong>{singles[0] ? number(singles[0].value) + ' kg' : 'Sin single registrado'}</strong>
                  {singles[0] && <span>{singles[0].date}</span>}
                </div>
                <div>
                  <small>Último e1RM del período · estimado</small>
                  <strong>{points.length ? number(points.at(-1)?.value) + ' kg' : 'Sin estimación'}</strong>
                  {points.length > 0 && <span>{points.at(-1)?.date}</span>}
                </div>
              </div>
              <div className="row">
                <button
                  className={strength === 'estimated' ? 'on' : ''}
                  onClick={() => setStrength('estimated')}
                >
                  e1RM estimado
                </button>
                <button className={strength === 'single' ? 'on' : ''} onClick={() => setStrength('single')}>
                  Singles realizados
                </button>
              </div>
              {strength === 'estimated' && (
                <label>
                  Método de e1RM
                  <select value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="table-rpe">Curva RPE · requiere RPE real</option>
                    <option value="prg-6-formulas">Promedio de 6 fórmulas PRG</option>
                  </select>
                </label>
              )}
              <Curve observations={strengthPoints} cutoff={to < cutoff ? to : cutoff} />
              <p className="small muted">
                {strength === 'estimated'
                  ? perf
                    ? `${perf.methodId} · ${perf.methodVersion}`
                    : 'Método sin datos'
                  : 'Cargas realizadas a una repetición'}{' '}
                · Un e1RM no es una marca real. Un single registrado no implica un test máximo validado.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha observada</th>
                      <th>{strength === 'estimated' ? 'e1RM · kg' : 'Single realizado · kg'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {strengthPoints.map((p, i) => (
                      <tr key={i}>
                        <td>{p.date}</td>
                        <td>{number(p.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>Referencias de fuerza utilizadas para prescribir</summary>
                {d.refs
                  .filter((r) => r.exerciseName === exercise && r.asOf <= cutoff)
                  .map((r, i) => (
                    <p key={i}>
                      {r.asOf} · {number(r.kg)} kg · {r.source}
                    </p>
                  ))}
                <p className="small muted">
                  Una referencia del coach o una estimación no se convierte en récord real.
                </p>
              </details>
            </article>
          </>
        )}
      </Async>
      {evidence !== null && (
        <Modal title="Datos y límites del cálculo" onClose={() => setEvidence(null)}>
          <Detail value={evidence} />
        </Modal>
      )}
      {help && (
        <Modal title="Qué indica esta métrica" onClose={() => setHelp(null)}>
          <Async state={catalog}>
            {(c) => (
              <Detail
                value={c.metrics.find((m) => m.id === help) ?? 'Definición no disponible en este catálogo'}
              />
            )}
          </Async>
        </Modal>
      )}
    </section>
  );
}
function SessionSets({ s, exercise, variant }: { s: SessionRow; exercise: string; variant: string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Serie</th>
            <th>Prescrito · reps × kg @RPE</th>
            <th>Realizado · reps × kg @RPE</th>
          </tr>
        </thead>
        <tbody>
          {s.sets
            .filter((x) => x.exerciseName === exercise && x.variantKey === variant)
            .map((x) => (
              <tr key={x.plannedSetId}>
                <td>
                  {x.isWarmup ? 'Aproximación' : x.setNo}
                  {x.retired ? ' · retirada' : ''}
                </td>
                <td>
                  {prescribedReps(x.planned.reps, x.protocol)} × {number(x.planned.kg)} @
                  {number(x.planned.targetRpe)}
                </td>
                <td>
                  {x.actual
                    ? `${number(x.actual.reps)} × ${number(x.actual.kg)} @${number(x.actual.rpe)}`
                    : 'Sin registro'}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export function EssentialAnalysis(props: EssentialProps) {
  const [detail, setDetail] = useState(false);
  return (
    <>
      <AnalysisOverview {...props} />
      <details className="exercise-analysis-detail" onToggle={(e) => setDetail(e.currentTarget.open)}>
        <summary>Detalle por ejercicio · prescripción, ejecución y datos del cálculo</summary>
        {detail && <DetailedAnalysis {...props} />}
      </details>
    </>
  );
}
