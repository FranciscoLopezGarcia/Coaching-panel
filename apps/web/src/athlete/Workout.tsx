import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api, flushOutbox, pendingCount, type SessionData, type SetView } from './api';
import { useLive } from './live';

type Vals = Record<string, { kg: string; reps: string; rpe: string; done: boolean }>;
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const fmtKg = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));
const short = (d: string) =>
  new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(d + 'T12:00:00Z'));

const KIND: Record<SetView['kind'], { label: string; hint: string }> = {
  warmup: { label: 'A', hint: 'Calentamiento / aproximación' },
  top: { label: 'TOP', hint: 'Top set' },
  backoff: { label: 'B', hint: 'Backoff' },
  work: { label: '', hint: 'Serie efectiva' },
};

function initVals(s: SessionData): Vals {
  const v: Vals = {};
  for (const e of s.exercises)
    for (const x of e.sets)
      v[x.id] = {
        kg: fmtKg(x.actual?.kg ?? null),
        reps: x.actual?.reps != null ? String(x.actual.reps) : '',
        rpe: x.actual?.rpe != null ? String(x.actual.rpe).replace('.', ',') : '',
        done: x.actual?.status === 'done',
      };
  return v;
}

/** Pantalla de entreno al estilo Hevy: tarjeta por ejercicio, tabla de series con anterior / kg / reps / RPE y un tilde por serie. */
export function Workout({ keyName, go }: { keyName: string; go: (hash: string) => void }) {
  const [data, setData] = useState<SessionData | null>(null);
  const [vals, setVals] = useState<Vals>({});
  const [error, setError] = useState('');
  const [finish, setFinish] = useState(false);
  const [saved, setSaved] = useState(false);
  const [closing, setClosing] = useState(false);
  const [finishError, setFinishError] = useState('');
  const finishRef = useRef<HTMLElement | null>(null);
  const [fatigue, setFatigue] = useState(6);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState('');
  const t0 = useRef(Date.now());
  const [secs, setSecs] = useState(0);
  const touched = useRef(new Set<string>()); // series que el atleta tocó y aún no están confirmadas por el servidor
  const [pending, setPending] = useState(0);
  const [rest, setRest] = useState<{ until: number; total: number; name: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [updated, setUpdated] = useState(false);
  const load = (first: boolean) =>
    api
      .session(keyName)
      .then((d) => {
        setData(d);
        // lo que el atleta está escribiendo NO se pisa; el resto se alinea con el servidor
        setVals((old) => {
          const fresh = initVals(d);
          for (const id of touched.current) if (old[id] && fresh[id]) fresh[id] = old[id];
          return fresh;
        });
        if (first && d.endFatigue) setFatigue(d.endFatigue);
        if (first && d.endNote) setNote(d.endNote);
        setError('');
      })
      .catch((e: Error) => {
        if (first) setError(e.message);
      });
  useEffect(() => {
    void load(true);
  }, [keyName]);
  const live = useLive(() => {
    setUpdated(true);
    void load(false);
  });
  useEffect(() => {
    if (!updated) return;
    const t = setTimeout(() => setUpdated(false), 3500);
    return () => clearTimeout(t);
  }, [updated]);
  // reenvío de lo que no pudo salir (sin señal): al volver la red y cada pocos segundos
  useEffect(() => {
    const go = () =>
      void flushOutbox().then((r) => {
        setPending(r.left);
        if (!r.left) touched.current.clear();
      });
    setPending(pendingCount());
    go();
    const i = setInterval(() => pendingCount() && go(), 3000);
    window.addEventListener('online', go);
    return () => {
      clearInterval(i);
      window.removeEventListener('online', go);
    };
  }, []);
  useEffect(() => {
    if (!rest) return;
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, [rest]);
  useEffect(() => {
    const i = setInterval(() => setSecs(Math.floor((Date.now() - t0.current) / 1000)), 1000);
    return () => clearInterval(i);
  }, []);
  const all = useMemo(() => data?.exercises.flatMap((e) => e.sets) ?? [], [data]);
  const done = all.filter((s) => vals[s.id]?.done).length;
  if (error && !data) return <p className="ath-error">{error}</p>;
  if (!data) return <p className="muted">Cargando…</p>;
  const save = async (s: SetView, v: Vals[string]) => {
    setSaving(s.id);
    touched.current.add(s.id);
    try {
      const r = await api.logSet({
        plannedSetId: s.id,
        status: v.done ? 'done' : 'pending',
        kg: num(v.kg),
        reps: num(v.reps),
        rpe: num(v.rpe),
      });
      setPending(pendingCount());
      if (!r.queued) touched.current.delete(s.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('');
    }
  };
  const toggle = (s: SetView) => {
    const cur = vals[s.id] as Vals[string];
    // al marcar con campos vacíos, se completa con lo previsto (como en Hevy)
    const next = cur.done
      ? { ...cur, done: false }
      : {
          kg: cur.kg || fmtKg(s.goal?.kg ?? s.kg),
          reps: cur.reps || String(s.goal?.reps ?? s.reps),
          rpe: cur.rpe,
          done: true,
        };
    setVals({ ...vals, [s.id]: next });
    void save(s, next);
    // descanso previsto por el coach para este ejercicio: arranca al marcar la serie
    if (!cur.done && s.pauseSec) {
      const ex = data.exercises.find((e) => e.sets.some((x) => x.id === s.id));
      setRest({ until: Date.now() + s.pauseSec * 1000, total: s.pauseSec, name: ex?.name ?? '' });
      setNow(Date.now());
    }
  };
  const edit = (s: SetView, k: 'kg' | 'reps' | 'rpe', value: string) => {
    touched.current.add(s.id);
    setVals({ ...vals, [s.id]: { ...(vals[s.id] as Vals[string]), [k]: value } });
  };
  const left = rest ? Math.max(0, Math.ceil((rest.until - now) / 1000)) : 0;
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return (
    <div className="ath-stack ath-workout">
      <header className="ath-wk-head">
        <button className="ath-back" onClick={() => go('#/atleta')} aria-label="Volver">
          ←
        </button>
        <div>
          <h1>{data.title}</h1>
          <p className="muted">
            {short(data.date)} · {data.block.name} · Semana {data.weekNo}
          </p>
        </div>
        <span className="ath-timer">
          {mm}:{ss}
        </span>
      </header>
      {(live === 'offline' || pending > 0) && (
        <p className="ath-sync warn" role="status">
          {pending > 0
            ? `Sin conexión: ${pending} ${pending === 1 ? 'serie guardada' : 'series guardadas'} en el teléfono; se envían solas al volver la señal.`
            : 'Sin conexión: se mostrará lo último cargado.'}
        </p>
      )}
      {updated && (
        <p className="ath-sync ok" role="status">
          Tu coach actualizó este entreno.
        </p>
      )}
      <div className="ath-progress big" aria-label="Avance">
        <span style={{ width: `${(done / Math.max(1, all.length)) * 100}%` }} />
        <em>
          {done}/{all.length} series
        </em>
      </div>
      <p className="ath-legend">
        <span className="k warmup">A</span> calentamiento · <span className="k top">TOP</span> top set ·{' '}
        <span className="k backoff">B</span> backoff · <span className="k">1</span> serie efectiva
      </p>
      {data.exercises.map((ex) => {
        let eff = 0;
        return (
          <section className="ath-card ath-exercise" key={ex.name}>
            <h2>{ex.name}</h2>
            {ex.coachNotes.length > 0 && (
              <p className="ath-coachnote">
                <b>Coach:</b> {ex.coachNotes.join(' · ')}
              </p>
            )}
            {ex.goalText && <p className="ath-goal">{ex.goalText}</p>}
            {ex.previous && (
              <p className="muted small">
                Última vez ({ex.previous.date.slice(5).split('-').reverse().join('/')}):{' '}
                {ex.previous.sets.map((p) => `${fmtKg(p.kg) || '—'}×${p.reps ?? '—'}`).join(' · ')}
              </p>
            )}
            <table className="ath-sets">
              <thead>
                <tr>
                  <th>SERIE</th>
                  <th>ANTERIOR</th>
                  <th>KG</th>
                  <th>REPS</th>
                  {ex.mode !== 'solo_carga' && <th>RPE</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {ex.sets.map((s, i) => {
                  const v = vals[s.id] as Vals[string];
                  if (s.kind !== 'warmup') eff += 1;
                  const prev = ex.previous?.sets[i];
                  return (
                    <Fragment key={s.id}>
                      <tr className={`${v.done ? 'done' : ''} ${s.kind}`}>
                        <td>
                          <span className={`ath-k ${s.kind}`} title={KIND[s.kind].hint}>
                            {s.kind === 'work' ? eff : s.kind === 'top' ? 'TOP' : KIND[s.kind].label}
                          </span>
                        </td>
                        <td className="prev">
                          {prev ? `${fmtKg(prev.kg) || '—'}×${prev.reps ?? '—'}` : '—'}
                        </td>
                        <td>
                          <input
                            inputMode="decimal"
                            value={v.kg}
                            placeholder={
                              s.kg !== null ? `${s.kgSource === 'derived' ? '≈' : ''}${fmtKg(s.kg)}` : '—'
                            }
                            onChange={(e) => edit(s, 'kg', e.target.value)}
                            onBlur={() => v.done && void save(s, v)}
                            aria-label="Kilos"
                          />
                        </td>
                        <td>
                          <input
                            inputMode="numeric"
                            value={v.reps}
                            placeholder={s.repsMax ? `${s.reps}-${s.repsMax}` : String(s.reps)}
                            onChange={(e) => edit(s, 'reps', e.target.value)}
                            onBlur={() => v.done && void save(s, v)}
                            aria-label="Repeticiones"
                          />
                        </td>
                        {ex.mode !== 'solo_carga' && (
                          <td>
                            <input
                              inputMode="decimal"
                              value={v.rpe}
                              placeholder={s.rpe !== null ? String(s.rpe).replace('.', ',') : '—'}
                              onChange={(e) => edit(s, 'rpe', e.target.value)}
                              onBlur={() => v.done && void save(s, v)}
                              aria-label="RPE"
                            />
                          </td>
                        )}
                        <td>
                          <button
                            className={`ath-check ${v.done ? 'on' : ''}`}
                            onClick={() => toggle(s)}
                            aria-pressed={v.done}
                            aria-label="Serie hecha"
                            disabled={saving === s.id}
                          >
                            ✓
                          </button>
                        </td>
                      </tr>
                      {(s.pct !== null || s.goal || s.tempo || s.pauseSec) && (
                        <tr className="meta">
                          <td />
                          <td colSpan={5}>
                            {s.pct !== null && (
                              <span className="ath-pill">{String(s.pct).replace('.', ',')} % del RM</span>
                            )}
                            {s.tempo && <span className="ath-pill">Tempo {s.tempo}</span>}
                            {s.pauseSec ? <span className="ath-pill">Pausa {s.pauseSec}s</span> : null}
                            {s.goal && (
                              <span className="ath-pill goal">
                                Meta {s.goal.kg ? `${fmtKg(s.goal.kg)} kg × ` : ''}
                                {s.goal.reps} reps
                              </span>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <ExNote sessionKey={data.key} name={ex.name} initial={ex.athleteNote} />
          </section>
        );
      })}
      {rest && left > 0 && (
        <div className="ath-rest" role="timer" aria-live="off">
          <span style={{ width: `${(left / rest.total) * 100}%` }} />
          <b>
            Descanso {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
          </b>
          <small>{rest.name}</small>
          <button type="button" onClick={() => setRest(null)}>
            Omitir
          </button>
        </div>
      )}
      {saved ? (
        <section className="ath-card ath-done" role="status">
          <div className="ath-done-mark">✓</div>
          <h2>¡Entreno guardado!</h2>
          <p>
            {done} de {all.length} series · {mm}:{ss} · fatiga {fatigue}/10
          </p>
          <p className="muted">Tu coach ya lo ve en su panel.</p>
          <button className="ath-primary" onClick={() => go('#/atleta')}>
            Volver al inicio
          </button>
        </section>
      ) : !finish ? (
        <>
          {data.finished && (
            <p className="ath-sync ok" role="status">
              Ya cerraste este entreno ✓ (fatiga {data.endFatigue ?? '—'}/10). Podés corregir el cierre.
            </p>
          )}
          <button
            className="ath-primary big"
            onClick={() => {
              setFinish(true);
              // la tarjeta de cierre aparece más abajo: se lleva la vista hasta ahí para que se note
              setTimeout(
                () => finishRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
                50,
              );
            }}
          >
            {data.finished ? 'Corregir el cierre' : 'Finalizar entrenamiento'}
          </button>
        </>
      ) : (
        <section className="ath-card" ref={finishRef}>
          <h2>¿Cómo terminaste?</h2>
          <p className={done < all.length ? 'ath-sync warn' : 'muted'}>
            Marcaste {done} de {all.length} series
            {done < all.length ? ': las que quedaron sin marcar cuentan como no hechas.' : '.'}
          </p>
          <label className="ath-slider">
            <span>
              Fatiga al terminar <b>{fatigue}</b>/10
            </span>
            <input
              type="range"
              min={1}
              max={10}
              value={fatigue}
              onChange={(e) => setFatigue(Number(e.target.value))}
            />
            <small>
              <span>Fresco</span>
              <span>Agotado</span>
            </small>
          </label>
          <label>
            Comentario para tu coach (opcional)
            <textarea rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {finishError && (
            <p className="ath-error" role="alert">
              No se pudo guardar: {finishError}. Reintentá.
            </p>
          )}
          <button
            className="ath-primary"
            disabled={closing}
            onClick={async () => {
              setClosing(true);
              setFinishError('');
              try {
                // si quedaron series con datos escritos sin ✓ o cambios sin enviar, se mandan primero
                await flushOutbox();
                await api.finish(data.key, fatigue, note);
                setSaved(true);
              } catch (e) {
                setFinishError((e as Error).message);
              } finally {
                setClosing(false);
              }
            }}
          >
            {closing ? 'Guardando…' : 'Guardar y terminar'}
          </button>
        </section>
      )}
    </div>
  );
}

/** Nota del atleta debajo de cada ejercicio (la lee el coach). Se guarda sola; si no hay señal, reintenta al volver. */
function ExNote({ sessionKey, name, initial }: { sessionKey: string; name: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [state, setState] = useState<'' | 'saving' | 'saved' | 'retry'>('');
  const saved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = async (t: string) => {
    if (t === saved.current) return;
    setState('saving');
    try {
      await api.note(sessionKey, name, t);
      saved.current = t;
      setState('saved');
    } catch {
      setState('retry');
    }
  };
  useEffect(() => {
    const again = () => void flush(text);
    window.addEventListener('online', again);
    const i = setInterval(() => state === 'retry' && void flush(text), 4000);
    return () => {
      window.removeEventListener('online', again);
      clearInterval(i);
    };
  }, [text, state]);
  return (
    <label className="ath-exnote">
      <span>Tu nota sobre este ejercicio</span>
      <textarea
        rows={2}
        maxLength={600}
        value={text}
        placeholder="Cómo te sentiste, molestias, qué cambiarías…"
        onChange={(e) => {
          setText(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = setTimeout(() => void flush(v), 800);
        }}
        onBlur={() => void flush(text)}
      />
      <small>
        {state === 'saving' && 'Guardando…'}
        {state === 'saved' && 'Guardado · tu coach la ve'}
        {state === 'retry' && 'Sin señal: se guardará sola al volver'}
      </small>
    </label>
  );
}
