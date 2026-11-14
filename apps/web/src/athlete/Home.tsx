import { useEffect, useState } from 'react';
import { useLive } from './live';
import { api, type Home as HomeData, type SessionMeta } from './api';

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(d + 'T12:00:00Z'));
const short = (d: string | null) =>
  d
    ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', timeZone: 'UTC' })
        .format(new Date(d + 'T12:00:00Z'))
        .replace('.', '')
    : '—';
const weeksBetween = (a: string | null, b: string | null) =>
  a && b ? Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / (7 * 86400000))) : null;

function SessionCard({
  s,
  label,
  cta,
  go,
}: {
  s: SessionMeta;
  label: string;
  cta: string;
  go: (k: string) => void;
}) {
  return (
    <section className="ath-card ath-session">
      <span className="ath-tag">{label}</span>
      {s.finished && <span className="ath-tag ok"> ✓ Terminado</span>}
      <h2>{s.title}</h2>
      <p className="muted">
        {fmtDate(s.date)} · Semana {s.weekNo} · {s.exercises.length} ejercicios
      </p>
      <ul className="ath-ex">
        {s.exercises.slice(0, 6).map((n) => (
          <li key={n}>{n}</li>
        ))}
        {s.exercises.length > 6 && <li className="muted">+{s.exercises.length - 6} más</li>}
      </ul>
      {s.status !== 'none' && (
        <div className="ath-progress" aria-label="Avance">
          <span style={{ width: `${(s.doneSets / Math.max(1, s.totalSets)) * 100}%` }} />
        </div>
      )}
      <button className="ath-primary" onClick={() => go(s.key)}>
        {s.status === 'done' ? 'Ver entrenamiento' : s.status === 'part' ? 'Continuar' : cta}
      </button>
    </section>
  );
}

const TRAC: {
  k: 'sleep' | 'energy' | 'motivation' | 'stress' | 'pain';
  n: string;
  lo: string;
  hi: string;
}[] = [
  { k: 'sleep', n: 'Sueño', lo: 'Mal', hi: 'Muy bien' },
  { k: 'energy', n: 'Energía', lo: 'Baja', hi: 'Alta' },
  { k: 'motivation', n: 'Ganas de entrenar', lo: 'Pocas', hi: 'Muchas' },
  { k: 'stress', n: 'Estrés', lo: 'Bajo', hi: 'Alto' },
  { k: 'pain', n: 'Molestias', lo: 'Ninguna', hi: 'Muchas' },
];

function Trac({ home, onSaved }: { home: HomeData; onSaved: () => void }) {
  const t = home.trac.today;
  const [v, setV] = useState({
    sleep: t?.sleep ?? 7,
    energy: t?.energy ?? 7,
    motivation: t?.motivation ?? 7,
    stress: t?.stress ?? 4,
    pain: t?.pain ?? 1,
  });
  const [more, setMore] = useState({
    soreness: '',
    confidence: '',
    sleepHours: '',
    bodyweightKg: '',
    note: '',
  });
  const num = (x: string) =>
    x.trim() === '' || !Number.isFinite(Number(x.replace(',', '.'))) ? null : Number(x.replace(',', '.'));
  const [edit, setEdit] = useState(!home.trac.doneToday);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const avg =
    Math.round(((v.sleep + v.energy + v.motivation + (11 - v.stress) + (11 - v.pain)) / 5) * 10) / 10;
  return (
    <section className="ath-card">
      <div className="ath-row">
        <h2>¿Cómo llegás hoy?</h2>
        <span className="ath-tag">TRAC</span>
      </div>
      {!edit ? (
        <>
          <p className="muted">
            Ya lo cargaste hoy. Predisposición: <strong>{avg}</strong>/10
          </p>
          <button className="ath-ghost" onClick={() => setEdit(true)}>
            Editar
          </button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await api.checkin({
                ...v,
                soreness: num(more.soreness),
                confidence: num(more.confidence),
                sleepHours: num(more.sleepHours),
                bodyweightKg: num(more.bodyweightKg),
                note: more.note.trim() || undefined,
              });
              setEdit(false);
              onSaved();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {TRAC.map((q) => (
            <label key={q.k} className="ath-slider">
              <span>
                {q.n} <b>{v[q.k]}</b>
              </span>
              <input
                type="range"
                min={1}
                max={10}
                value={v[q.k]}
                onChange={(e) => setV({ ...v, [q.k]: Number(e.target.value) })}
              />
              <small>
                <span>{q.lo}</span>
                <span>{q.hi}</span>
              </small>
            </label>
          ))}
          <details>
            <summary>Más datos (opcional)</summary>
            <p className="small muted">
              No cambian la predisposición: son para que tu coach tenga más contexto.
            </p>
            <label>
              Dolor muscular (1 = nada, 10 = mucho)
              <input
                inputMode="numeric"
                value={more.soreness}
                onChange={(e) => setMore({ ...more, soreness: e.target.value })}
              />
            </label>
            <label>
              Confianza para entrenar hoy (1–10)
              <input
                inputMode="numeric"
                value={more.confidence}
                onChange={(e) => setMore({ ...more, confidence: e.target.value })}
              />
            </label>
            <label>
              Horas dormidas
              <input
                inputMode="decimal"
                value={more.sleepHours}
                onChange={(e) => setMore({ ...more, sleepHours: e.target.value })}
              />
            </label>
            <label>
              Peso corporal (kg)
              <input
                inputMode="decimal"
                value={more.bodyweightKg}
                onChange={(e) => setMore({ ...more, bodyweightKg: e.target.value })}
              />
            </label>
            <label>
              Nota para el coach
              <textarea
                maxLength={500}
                value={more.note}
                onChange={(e) => setMore({ ...more, note: e.target.value })}
              />
            </label>
          </details>
          <p className="muted">
            Predisposición estimada: <strong>{avg}</strong>/10
          </p>
          {error && <p className="ath-error">{error}</p>}
          <button className="ath-primary" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </form>
      )}
    </section>
  );
}

