import { useEffect, useMemo, useState } from 'react';
import { useLive } from './live';
import { api, type PlanData, type SessionMeta } from './api';

const short = (d: string) =>
  new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })
    .format(new Date(d + 'T12:00:00Z'))
    .replace('.', '');
const dot = (s: SessionMeta) => (s.status === 'done' ? '✓' : s.status === 'part' ? '◐' : '○');

/** Bloque → semana → sesión con menús desplegables, un botón «siguiente entrenamiento» y atajos dentro de la misma semana. */
export function Picker({ go }: { go: (hash: string) => void }) {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [error, setError] = useState('');
  const [block, setBlock] = useState('');
  const [week, setWeek] = useState(0);
  const [session, setSession] = useState('');
  useEffect(() => {
    api
      .plan()
      .then((p) => {
        setPlan(p);
        const n = p.next ?? p.blocks[0]?.weeksList[0]?.sessions[0] ?? null;
        if (n) {
          setBlock(n.blockKey);
          setWeek(n.weekNo);
          setSession(n.key);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useLive(
    () =>
      void api
        .plan()
        .then(setPlan)
        .catch(() => undefined),
  );
  const b = useMemo(() => plan?.blocks.find((x) => x.key === block), [plan, block]);
  const w = b?.weeksList.find((x) => x.weekNo === week);
  if (error) return <p className="ath-error">{error}</p>;
  if (!plan) return <p className="muted">Cargando…</p>;
  const open = (k: string) => go(`#/atleta/entreno/${encodeURIComponent(k)}`);
  return (
    <div className="ath-stack">
      <h1>Mis entrenamientos</h1>
      {plan.next && (
        <button className="ath-next" onClick={() => open(plan.next!.key)}>
          <span className="ath-tag">SIGUIENTE ENTRENAMIENTO</span>
          <strong>{plan.next.title}</strong>
          <span className="muted">
            {short(plan.next.date)} · {plan.blocks.find((x) => x.key === plan.next!.blockKey)?.name} · Semana{' '}
            {plan.next.weekNo}
          </span>
          <b>Empezar →</b>
        </button>
      )}
      <section className="ath-card">
        <h2>Elegir entrenamiento</h2>
        <label>
          Bloque
          <select
            value={block}
            onChange={(e) => {
              const nb = plan.blocks.find((x) => x.key === e.target.value);
              const nw = nb?.weeksList[0];
              setBlock(e.target.value);
              setWeek(nw?.weekNo ?? 0);
              setSession(nw?.sessions[0]?.key ?? '');
            }}
          >
            {plan.blocks.map((x) => (
              <option key={x.key} value={x.key}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Semana
          <select
            value={week}
            onChange={(e) => {
              const n = Number(e.target.value);
              setWeek(n);
              setSession(b?.weeksList.find((x) => x.weekNo === n)?.sessions[0]?.key ?? '');
            }}
          >
            {b?.weeksList.map((x) => (
              <option key={x.weekNo} value={x.weekNo}>
                Semana {x.weekNo} ·{' '}
                {x.sessions.every((s) => s.status === 'done')
                  ? 'completa'
                  : `${x.sessions.filter((s) => s.status === 'done').length}/${x.sessions.length} hechas`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sesión
          <select value={session} onChange={(e) => setSession(e.target.value)}>
            {w?.sessions.map((s, i) => (
              <option key={s.key} value={s.key}>
                {dot(s)} Sesión {i + 1} · {short(s.date)} · {s.title}
              </option>
            ))}
          </select>
        </label>
        <button className="ath-primary" disabled={!session} onClick={() => open(session)}>
          Abrir entrenamiento
        </button>
      </section>
      {w && (
        <section className="ath-card">
          <h2>
            Esta semana · {b?.name} · S{w.weekNo}
          </h2>
          <div className="ath-chips">
            {w.sessions.map((s, i) => (
              <button
                key={s.key}
                className={`ath-chip ${s.key === session ? 'on' : ''} ${s.status}`}
                onClick={() => open(s.key)}
              >
                <b>Sesión {i + 1}</b>
                <span>{short(s.date)}</span>
                <small>
                  {dot(s)} {s.title}
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
