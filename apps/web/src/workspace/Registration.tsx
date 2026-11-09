import { SessionResponse } from './SessionResponse';
import { prescribedReps } from './prescription';
import { DataSheet } from './DataSheet';
import { useEffect, useState } from 'react';
import type { ImportSetsInput, SessionRow } from '@coaching/contracts';
import { api } from '../api/client';
import { useLoad } from '../hooks';
import { Async } from '../components/Async';
import { send, get } from './api';
import { Empty, Message, number, today, usePending, Detail } from './ui';
type Entry = {
  plannedSetId: string;
  status: 'done' | 'skipped' | 'pending';
  kg: string;
  reps: string;
  rpe: string;
  pain: string;
  performedOn: string;
};
export function Registration({
  id,
  session,
  onSelect,
  onChanged,
}: {
  id: string;
  session: string;
  onSelect: (v: Record<string, string | null>) => void;
  onChanged: () => void;
}) {
  const sessions = useLoad(() => api.sessions(id), [id]);
  const selected = sessions.data?.find((s) => s.sessionKey === session);
  return (
    <section>
      <h2>Registro de entrenamiento</h2>
      <Message>Demostración local · Sin cuentas de usuario.</Message>
      <Async state={sessions}>
        {(list) => (
          <>
            <label>
              Sesión
              <select value={session} onChange={(e) => onSelect({ session: e.target.value })}>
                <option value="">Elegí una sesión</option>
                {list.map((s) => (
                  <option key={s.sessionKey} value={s.sessionKey}>
                    {s.date} · {s.exerciseName} · {s.blockKey} / S{s.weekNo}
                  </option>
                ))}
              </select>
            </label>
            {selected ? (
              <SessionForm
                key={selected.sessionKey}
                id={id}
                s={selected}
                onChanged={() => {
                  sessions.reload();
                  onChanged();
                }}
              />
            ) : (
              <Empty title="Elegí el entrenamiento a registrar">
                Los campos opcionales pueden quedar vacíos. El RPE real se carga por separado.
              </Empty>
            )}
            <Checkin id={id} />
          </>
        )}
      </Async>
    </section>
  );
}
function SessionForm({ id, s, onChanged }: { id: string; s: SessionRow; onChanged: () => void }) {
  const key = `base:record-draft:${id}:${s.sessionKey}`;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [layout, setLayout] = useState(() =>
    window.matchMedia('(min-width: 900px)').matches ? 'sheet' : 'cards',
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [fatigue, setFatigue] = useState(s.endFatigue == null ? '' : String(s.endFatigue));
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<unknown>(null);
  usePending(dirty);
  const identities = useLoad(
    async () => new Map(s.sets.map((x) => [x.setNo, x.plannedSetId])),
    [id, s.sessionKey],
  );
  useEffect(() => {
    if (!identities.data) return;
    const fresh = s.sets.map((x) => ({
      plannedSetId: x.plannedSetId ?? identities.data!.get(x.setNo) ?? '',
      status: (x.actual?.status ?? 'pending') as Entry['status'],
      kg: x.actual?.kg == null ? '' : String(x.actual.kg),
      reps: x.actual?.reps == null ? '' : String(x.actual.reps),
      rpe: x.actual?.rpe == null ? '' : String(x.actual.rpe),
      pain: x.actual?.pain == null ? '' : String(x.actual.pain),
      performedOn: x.actual?.performedOn ?? today(),
    }));
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as {
        entries: Entry[];
        note: string;
        fatigue: string;
        reason: string;
      } | null;
      if (stored) {
        setEntries(
          fresh.map(
            (x) => stored.entries.find((y) => y.plannedSetId && y.plannedSetId === x.plannedSetId) ?? x,
          ),
        );
        setNote(stored.note);
        setFatigue(stored.fatigue);
        setReason(stored.reason);
        setDirty(true);
        setMessage('Borrador local recuperado. Revisalo antes de guardar.');
        return;
      }
    } catch {
      /* borrador inaccesible */
    }
    setEntries(fresh);
  }, [identities.data]);
  const draft = (next: Entry[], n = note, f = fatigue, r = reason) => {
    setEntries(next);
    setDirty(true);
    try {
      localStorage.setItem(key, JSON.stringify({ entries: next, note: n, fatigue: f, reason: r }));
    } catch {
      setError('No se pudo conservar el borrador en este navegador. Las entradas siguen en pantalla.');
    }
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const sets: ImportSetsInput['sets'] = entries
        .filter((x) => !!x.plannedSetId)
        .map((x) => ({
          plannedSetId: x.plannedSetId,
          status: x.status,
          kg: x.kg ? Number(x.kg.replace(',', '.')) : null,
          reps: x.reps ? Number(x.reps) : null,
          rpe: x.rpe ? Number(x.rpe.replace(',', '.')) : null,
          pain: x.pain ? Number(x.pain.replace(',', '.')) : null,
          performedOn: x.performedOn || null,
        }));
      if (sets.length) await api.importSets(id, { sets, reason: reason || undefined });
      await send(id, 'session-feedback', {
        sessionKey: s.sessionKey,
        endFatigue: fatigue ? Number(fatigue) : null,
        note,
      });
      localStorage.removeItem(key);
      setDirty(false);
      setMessage('Registro y observaciones guardados. Re-evaluá al atleta para actualizar las conclusiones.');
      onChanged();
    } catch (e) {
      setError((e as Error).message + ' · Las entradas se conservan para reintentar.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="record-session card">
      <div className="row between">
        <div>
          <span className="eyebrow">
            {s.date} · {s.blockKey} · SEMANA {s.weekNo}
          </span>
          <h3>{s.exerciseName}</h3>
        </div>
        <span className="chip">{dirty ? 'Cambios pendientes' : 'Sin cambios pendientes'}</span>
      </div>
      <Async state={identities}>
        {() => (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {entries.some((x) => !x.plannedSetId) && (
              <Message>
                La respuesta de esta sesión está incompleta. Reintentá la carga antes de registrar las series
                afectadas; tus entradas siguen guardadas en este navegador.
              </Message>
            )}
            <div className="row between sheet-layout-switch">
              <div className="row">
                <button
                  type="button"
                  className={layout === 'sheet' ? 'on' : ''}
                  onClick={() => setLayout('sheet')}
                >
                  Planilla de registro
                </button>
                <button
                  type="button"
                  className={layout === 'cards' ? 'on' : ''}
                  onClick={() => setLayout('cards')}
                >
                  Una serie por ficha
                </button>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => draft(entries.map((x) => (x.kg && x.reps ? { ...x, status: 'done' } : x)))}
              >
                Marcar filas cargadas como realizadas
              </button>
            </div>
            {layout === 'sheet' ? (
              <DataSheet
                label="Planilla de registro"
                disabled={busy}
                columns={[
                  { key: 'series', label: 'Serie / ejercicio', readOnly: true },
                  { key: 'prescription', label: 'Prescrito · reps × kg @RPE', readOnly: true },
                  { key: 'kg', label: 'Kg reales', type: 'number', min: 0.01 },
                  { key: 'reps', label: 'Reps reales', type: 'number', min: 1, step: 1 },
                  { key: 'rpe', label: 'RPE real', type: 'number', min: 1, max: 10 },
                  {
                    key: 'status',
                    label: 'Estado',
                    type: 'select',
                    options: [
                      { value: 'pending', label: 'Pendiente' },
                      { value: 'done', label: 'Realizada' },
                      { value: 'skipped', label: 'Omitida' },
                    ],
                  },
                  { key: 'performedOn', label: 'Fecha real', type: 'date' },
                  { key: 'pain', label: 'Molestia', type: 'number', min: 0, max: 10 },
                ]}
                rows={entries.map((x, i) => ({
                  ...x,
                  id: x.plannedSetId,
                  series: `${s.sets[i]?.isWarmup ? 'A' : s.sets[i]?.setNo} · ${s.sets[i]?.exerciseName ?? s.exerciseName}`,
                  prescription: `${prescribedReps(s.sets[i]?.planned.reps, s.sets[i]?.protocol)} × ${number(s.sets[i]?.planned.kg)} @${number(s.sets[i]?.planned.targetRpe)}`,
                }))}
                onChange={(changes) => {
                  const next = entries.map((x) => ({ ...x }));
                  for (const c of changes) Object.assign(next[c.row]!, { [c.key]: c.value });
                  draft(next);
                }}
              />
            ) : (
              <>
                <div className="record-sets">
                  {s.sets.map((p, i) => {
                    const x = entries[i];
                    if (!x) return null;
                    return (
                      <fieldset className="record-set" key={i}>
                        <legend>
                          Serie {p.setNo} · {p.exerciseName ?? s.exerciseName}
                        </legend>
                        <p className="prescription">
                          Previsto:{' '}
                          <strong>
                            {prescribedReps(p.planned.reps, p.protocol)} reps · {number(p.planned.kg)} kg ·
                            RPE {number(p.planned.targetRpe)}
                          </strong>
                        </p>
                        <div className="form-grid compact">
                          {(['kg', 'reps', 'rpe', 'pain'] as const).map((k) => (
                            <label key={k}>
                              {
                                {
                                  kg: 'Carga real · kg',
                                  reps: 'Reps reales',
                                  rpe: 'RPE real (opcional)',
                                  pain: 'Molestia · 0–10 (opcional)',
                                }[k]
                              }
                              <input
                                disabled={!x.plannedSetId}
                                type="number"
                                inputMode="decimal"
                                min={k === 'pain' ? 0 : k === 'rpe' || k === 'reps' ? 1 : 0.01}
                                max={k === 'rpe' || k === 'pain' ? 10 : undefined}
                                step={k === 'reps' ? 1 : k === 'rpe' ? 0.5 : 'any'}
                                value={x[k]}
                                onChange={(e) =>
                                  draft(entries.map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)))
                                }
                              />
                            </label>
                          ))}
                          <label>
                            Estado
                            <select
                              disabled={!x.plannedSetId}
                              value={x.status}
                              onChange={(e) =>
                                draft(
                                  entries.map((y, j) =>
                                    j === i ? { ...y, status: e.target.value as Entry['status'] } : y,
                                  ),
                                )
                              }
                            >
                              <option value="pending">Pendiente</option>
                              <option value="done">Realizada</option>
                              <option value="skipped">Omitida</option>
                            </select>
                          </label>
                          <label>
                            Fecha real
                            <input
                              disabled={!x.plannedSetId}
                              type="date"
                              value={x.performedOn}
                              onChange={(e) =>
                                draft(
                                  entries.map((y, j) =>
                                    j === i ? { ...y, performedOn: e.target.value } : y,
                                  ),
                                )
                              }
                            />
                          </label>
                        </div>
                      </fieldset>
                    );
                  })}
                </div>
              </>
            )}
            <label>
              Observaciones de la sesión
              <textarea
                maxLength={300}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  draft(entries, e.target.value);
                }}
              />
            </label>
            <div className="form-grid">
              <label>
                Fatiga final · 1–10 (opcional)
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={fatigue}
                  onChange={(e) => {
                    setFatigue(e.target.value);
                    draft(entries, note, e.target.value);
                  }}
                />
              </label>
              <label>
                Motivo de edición (opcional)
                <input
                  maxLength={200}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    draft(entries, note, fatigue, e.target.value);
                  }}
                />
              </label>
            </div>
            <div className="sticky-actions">
              <span>{dirty ? 'Borrador en este navegador' : 'Registro listo'}</span>
              <button className="primary" disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar registro'}
              </button>
            </div>
          </form>
        )}
      </Async>
      {message && <Message>{message}</Message>}
      {error && <Message error>{error}</Message>}
      <SessionResponse id={id} session={s} />
      <details>
        <summary>Revisiones del registro</summary>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setHistory(await get(id, 'revisions?limit=30'));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Consultar últimas revisiones del atleta
        </button>
        {history !== null && <Detail value={history} />}
      </details>
    </article>
  );
}
export function Checkin({ id }: { id: string }) {
  const key = `base:checkin-draft:${id}`;
  const [values, setValues] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null') ?? {};
    } catch {
      return {};
    }
  });
  const [date, setDate] = useState(values.date ?? today());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fields = [
    ['sleep', 'Sueño'],
    ['energy', 'Energía'],
    ['motivation', 'Ganas de entrenar'],
    ['stress', 'Estrés'],
    ['pain', 'Molestia'],
  ] as const;
  return (
    <details className="card" open>
      <summary>
        <strong>Cuestionario de recuperación</strong>
        <span className="small muted"> · Todos los valores son opcionales</span>
      </summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            await api.addCheckin(id, {
              date,
              ...Object.fromEntries(fields.map(([k]) => [k, values[k] ? Number(values[k]) : null])),
            });
            localStorage.removeItem(key);
            setMessage('Cuestionario guardado.');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Fecha
            <input
              type="date"
              required
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                localStorage.setItem(key, JSON.stringify({ ...values, date: e.target.value }));
              }}
            />
          </label>
          {fields.map(([k, l]) => (
            <label key={k}>
              {l} · 1–10
              <input
                type="number"
                min={1}
                max={10}
                value={values[k] ?? ''}
                onChange={(e) => {
                  const next = { ...values, [k]: e.target.value, date };
                  setValues(next);
                  localStorage.setItem(key, JSON.stringify(next));
                }}
              />
            </label>
          ))}
        </div>
        <button disabled={busy} className="primary">
          {busy ? 'Guardando…' : 'Guardar cuestionario'}
        </button>
        {message && <Message>{message}</Message>}
        {error && <Message error>{error}</Message>}
      </form>
    </details>
  );
}
