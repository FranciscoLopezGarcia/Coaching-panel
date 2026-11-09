import { useState } from 'react';
import type { EventWithFollowUp } from '@coaching/contracts';
import { api } from '../../api/client';
import { Async } from '../../components/Async';
import { useLoad } from '../../hooks';
import { CLASS_NAMES, fmt } from '../../labels';

function Event({ x, id, onSaved }: { x: EventWithFollowUp; id: string; onSaved: () => void }) {
  const e = x.event;
  const [c, setC] = useState(e.coachComment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <article className="card">
      <div className="card-head">
        <strong>Cambio detectado {e.detectedOn}</strong>
        <span className="chip">{e.status}</span>
        <span className="chip">
          rige desde {e.effectiveOn ?? '—'}
          {e.effectiveEstimated ? ' (estimado)' : ''}
        </span>
        <span className="chip">
          {e.setChanges.added} altas · {e.setChanges.removed} bajas · {e.setChanges.modified} modificadas
        </span>
      </div>
      <p className="small muted">
        Actor: no se conoce (solo se detectó la diferencia entre versiones). Los hechos se registran solos; el
        motivo es opcional.
      </p>
      {e.changes.map((ch) => (
        <div key={ch.lift + ch.blockKey}>
          <p className="summary">
            {ch.summary} <span className="chip">{CLASS_NAMES[ch.classification] ?? ch.classification}</span>
          </p>
          {ch.caveats.map((v) => (
            <p key={v} className="small muted">
              • {v}
            </p>
          ))}
          <details>
            <summary className="small">Deltas ({ch.deltas.length})</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Antes</th>
                    <th>Después</th>
                    <th>Δ</th>
                    <th>%</th>
                    <th>Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {ch.deltas.map((d) => (
                    <tr key={d.variable}>
                      <td>
                        {d.variable} <span className="muted small">{d.unit}</span>
                      </td>
                      <td>{fmt(d.before, 2)}</td>
                      <td>{fmt(d.after, 2)}</td>
                      <td>{fmt(d.delta, 2)}</td>
                      <td>{fmt(d.pct)}</td>
                      <td className="small muted">{d.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      ))}
      {x.outcomes.map((o) => (
        <p key={o.lift + o.blockKey} className={`proposal tone-${o.state === 'evaluado' ? 'info' : 'muted'}`}>
          <strong>
            Seguimiento ({o.lift}): {o.state.replace('_', ' ')}.
          </strong>{' '}
          {o.text} <span className="muted small">[{o.coverage}]</span>
        </p>
      ))}
      <div className="decision">
        <input
          placeholder="Motivo del cambio (opcional)"
          value={c}
          onChange={(ev) => setC(ev.target.value)}
          aria-label="Motivo del cambio"
        />
        <button
          disabled={busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setError('');
            try {
              await api.commentEvent(id, e.id, c);
              setSaved(true);
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Guardar motivo
        </button>
      </div>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="small muted">
          Motivo guardado
        </p>
      )}
    </article>
  );
}

/** Historial automático: qué cambió, cuándo y qué se observó después. Sin atribuir causalidad ni intención. */
export function HistoryTab({ id }: { id: string }) {
  const h = useLoad(() => api.history(id), [id]);
  return (
    <Async state={h}>
      {(d) => (
        <div>
          <p className="small muted">
            Cambio del plan ≠ desviación de ejecución ≠ recomendación del motor. Tras un cambio solo se
            describe lo observado («se observó…», «coincidió con…»).
          </p>
          {!d.events.length && (
            <p className="muted">
              Sin cambios detectados: hacen falta al menos dos versiones del plan. Con una sola versión el
              historial está incompleto, no se arma un relato.
            </p>
          )}
          {d.events.map((x) => (
            <Event key={x.event.id} x={x} id={id} onSaved={h.reload} />
          ))}
          <h3>Desviaciones de ejecución (previsto vs realizado)</h3>
          {!d.deviations.length ? (
            <p className="muted small">Sin semanas transcurridas.</p>
          ) : (
            <ul className="small">
              {d.deviations
                .filter((v) => v.status !== 'cumplido')
                .map((v) => (
                  <li key={v.lift + v.blockKey + v.weekNo}>{v.text}</li>
                ))}
              {d.deviations.every((v) => v.status === 'cumplido') && (
                <li>Todas las semanas transcurridas se cumplieron.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </Async>
  );
}
