import { laboratory } from '../laboratory/environment';
import type { PerformanceData } from '@coaching/contracts';
import { get, query } from '../workspace/api';
import { pendingEvaluation } from '../laboratory/freshness';
import { useEffect, useState } from 'react';
import type { DecisionRow, Lift } from '@coaching/contracts';
import { api } from '../api/client';
import { useLoad } from '../hooks';
import { Async } from '../components/Async';
import { StatusBadge } from '../components/StatusBadge';
import { LIFT_NAMES } from '../labels';
import { workspaceApi as w } from '../workspace/api';
import { WeekOverview } from '../workspace/WeekOverview';
import { Programming } from '../workspace/Programming';
import { Analysis } from '../workspace/Analysis';
import { Registration } from '../workspace/Registration';
import { EvidenceDialog } from '../workspace/FollowUp';
import { Settings } from '../workspace/Settings';
import { AthleteAccess } from '../workspace/AthleteAccess';
import { DeleteAthleteDialog, EditAthleteDialog } from '../workspace/AthleteAdmin';
import { RecoveryTab } from './athlete/RecoveryTab';
import { SessionsTab } from './athlete/SessionsTab';
import { Empty, Message, readSearch, updateSearch, today, shift, number, dateLabel } from '../workspace/ui';
/** Programar y Analizar viven arriba (tarjetas de acción); acá solo lo que no está duplicado. */
const tabs = [
  ['resumen', 'Resumen'],
  ['config', 'Configuración'],
] as const;
const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

