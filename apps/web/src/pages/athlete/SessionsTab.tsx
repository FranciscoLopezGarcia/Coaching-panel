import { useState } from 'react';
import type { Lift } from '@coaching/contracts';
import { api } from '../../api/client';
import { Async } from '../../components/Async';
import { useLoad } from '../../hooks';
import { fmt, LIFT_NAMES } from '../../labels';

/** Sesiones: previsto vs. real por serie. Sin bandeja de videos; la revisión técnica es un campo opcional del coach. */
export function SessionsTab({ id, onChanged }: { id: string; onChanged: () => void }) {
  const sessions = useLoad(() => api.sessions(id), [id]);
  const [lift, setLift] = useState<Lift>('SQ');
  const [verdict, setVerdict] = useState('valida');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const review = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.review(id, { lift, date: new Date().toISOString().slice(0, 10), verdict, note });
      setMsg('Revisión registrada (re-evaluá para verla reflejada).');
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fatigue = async (key: string, v: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.feedback(id, key, v === '' ? null : Number(v));
      sessions.reload();
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Async state={sessions}>
      {(list) => (
        <div>
          <details className="lift">
            <summary>
              <strong>Revisión técnica del coach</strong>{' '}
              <span className="muted small">(opcional; sin video en la app)</span>
            </summary>
            <p className="small muted">
              Sin una revisión registrada, el sistema muestra «técnica no validada en la app». «No comparable»
              suspende las propuestas ofensivas de ese lift.
            </p>
            <div className="row">
              <select value={lift} onChange={(e) => setLift(e.target.value as Lift)} aria-label="Lift">
                {(['SQ', 'BP', 'DL'] as Lift[]).map((l) => (
                  <option key={l} value={l}>
                    {LIFT_NAMES[l]}
                  </option>
                ))}
              </select>
              <select value={verdict} onChange={(e) => setVerdict(e.target.value)} aria-label="Veredicto">
                <option value="valida">Válida</option>
                <option value="no_comparable">No comparable</option>
                <option value="observacion">Observación</option>
              </select>
              <input placeholder="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button disabled={busy} onClick={review}>
                Registrar
              </button>
              {msg && <span className="small">{msg}</span>}
            </div>
          </details>
          {list.map((s) => (
            <details key={s.sessionKey}>
              <summary>
                <strong>{s.date}</strong> · {s.lift ? LIFT_NAMES[s.lift] : '—'} · {s.exerciseName}{' '}
                <span className="muted small">
                  ({s.blockKey} · sem {s.weekNo} · día {s.dayNo})
                </span>
              </summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Serie</th>
                      <th>Previsto</th>
                      <th>Real</th>
                      <th>Estado</th>
                      <th>Molestia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.sets.map((x) => (
                      <tr key={x.setNo}>
                        <td>{x.setNo}</td>
                        <td>
                          {x.planned.reps} reps
                          {x.planned.targetRpe != null ? ` @${fmt(x.planned.targetRpe)}` : ''}
                          {x.planned.kg != null ? ` · ${fmt(x.planned.kg)} kg` : ''}
                        </td>
                        <td>
                          {x.actual && x.actual.status === 'done'
                            ? `${fmt(x.actual.kg)} kg × ${x.actual.reps}${x.actual.rpe != null ? ` @${fmt(x.actual.rpe)}` : ' (sin RPE)'}`
                            : '—'}
                        </td>
                        <td>{x.actual?.status ?? 'pendiente'}</td>
                        <td>{x.actual?.pain != null ? fmt(x.actual.pain, 0) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="small">
                Fatiga de final de sesión (1–10){' '}
                <input
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={s.endFatigue ?? ''}
                  onBlur={(e) => fatigue(s.sessionKey, e.target.value)}
                  style={{ width: 70 }}
                />
              </label>
            </details>
          ))}
        </div>
      )}
    </Async>
  );
}