export function HomeScreen({ go }: { go: (hash: string) => void }) {
  const [home, setHome] = useState<HomeData | null>(null);
  const [error, setError] = useState('');
  const load = () =>
    api
      .home()
      .then(setHome)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  useLive(() => void load());
  if (error) return <p className="ath-error">{error}</p>;
  if (!home) return <p className="muted">Cargando…</p>;
  const b = home.block;
  const main = home.next ?? home.session;
  const open = (k: string) => go(`#/atleta/entreno/${encodeURIComponent(k)}`);
  return (
    <div className="ath-stack">
      <header className="ath-hello">
        <p className="muted">{fmtDate(home.today)}</p>
        <h1>Hola, {home.athlete.name.split(' ')[0]}</h1>
      </header>
      {main ? (
        <SessionCard
          s={main}
          label={
            main.date === home.today
              ? home.todaysCount > 1
                ? `HOY · ${home.todaysCount} sesiones`
                : 'ENTRENAMIENTO DE HOY'
              : main.date < home.today
                ? 'PENDIENTE DE ESTA SEMANA'
                : 'PRÓXIMO ENTRENAMIENTO'
          }
          cta="Empezar"
          go={open}
        />
      ) : (
        <section className="ath-card">
          <span className="ath-tag">HOY</span>
          <h2>No tenés entrenamientos pendientes</h2>
          <p className="muted">Si querés adelantar, elegí uno abajo.</p>
        </section>
      )}
      {home.session && home.session.key !== main?.key && (
        <SessionCard s={home.session} label="ENTRENAMIENTO DE HOY" cta="Ver" go={open} />
      )}
      {b && (
        <section className="ath-card">
          <div className="ath-row">
            <h2>{b.name}</h2>
            <span className="ath-tag">BLOQUE</span>
          </div>
          <dl className="ath-info">
            <div>
              <dt>Duración</dt>
              <dd>
                {b.weeks} {b.weeks === 1 ? 'semana' : 'semanas'}
                {weeksBetween(b.startDate, b.endDate) ? '' : ''}
              </dd>
            </div>
            <div>
              <dt>Fechas</dt>
              <dd>
                {short(b.startDate)} → {short(b.endDate)}
              </dd>
            </div>
            {b.currentWeek && (
              <div>
                <dt>Vas por</dt>
                <dd>
                  Semana {b.currentWeek} de {b.weeks}
                </dd>
              </div>
            )}
          </dl>
          {b.currentWeek && (
            <div className="ath-progress">
              <span style={{ width: `${(b.currentWeek / Math.max(1, b.weeks)) * 100}%` }} />
            </div>
          )}
          <p className="ath-objective">
            <strong>Objetivo:</strong> {b.objective ?? 'Tu coach todavía no lo definió.'}
          </p>
        </section>
      )}
      <Trac home={home} onSaved={() => void load()} />
      <button className="ath-ghost big" onClick={() => go('#/atleta/entrenos')}>
        Elegir otro entrenamiento
      </button>
    </div>
  );
}