/** Atajos del período: bloques del macro (por fecha) o ventana reciente. Se pueden mezclar bloques cercanos para ver una transición. */
function periodPresets(
  mesos: { name: string; startDate: string | null; endDate: string | null }[],
  cutoff: string,
): { id: string; label: string; from: string; to: string }[] {
  const dated = mesos
    .filter((m): m is { name: string; startDate: string; endDate: string } => !!m.startDate && !!m.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const started = dated.filter((m) => m.startDate <= cutoff);
  const out: { id: string; label: string; from: string; to: string }[] = [];
  const last = started.at(-1);
  if (last)
    out.push({ id: 'b1', label: `Bloque actual · ${last.name}`, from: last.startDate, to: last.endDate });
  const two = started.slice(-2);
  if (two.length === 2)
    out.push({
      id: 'b2',
      label: `Últimos 2 bloques · ${two[0]!.name} + ${two[1]!.name}`,
      from: two[0]!.startDate,
      to: two[1]!.endDate,
    });
  const three = started.slice(-3);
  if (three.length === 3)
    out.push({ id: 'b3', label: 'Últimos 3 bloques', from: three[0]!.startDate, to: three[2]!.endDate });
  if (dated.length > 1)
    out.push({
      id: 'all',
      label: 'Macro completo',
      from: dated[0]!.startDate,
      to: dated.at(-1)!.endDate,
    });
  out.push({ id: '8w', label: 'Últimas 8 semanas', from: addDays(cutoff, -55), to: cutoff });
  return out;
}
export function AthletePage({ id }: { id: string }) {
  const [dialog, setDialog] = useState<'' | 'edit' | 'delete'>('');
  const [search, setSearch] = useState(readSearch);
  useEffect(() => {
    const on = () => setSearch(readSearch());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const tab = search.get('tab') ?? 'resumen';
  const macro = search.get('macro') ?? '';
  const block = search.get('block') ?? '';
  const week = Number(search.get('week') ?? 0);
  const session = search.get('session') ?? '';
  const data = useLoad(() => api.athlete(id), [id]);
  const cutoff = search.get('cutoff') ?? (laboratory ? data.data?.evaluation?.cutoff : undefined) ?? today();
  const from = search.get('from') ?? shift(cutoff, -55);
  const to = search.get('to') ?? cutoff;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [pending, setPending] = useState(() => pendingEvaluation(id));
  const [resultVersion, setResultVersion] = useState(0);
  useEffect(() => {
    const changed = () => setPending(pendingEvaluation(id));
    window.addEventListener('base-data-changed', changed);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('base-data-changed', changed);
      window.removeEventListener('storage', changed);
    };
  }, [id]);
  const [evidence, setEvidence] = useState<DecisionRow | null>(null);
  const [recovery, setRecovery] = useState(false);

  const context = useLoad(async () => {
    const [active, mesos, sessions, macros] = await Promise.all([
      w.active(id),
      w.mesos(id),
      api.sessions(id),
      w.macros(id),
    ]);
    return { active, mesos, sessions, macros };
  }, [id]);
  const performance = useLoad(
    () => get<PerformanceData>(id, 'performance' + query({ cutoff })),
    [id, cutoff],
  );
  const state = useLoad(() => w.state(id), [id]);
  useEffect(() => {
    const reload = () => {
      data.reload();
      state.reload();
    };
    window.addEventListener('focus', reload);
    window.addEventListener('base-data-changed', reload);
    return () => {
      window.removeEventListener('focus', reload);
      window.removeEventListener('base-data-changed', reload);
    };
  }, [id]);
  const refresh = () => {
    data.reload();
    state.reload();
    context.reload();
    performance.reload();
    setResultVersion((v) => v + 1);
  };
  const select = (v: Record<string, string | null>) => updateSearch(v);
  useEffect(() => {
    if (!context.data || search.has('context') || macro || block) return;
    const active = context.data.active;
    const blockKey =
      active?.mesos.find((m) => m.startDate <= cutoff && m.endDate >= cutoff)?.blockKey ??
      active?.activeMeso ??
      context.data.sessions[0]?.blockKey;
    const ss = context.data.sessions.filter((s) => s.blockKey === blockKey);
    const current =
      ss.filter((s) => s.date <= cutoff).sort((a, b) => b.date.localeCompare(a.date))[0] ?? ss.at(-1);
    select({
      context: '1',
      macro: active?.id ?? null,
      block: blockKey ?? null,
      week: current ? String(current.weekNo) : null,
    });
  }, [context.data, cutoff]);
  const activeName = context.data?.active?.id === macro ? context.data.active.name : undefined;
  const meso = context.data?.mesos.find((m) => m.blockKey === block);
  const effectiveMacro =
    activeName ??
    context.data?.macros.find((m) => m.id === macro)?.name ??
    (macro ? 'Macro seleccionado' : 'Sin macro');
  return (
    <Async state={data}>
      {(athlete) => (
        <section className={`athlete-page ${tab === 'registro' ? 'recording' : ''}`}>
          {dialog === 'edit' && (
            <EditAthleteDialog
              id={id}
              name={athlete.name}
              competition={athlete.competitionExercises}
              onClose={() => setDialog('')}
              onSaved={refresh}
            />
          )}
          {dialog === 'delete' && (
            <DeleteAthleteDialog
              id={id}
              name={athlete.name}
              onClose={() => setDialog('')}
              onDeleted={() => {
                setDialog('');
                window.location.hash = '#/?focus=plantel';
              }}
            />
          )}
          <div className="row between">
            <a className="back-link" href="#/">
              ← Volver al plantel
            </a>
            <button onClick={() => select({ tab: tab === 'registro' ? 'resumen' : 'registro' })}>
              {tab === 'registro' ? 'Volver al coach' : 'Vista atleta · demo local ↗'}
            </button>
          </div>
          <div className="row between athlete-heading">
            <div className="row">
              <span className="avatar">
                {athlete.name
                  .split(' ')
                  .map((x) => x[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <div>
                <div className="eyebrow">PERFIL DEL ATLETA</div>
                <h1>{athlete.name}</h1>
                <p className="small muted">
                  {athlete.evaluation
                    ? `Evaluado al ${athlete.evaluation.cutoff} · ${athlete.evaluation.rulesVersion}`
                    : 'Sin evaluación disponible'}
                </p>
                <div className="row">
                  <button type="button" onClick={() => setDialog('edit')}>
                    Editar perfil
                  </button>
                  <button type="button" className="danger" onClick={() => setDialog('delete')}>
                    Eliminar atleta
                  </button>
                </div>
              </div>
            </div>
            <div className="row">
              <label>
                Fecha de análisis
                <input
                  type="date"
                  value={cutoff}
                  onChange={(e) =>
                    e.target.value &&
                    select({
                      cutoff: e.target.value,
                      to: e.target.value,
                      ...(from > e.target.value ? { from: shift(e.target.value, -55) } : {}),
                    })
                  }
                />
              </label>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await api.evaluate(id, cutoff || undefined);
                    refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Evaluando…' : 'Actualizar evaluación'}
              </button>
            </div>
          </div>
          <div className="athlete-actions" aria-label="Acciones del atleta">
            {[
              ['plan', 'PROGRAMAR', 'Distribución y protocolos'],
              ['analisis', 'ANALIZAR', 'Evolución y evidencia'],
            ].map(([key, label, hint]) => (
              <button
                key={key}
                className={tab === key ? 'selected' : ''}
                onClick={() => select({ tab: key ?? 'resumen' })}
              >
                <span>{label}</span>
                <small>{hint}</small>
                <b>↗</b>
              </button>
            ))}
          </div>
          <div className="context-strip">
            <button
              title="Historial de macros"
              onClick={() => select({ tab: 'plan', block: null, week: null, session: null, context: '1' })}
            >
              <small>MACRO ↗</small>
              <strong>{effectiveMacro}</strong>
            </button>
            <button onClick={() => select({ tab: 'plan', week: null, session: null, context: '1' })}>
              <small>MESO ↗</small>
              <strong>{meso?.name ?? (block || 'Sin meso')}</strong>
            </button>
            <button onClick={() => select({ tab: 'plan', session: null })}>
              <small>SEMANA ↗</small>
              <strong>{week ? `S${week}` : 'Sin selección'}</strong>
            </button>
            <div className="period-picker">
              <small>PERÍODO DE ANÁLISIS</small>
              <div className="row">
                <input
                  type="date"
                  aria-label="Período desde"
                  value={from}
                  max={to}
                  onChange={(e) => e.target.value && select({ from: e.target.value })}
                />
                <span aria-hidden>→</span>
                <input
                  type="date"
                  aria-label="Período hasta"
                  value={to}
                  min={from}
                  onChange={(e) => e.target.value && select({ to: e.target.value })}
                />
                <select
                  aria-label="Atajos de período"
                  value=""
                  onChange={(e) => {
                    const p = periodPresets(context.data?.mesos ?? [], cutoff).find(
                      (x) => x.id === e.target.value,
                    );
                    if (p) select({ from: p.from, to: p.to });
                  }}
                >
                  <option value="">Atajos…</option>
                  {periodPresets(context.data?.mesos ?? [], cutoff).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          {!!context.data?.active?.otherActiveMacros?.length && (
            <Message>
              Hay varios macros activos. La API seleccionó «{context.data.active.name}». Podés elegir otro
              desde el macro (arriba).
            </Message>
          )}
          {context.error && (
            <Message error>
              Contexto de programación: {context.error}
              <button onClick={context.reload}>Reintentar</button>
            </Message>
          )}
          {error && <Message error>{error}</Message>}
          {(state.data?.freshness?.inputsChangedSinceEvaluation ?? !!pending) ? (
            <Message>
              Datos guardados · evaluación pendiente de actualizar. Elegí la fecha y pulsá «Actualizar
              evaluación». Las conclusiones anteriores pueden estar desactualizadas.
            </Message>
          ) : (
            athlete.evaluation && (
              <p className="small muted" role="status">
                Evaluación guardada al {athlete.evaluation.cutoff}
                {athlete.evaluation.cutoff !== cutoff ? ' · La fecha seleccionada aún no fue evaluada.' : ''}
              </p>
            )
          )}
          {pending && state.data?.freshness?.inputsChangedSinceEvaluation === false && (
            <p role="status" className="small muted">
              Datos guardados. Las entradas de la evaluación al corte {state.data.freshness.evaluatedCutoff}{' '}
              no cambiaron. Para analizar registros posteriores, elegí otra fecha y actualizá.
            </p>
          )}
          {state.data?.freshness?.inputsChangedSinceEvaluation === null && (
            <p className="small muted">
              La evaluación guardada no tiene huella de vigencia. Actualizala para verificar cambios entre
              clientes.
            </p>
          )}
          {tab !== 'registro' && (
            <nav className="athlete-tabs" aria-label="Secciones del atleta">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  className={tab === key ? 'on' : ''}
                  aria-current={tab === key ? 'page' : undefined}
                  onClick={() => select({ tab: key })}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
          {tab === 'resumen' && (
            <>
              <section className="summary-cta">
                <div>
                  <h2>Resultado de los bloques</h2>
                  <p className="small muted">
                    NL, SI, tonelaje, e1RM, comparativas y detalle por semana están en un solo lugar:
                    Analizar.
                  </p>
                </div>
                <button className="primary" onClick={() => select({ tab: 'analisis' })}>
                  Ir a Analizar →
                </button>
              </section>
              <details className="coach-context" open>
                <summary>Estado del atleta, recomendaciones y semana actual</summary>
                <div className="section-heading row between">
                  <div>
                    <h2>Qué está pasando</h2>
                    <p className="small muted">Rendimiento y próximas decisiones</p>
                  </div>
                </div>
                {!athlete.evaluation && (
                  <Empty title="Todavía no hay conclusiones">
                    Actualizá la evaluación para consultar hallazgos y evidencia.
                  </Empty>
                )}
                <div className="lift-grid">
                  {(['SQ', 'BP', 'DL'] as Lift[]).map((l) => {
                    const lift = state.data?.lifts[l];
                    const last = performance.data?.[l]?.exposures.filter((e) => e.e !== null).at(-1);
                    const row =
                      athlete.decisions.find((d) => d.key === lift?.principal?.key) ??
                      athlete.decisions.find(
                        (d) => d.lift === l && d.isPrincipal && d.validity === 'vigente',
                      );
                    return (
                      <article className="lift-card" data-lift={l} key={l}>
                        <div className="row between">
                          <span className="lift-symbol">{l}</span>
                          <StatusBadge status={lift?.principal?.status ?? row?.status} />
                        </div>
                        <h3>{LIFT_NAMES[l]}</h3>
                        <div className="lift-reading">
                          <small>ÚLTIMO e1RM · CURVA RPE</small>
                          <strong className="lift-value">
                            {last ? number(last.e) + ' kg' : '—'}{' '}
                            <span>{last ? dateLabel(last.date) : 'Sin estimación'}</span>
                          </strong>
                        </div>
                        <p
                          className={
                            row?.status === 'revision_coach' ? 'brief-signal critical' : 'brief-signal'
                          }
                        >
                          {lift?.principal?.headline ??
                            row?.summary ??
                            'Completá los registros para analizar la evolución.'}
                        </p>
                        <details className="conclusion-detail" open={row?.status === 'revision_coach'}>
                          <summary>Qué pasa</summary>
                          <p className="principal-conclusion">
                            {lift?.principal?.headline ??
                              row?.summary ??
                              'Sin datos suficientes para una conclusión.'}
                          </p>
                          {row?.proposal && <p className="proposal">{row.proposal}</p>}
                        </details>
                        {row ? (
                          <button className="text-button" onClick={() => setEvidence(row)}>
                            Por qué · abrir evidencia →
                          </button>
                        ) : (
                          <p className="small muted">Evaluá o completá los registros.</p>
                        )}
                        <details>
                          <summary>Rendimiento, recuperación y respuesta</summary>
                          {lift?.dimensions.map((d) => (
                            <div key={d.id} className="dimension">
                              <strong>{d.id.replaceAll('_', ' ')}</strong>
                              <span className="chip">{d.status.replaceAll('_', ' ')}</span>
                              <p>{d.summary}</p>
                              {row && (
                                <button onClick={() => setEvidence(row)}>
                                  Evidencia de la conclusión principal
                                </button>
                              )}
                            </div>
                          ))}
                          {lift?.sequence.map((x, i) => (
                            <p className="small muted" key={i}>
                              {x}
                            </p>
                          ))}
                          {!lift && <p>Estado multidimensional no disponible.</p>}
                        </details>
                      </article>
                    );
                  })}
                </div>
                {state.error && <Message error>{state.error}</Message>}
                {state.data?.legacyEvaluation && (
                  <Message>
                    Resultado obsoleto: la evaluación requiere actualización con la versión actual del motor.
                  </Message>
                )}
                {!!state.data?.missingConfig.length && (
                  <details className="message">
                    <summary>
                      Interpretaciones limitadas · falta configuración ({state.data.missingConfig.length})
                    </summary>
                    {state.data.missingConfig.map((m, i) => (
                      <p key={i}>
                        {m.lift} · {m.label}. Interpretaciones suspendidas: {m.suspends.join(', ')}.
                      </p>
                    ))}
                    <button onClick={() => select({ tab: 'config' })}>Completar parámetros</button>
                  </details>
                )}
                <WeekOverview
                  sessions={
                    context.data?.sessions.filter((s) => s.blockKey === block && s.weekNo === week) ?? []
                  }
                  week={week}
                  onSelect={select}
                />
                <details className="recent-changes">
                  <summary>Cambios recientes del plan</summary>
                  <RecentChanges id={id} />
                </details>
              </details>
              <details className="card" open={recovery}>
                <summary
                  onClick={(e) => {
                    e.preventDefault();
                    setRecovery(!recovery);
                  }}
                >
                  Recuperación y revisión técnica
                </summary>
                {recovery && (
                  <>
                    <RecoveryTab id={id} />
                    <SessionsTab id={id} onChanged={refresh} />
                  </>
                )}
              </details>
            </>
          )}
          {tab === 'plan' && (
            <Programming
              id={id}
              macro={macro}
              block={block}
              week={week}
              session={session}
              onSelect={select}
              onChanged={refresh}
            />
          )}
          {tab === 'analisis' && (
            <Analysis
              key={resultVersion + cutoff}
              cutoff={cutoff}
              id={id}
              from={from}
              to={to}
              onPeriod={(f, t) => select({ from: f, to: t })}
            />
          )}
          {tab === 'config' && (
            <>
              <Settings id={id} athlete={athlete} onChanged={refresh} />
              <section className="card" id="acceso-atleta">
                <h2>Acceso del atleta</h2>
                <AthleteAccess id={id} />
              </section>
            </>
          )}
          {tab === 'registro' && (
            <Registration id={id} session={session} onSelect={select} onChanged={refresh} />
          )}
          {evidence && <EvidenceDialog id={id} row={evidence} onClose={() => setEvidence(null)} />}
        </section>
      )}
    </Async>
  );
}

function RecentChanges({ id }: { id: string }) {
  const h = useLoad(() => api.history(id), [id]);
  return (
    <Async state={h}>
      {(d) => (
        <>
          {d.events
            .slice(-3)
            .reverse()
            .map((x) => (
              <div className="timeline-entry" key={x.event.id}>
                <time>{x.event.detectedOn}</time>
                <span>{x.event.changes.map((c) => c.summary).join(' · ') || 'Cambio de programación'}</span>
              </div>
            ))}
          {!d.events.length && <p className="muted">Todavía no hay cambios registrados.</p>}
        </>
      )}
    </Async>
  );
}
