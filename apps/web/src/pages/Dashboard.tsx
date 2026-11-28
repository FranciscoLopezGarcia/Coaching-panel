import './dashboard.css';
import { laboratory, athleteName } from '../laboratory/environment';
import { Laboratory } from '../laboratory/Laboratory';
import { useCallback, useEffect, useState } from 'react';
import type { AgendaData, AthleteSummary, DashboardData, Lift } from '@coaching/contracts';
import { readSearch, updateSearch, Modal, Message, dateLabel, shift } from '../workspace/ui';
import { api, request } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { LIFT_NAMES } from '../labels';
import { STATUS_LABEL } from '../workspace/AgendaCard';

const LIFTS: Lift[] = ['SQ', 'BP', 'DL'];
type Today = AgendaData & { athleteId: string };
type Plan = DashboardData['planning'][number];
const link = (id: string) => `#/athlete/${encodeURIComponent(id)}`;
const KIND = { sesion: 'Sesión', cambio: 'Cambio de plan', evaluacion: 'Evaluación' };
const saved = () => {
  const p = readSearch();
  if (p.size) return p;
  try {
    return new URLSearchParams(sessionStorage.getItem('base:roster-filters') ?? '');
  } catch {
    return p;
  }
};
const missing = (r: Plan) =>
  r.hasCurrent ? 'Falta la que viene' : r.plannedUntil ? 'Sin esta ni la que viene' : 'Sin plan cargado';
/** Primero lo urgente: sin nada, después sin la semana que viene; entre los listos, los que terminan bloque. */
const urgency = (r: Plan) => (r.hasNext ? (r.endingBlocks.length ? 2 : 3) : !r.hasCurrent ? 0 : 1);

