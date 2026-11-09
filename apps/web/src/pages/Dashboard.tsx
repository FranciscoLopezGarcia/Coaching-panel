import { laboratory, athleteName } from '../laboratory/environment';
import { Laboratory } from '../laboratory/Laboratory';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AthleteSummary, DashboardData, Lift } from '@coaching/contracts';
import { readSearch, updateSearch, Modal, Message } from '../workspace/ui';
import { workspaceApi } from '../workspace/api';
import { api, request } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { LIFT_NAMES, STATUS } from '../labels';

const LIFTS: Lift[] = ['SQ', 'BP', 'DL'];
const rosterSearch = () => {
  const p = readSearch();
  if (!p.size) {
    try {
      return new URLSearchParams(sessionStorage.getItem('base:roster-filters') ?? '');
    } catch {
      return p;
    }
  }
  return p;
};
const link = (id: string) => `#/athlete/${encodeURIComponent(id)}`;

export function Dashboard() {
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [rows, setRows] = useState<AthleteSummary[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(rosterSearch().get('q') ?? '');
  const [lift, setLift] = useState<'' | Lift>((rosterSearch().get('lift') ?? '') as '' | Lift);
  const [state, setState] = useState(rosterSearch().get('state') ?? '');
  const [focus, setFocus] = useState(rosterSearch().get('focus') ?? '');
  const [list, setList] = useState<{
    title: string;
    items: { id: string; name: string; detail: string }[];
  } | null>(null);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState('');
  const [contexts, setContexts] = useState<Record<string, { stage: string; competition: string }>>({});
  useEffect(() => {
    updateSearch({ q, lift, state, focus }, true);
    sessionStorage.setItem('base:roster-filters', readSearch().toString());
  }, [q, lift, state, focus]);

  useEffect(() => {
    const sync = () => {
      if (readSearch().get('focus') === 'plantel') {
        setFocus('plantel');
        requestAnimationFrame(() => document.getElementById('plantel')?.scrollIntoView({ block: 'start' }));
      }
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [rows]);

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([api.dashboard(), api.athletes()]);
      setDash(d);
      setRows(r);
      const results = await Promise.allSettled(
        r.map(async (a) => {
          const [active, mesos] = await Promise.all([workspaceApi.active(a.id), workspaceApi.mesos(a.id)]);
          return [
            a.id,
            {
              stage: active?.name ?? mesos[0]?.name ?? 'Sin programación',
              competition: d.competitions.find((c) => c.athleteId === a.id)?.name ?? 'Sin competencia',
            },
          ] as const;
        }),
      );
      setContexts(Object.fromEntries(results.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []))));
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
      for (const a of rows ?? []) await api.evaluate(a.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(
    () =>
      (rows ?? []).filter((a) => {
        if (focus === 'review' && !dash?.priorities.some((p) => p.athleteId === a.id)) return false;
        if (focus === 'opportunities' && !dash?.opportunities.some((p) => p.athleteId === a.id)) return false;
        if (q && !a.name.toLowerCase().includes(q.toLowerCase())) return false;
        const lifts = lift ? [lift] : LIFTS;
        if (state && !lifts.some((l) => a.lifts[l]?.status === state)) return false;
        return true;
      }),
    [rows, q, lift, state, focus, dash],
  );

  if (error && !rows)
    return (
      <div className="message error" role="alert">
        No se pudo cargar: {error}. Comprobá la API local.{' '}
        <button onClick={() => void load()}>Reintentar</button>
      </div>
    );
  if (!rows || !dash) return <p className="muted">Cargando…</p>;
  const cards: [string, number, string][] = [
    ['Atletas activos', dash.cards.active, 'Todos los del plantel'],
    ['Requieren revisión', dash.cards.needReview, 'Revisión del coach o posible fin de respuesta'],
    ['Bloques por terminar', dash.cards.blocksEnding, 'Terminan en ≤ 14 días'],
    ['Check-ins pendientes', dash.cards.pendingCheckins, 'Sin check-in en los últimos 7 días'],
  ];
  return (
    <section>
      <div className="row between">
        <div>
          <div className="eyebrow">TU ESPACIO DE TRABAJO</div>
          <h1>
            Inicio del coach<span className="heading-dot">.</span>
          </h1>
          <p className="muted small">
            {new Intl.DateTimeFormat('es-AR', { dateStyle: 'full' }).format(
              new Date(dash.today + 'T12:00:00'),
            )}{' '}
            · Tu plantel, en foco.
          </p>
        </div>
        <button className="primary" onClick={() => setCreate(true)}>
          ＋ Nuevo atleta
        </button>
        <button onClick={evaluateAll} disabled={busy || !rows.length}>
          {busy ? 'Evaluando…' : 'Evaluar todos al día de hoy'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {laboratory && <Laboratory onCreate={() => setCreate(true)} />}
      <div className="cards">
        {cards.map(([t, n, h]) => (
          <button
            key={t}
            className="stat"
            title={h}
            disabled={busy}
            onClick={async () => {
              if (t === 'Atletas activos') {
                setFocus('');
                document.getElementById('plantel')?.scrollIntoView();
                return;
              }
              if (t === 'Requieren revisión') {
                setFocus('review');
                document.getElementById('plantel')?.scrollIntoView();
                return;
              }
              setBusy(true);
              try {
                const items = await Promise.all(
                  rows.map(async (a) => {
                    if (t === 'Check-ins pendientes') {
                      const c = await api.checkins(a.id);
                      return !c.some(
                        (x) =>
                          x.date >=
                            new Date(Date.parse(dash.today + 'T12:00:00Z') - 7 * 86400000)
                              .toISOString()
                              .slice(0, 10) && x.date <= dash.today,
                      )
                        ? { id: a.id, name: a.name, detail: 'Sin cuestionario vigente en los últimos 7 días' }
                        : null;
                    }
                    const detail = await api.athlete(a.id);
                    return (detail.evaluation?.blocks ?? [])
                      .filter(
                        (b) =>
                          !b.closed &&
                          b.endDate >= dash.today &&
                          b.endDate <=
                            new Date(Date.parse(dash.today + 'T12:00:00Z') + 14 * 86400000)
                              .toISOString()
                              .slice(0, 10),
                      )
                      .map((b) => ({
                        id: a.id,
                        name: a.name,
                        detail: `${b.blockKey} · ${b.lift} · ${b.endDate}`,
                      }));
                  }),
                );
                setList({
                  title: t,
                  items: items
                    .flat()
                    .filter((x): x is { id: string; name: string; detail: string } => !!x && !!x.detail),
                });
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="stat-n">{n}</div>
            <div className="small muted">
              {t} <span>↗</span>
            </div>
          </button>
        ))}
      </div>

      <div className="panels coach-panels">
        <Panel title="Prioridades">
          {dash.priorities.length ? (
            dash.priorities.map((p) => (
              <li key={p.athleteId + p.lift + p.status}>
                <a href={link(p.athleteId)}>{p.athleteName}</a> · {LIFT_NAMES[p.lift]}{' '}
                <StatusBadge status={p.status} />
                <div className="row queue-actions">
                  <a href={link(p.athleteId)}>Ver atleta →</a>
                  <a href={link(p.athleteId) + '?tab=plan'}>Abrir semana ↗</a>
                </div>
                <details>
                  <summary>Hallazgo · datos al {p.since}</summary>
                  <p>{p.summary}</p>
                </details>
              </li>
            ))
          ) : (
            <li className="muted">Nada que revisar con prioridad.</li>
          )}
        </Panel>
        <Panel title="Próximas competencias">
          {dash.competitions.length ? (
            dash.competitions.map((c) => (
              <li key={c.id}>
                <a href={link(c.athleteId)}>{c.athleteName}</a> · {c.name} · {c.date}{' '}
                <strong>({c.daysLeft} d)</strong>
                {c.phase ? ` · ${c.phase}` : ''}
              </li>
            ))
          ) : (
            <li className="muted">Sin competencias cargadas.</li>
          )}
        </Panel>
        <Panel title="Oportunidades (pendientes de revisión)">
          {dash.opportunities.length ? (
            dash.opportunities.map((o) => (
              <li key={o.athleteId + o.key}>
                <a href={link(o.athleteId)}>{o.athleteName}</a> · {LIFT_NAMES[o.lift]}{' '}
                <StatusBadge status={o.status} />
                <details>
                  <summary>Ver oportunidad</summary>
                  <p>{o.summary}</p>
                </details>
              </li>
            ))
          ) : (
            <li className="muted">Sin oportunidades pendientes.</li>
          )}
        </Panel>
        <Panel title="Actividad reciente">
          {dash.recent.length ? (
            dash.recent.map((r, i) => (
              <li key={i}>
                <span className="muted small">{r.date}</span> <a href={link(r.athleteId)}>{r.athleteName}</a>{' '}
                · {r.kind}
                <div className="small muted">{r.text}</div>
              </li>
            ))
          ) : (
            <li className="muted">Sin actividad.</li>
          )}
        </Panel>
      </div>

      <h2 id="plantel" className="spaced">
        Plantel <span className="chip">{filtered.length} atletas</span>
      </h2>
      <div className="row">
        <button className={!focus ? 'on' : ''} onClick={() => setFocus('')}>
          Todos
        </button>
        <button className={focus === 'review' ? 'on' : ''} onClick={() => setFocus('review')}>
          Revisión
        </button>
        <button className={focus === 'opportunities' ? 'on' : ''} onClick={() => setFocus('opportunities')}>
          Oportunidades
        </button>
      </div>
      <div className="row">
        <input
          placeholder="Buscar atleta"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar atleta"
        />
        <select value={lift} onChange={(e) => setLift(e.target.value as '' | Lift)} aria-label="Lift">
          <option value="">Todos los lifts</option>
          {LIFTS.map((l) => (
            <option key={l} value={l}>
              {LIFT_NAMES[l]}
            </option>
          ))}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label="Estado">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      {!rows.length && (
        <p className="muted">
          Sin atletas. Cargá datos sintéticos con <code>npm run seed</code>.
        </p>
      )}
      <div className="roster">
        {filtered.map((a) => (
          <article className="athlete-card" key={a.id}>
            <div className="ac-head">
              <span className="ac-avatar">
                {a.name
                  .split(' ')
                  .map((x) => x[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <div>
                <a className="ac-name" href={link(a.id)}>
                  {a.name}
                </a>
                <div className="ac-sub">
                  {contexts[a.id]?.stage ?? 'Sin información'}
                  {contexts[a.id]?.competition ? ` · ${contexts[a.id]?.competition}` : ''}
                </div>
              </div>
              {a.pendingDecisions > 0 && <span className="ac-pending">{a.pendingDecisions} por revisar</span>}
            </div>
            <div className="ac-lifts">
              {LIFTS.map((l) => {
                const p = a.lifts[l];
                return (
                  <div className="ac-lift" data-lift={l} key={l} title={p?.summary ?? 'Sin evaluar'}>
                    <b>{LIFT_NAMES[l]}</b>
                    <StatusBadge status={p?.status} />
                    {p && <small>datos hasta {p.dataUntil || '—'}</small>}
                  </div>
                );
              })}
            </div>
            <div className="ac-meta">
              <div>
                <span>Último registro</span>
                <strong>{a.lastRecord ?? 'sin registros'}</strong>
              </div>
              <div>
                <span>Evaluado al</span>
                <strong>{a.evaluatedOn ?? 'sin evaluar'}</strong>
              </div>
            </div>
            <div className="ac-actions">
              <a href={link(a.id)}>Perfil</a>
              <a href={link(a.id) + '?tab=plan'}>Semana ↗</a>
            </div>
          </article>
        ))}
      </div>
      {!filtered.length && !!rows.length && (
        <Message>No hay atletas para estos filtros. Cambiá la búsqueda o elegí Todos.</Message>
      )}
      {list && (
        <Modal title={list.title} onClose={() => setList(null)}>
          {list.items.length ? (
            list.items.map((x) => (
              <article className="card" key={x.id + x.detail}>
                <a href={link(x.id)}>{x.name} →</a>
                <p>{x.detail}</p>
              </article>
            ))
          ) : (
            <p>No hay elementos que listar con los datos detallados disponibles.</p>
          )}
        </Modal>
      )}
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      <ul>{children}</ul>
    </div>
  );
}