/** Inicio: una sola tabla del plantel. Los números de arriba son los filtros de esa misma tabla. */
export function Dashboard() {
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [rows, setRows] = useState<AthleteSummary[]>([]);
  const [todays, setTodays] = useState<Today[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(saved().get('q') ?? '');
  const [focus, setFocus] = useState(saved().get('focus') ?? '');
  const [create, setCreate] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => {
    updateSearch({ q, focus }, true);
    sessionStorage.setItem('base:roster-filters', readSearch().toString());
  }, [q, focus]);

  const load = useCallback(async () => {
    try {
      const [d, r, t] = await Promise.all([api.dashboard(), api.athletes(), request<Today[]>('/api/today')]);
      setDash(d);
      setRows(r);
      setTodays(t);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const evaluateAll = async () => {
    setBusy(true);
    try {
      for (const a of rows) await api.evaluate(a.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !dash)
    return (
      <div className="message error" role="alert">
        No se pudo cargar: {error}. Comprobá la API. <button onClick={() => void load()}>Reintentar</button>
      </div>
    );
  if (!dash) return <p className="muted">Cargando…</p>;

  const alerts = (id: string) => dash.priorities.filter((p) => p.athleteId === id);
  const chances = (id: string) => dash.opportunities.filter((p) => p.athleteId === id);
  const filters: { key: string; label: string; test: (r: Plan) => boolean }[] = [
    { key: '', label: 'Todos', test: () => true },
    { key: 'unplanned', label: 'Sin planificar', test: (r) => !r.hasNext },
    { key: 'ending', label: 'Terminan bloque', test: (r) => r.endingBlocks.length > 0 },
    { key: 'review', label: 'Para revisar', test: (r) => alerts(r.athleteId).length > 0 },
    { key: 'checkin', label: 'Sin check-in en 7 días', test: (r) => r.checkInPending },
    { key: 'opportunities', label: 'Con oportunidades', test: (r) => chances(r.athleteId).length > 0 },
  ];
  const active = filters.find((f) => f.key === focus) ?? filters[0]!;
  const shown = dash.planning
    .filter((r) => active.test(r) && r.athleteName.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => urgency(a) - urgency(b) || a.athleteName.localeCompare(b.athleteName, 'es'));
  const nextMonday = shift(dash.today, 7 - ((new Date(`${dash.today}T12:00:00Z`).getUTCDay() + 6) % 7));

  return (
    <section className="home">
      <div className="row between">
        <div>
          <h1>Inicio</h1>
          <p className="muted small">
            {new Intl.DateTimeFormat('es-AR', { dateStyle: 'full' }).format(
              new Date(dash.today + 'T12:00:00'),
            )}
          </p>
        </div>
        <div className="row">
          <button className="primary" onClick={() => setCreate(true)}>
            Nuevo atleta
          </button>
          <button onClick={evaluateAll} disabled={busy || !rows.length}>
            {busy ? 'Evaluando…' : 'Evaluar todos al día de hoy'}
          </button>
        </div>
      </div>
      {error && <Message error>{error}</Message>}

      {laboratory && <Laboratory onCreate={() => setCreate(true)} />}
      <div className="home-filters" role="group" aria-label="Filtrar el plantel">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={active.key === f.key}
            onClick={() => setFocus(f.key)}
          >
            <b>{dash.planning.filter(f.test).length}</b> {f.label}
          </button>
        ))}
        <input
          type="search"
          placeholder="Buscar atleta"
          aria-label="Buscar atleta"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="roster-table" role="table" aria-label="Plantel">
        <div className="roster-row roster-head" role="row">
          <span role="columnheader">Atleta</span>
          <span role="columnheader">Semana del {dateLabel(nextMonday)}</span>
          <span role="columnheader">Hoy</span>
          <span role="columnheader">Check-in</span>
          <span role="columnheader">Para revisar</span>
          <span role="columnheader">Competencia</span>
        </div>
        {shown.map((r) => {
          const a = rows.find((x) => x.id === r.athleteId);
          const t = todays.find((x) => x.athleteId === r.athleteId);
          const hoy = t?.sessions.filter((s) => s.date === t.today) ?? [];
          const done = t?.sessions.filter((s) => s.status === 'hecha').length ?? 0;
          const comp = dash.competitions.find((c) => c.athleteId === r.athleteId);
          const review = alerts(r.athleteId);
          const open = chances(r.athleteId);
          return (
            <div className="roster-row" role="row" key={r.athleteId}>
              <div role="cell">
                <a className="roster-name" href={link(r.athleteId)}>
                  {r.athleteName}
                </a>
                <small>{r.currentBlock ?? 'Sin programación'}</small>
              </div>
              <div role="cell" data-label={`Semana del ${dateLabel(nextMonday)}`}>
                <a className="plan-cell" href={`${link(r.athleteId)}?tab=plan`}>
                  <span className={`plan-light ${r.hasNext ? 'ok' : 'bad'}`} aria-hidden="true">
                    {r.hasNext ? '✓' : '✕'}
                  </span>
                  {r.hasNext ? 'Planificada' : missing(r)}
                </a>
                {r.hasNext && !r.hasCurrent && <small>Esta semana sin sesiones</small>}
                {!r.hasNext && !r.hasCurrent && r.plannedUntil && (
                  <small>Último día cargado {dateLabel(r.plannedUntil)}</small>
                )}
                {r.endingBlocks.map((b) => (
                  <span className="plan-ending" key={b.blockKey}>
                    <span aria-hidden="true">!</span> Termina {b.name} · {dateLabel(b.endDate)}
                  </span>
                ))}
              </div>
              <div role="cell" data-label="Hoy">
                {hoy.length
                  ? hoy.map((s) => (
                      <span key={s.sessionKey}>
                        {s.exercises[0] ?? 'Sesión'}: {STATUS_LABEL[s.status].toLowerCase()}
                      </span>
                    ))
                  : 'Sin sesión'}
                {!!t?.sessions.length && (
                  <small>
                    Semana: {done} de {t.sessions.length} hechas
                  </small>
                )}
              </div>
              <div role="cell" data-label="Check-in">
                <span className={r.checkInPending ? 'warn-text' : ''}>
                  {r.checkInPending ? 'Pendiente' : 'Al día'}
                </span>
                <small>{r.lastCheckIn ? `Último ${dateLabel(r.lastCheckIn)}` : 'Nunca cargó'}</small>
                {!!t?.painSets7d.count && <small>Series con molestia (7 d): {t.painSets7d.count}</small>}
              </div>
              <div role="cell" data-label="Para revisar">
                {review.map((p) => (
                  <span className="roster-alert" key={p.lift + p.status}>
                    {LIFT_NAMES[p.lift]} <StatusBadge status={p.status} />
                  </span>
                ))}
                {!review.length && <span className="muted">Sin alertas</span>}
                <details>
                  <summary>
                    {open.length
                      ? `${open.length} ${open.length === 1 ? 'oportunidad' : 'oportunidades'} · detalle`
                      : 'Detalle'}
                  </summary>
                  {[...review, ...open].map((p) => (
                    <p key={p.lift + p.status}>
                      <b>{LIFT_NAMES[p.lift]}:</b> {p.summary}
                    </p>
                  ))}
                  {LIFTS.map((l) => (
                    <p className="roster-alert" key={l}>
                      {LIFT_NAMES[l]} <StatusBadge status={a?.lifts[l]?.status} />
                    </p>
                  ))}
                  <p className="muted">
                    Decisiones pendientes: {a?.pendingDecisions ?? 0}. Último registro:{' '}
                    {a?.lastRecord ? dateLabel(a.lastRecord) : 'sin registros'}. Evaluado:{' '}
                    {a?.evaluatedOn ? dateLabel(a.evaluatedOn) : 'sin evaluar'}.
                  </p>
                </details>
              </div>
              <div role="cell" data-label="Competencia">
                {comp ? (
                  <>
                    {comp.name}
                    <small>
                      {dateLabel(comp.date)} · en {comp.daysLeft} d
                    </small>
                  </>
                ) : (
                  <span className="muted">Sin fecha</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!dash.planning.length && <p className="muted">Todavía no hay atletas.</p>}
      {!shown.length && !!dash.planning.length && (
        <Message>No hay atletas para este filtro. Cambiá la búsqueda o elegí Todos.</Message>
      )}

      <details className="home-recent">
        <summary>Actividad reciente</summary>
        <ul>
          {dash.recent.map((r, i) => (
            <li key={i}>
              <span className="muted">{dateLabel(r.date)}</span>{' '}
              <a href={link(r.athleteId)}>{r.athleteName}</a> · {KIND[r.kind]}
              <div className="small muted">{r.text}</div>
            </li>
          ))}
          {!dash.recent.length && <li className="muted">Sin actividad.</li>}
        </ul>
      </details>
      {create && (
        <Modal title="Nuevo atleta" onClose={() => setCreate(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              try {
                const a = await request<{ id: string }>('/api/athletes', {
                  method: 'POST',
                  body: JSON.stringify({ name: athleteName(name) }),
                });
                window.location.hash = link(a.id);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Nombre
              <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="primary" disabled={busy}>
              Crear atleta
            </button>
            {error && <Message error>{error}</Message>}
          </form>
        </Modal>
      )}
    </section>
  );
}
