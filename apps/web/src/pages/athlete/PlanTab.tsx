import { useState } from 'react';
import { api } from '../../api/client';
import { Async } from '../../components/Async';
import { useLoad } from '../../hooks';
import { fmt } from '../../labels';

/** Planificación: versiones del plan (snapshots) y estructura por bloque/semana/día. Importar un plan JSON aplica o guarda un borrador. */
export function PlanTab({ id }: { id: string }) {
  const versions = useLoad(() => api.versions(id), [id]);
  const blocks = useLoad(() => api.blocks(id), [id]);
  const sessions = useLoad(() => api.sessions(id), [id]);
  const [json, setJson] = useState('');
  const [status, setStatus] = useState<'aplicado' | 'borrador'>('aplicado');
  const [msg, setMsg] = useState('');
  const send = async () => {
    try {
      const body = JSON.parse(json) as { sets?: unknown };
      const r = await api.importPlan(id, {
        sets: Array.isArray(body) ? body : body.sets,
        status,
        replace: false,
      });
      setMsg(r.note);
      versions.reload();
      blocks.reload();
      sessions.reload();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    }
  };
  return (
    <div>
      <h3>Versiones del plan</h3>
      <Async state={versions}>
        {(v) =>
          v.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Estado</th>
                    <th>Detectada</th>
                    <th>Rige desde</th>
                    <th>Etiqueta</th>
                    <th>Series</th>
                  </tr>
                </thead>
                <tbody>
                  {[...v].reverse().map((x) => (
                    <tr key={x.id}>
                      <td>{x.seq}</td>
                      <td>{x.status}</td>
                      <td>{x.detectedOn}</td>
                      <td>{x.effectiveOn ?? <span className="muted">sin informar</span>}</td>
                      <td>{x.label || '—'}</td>
                      <td>{x.sets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Sin versiones. Importá un plan para empezar el historial.</p>
          )
        }
      </Async>
      <p className="small muted">
        «Detectada» es cuándo el sistema vio la versión; la fecha de edición original del coach no se observa
        y no se inventa.
      </p>

      <h3>Bloques</h3>
      <Async state={blocks}>
        {(b) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lift</th>
                  <th>Bloque</th>
                  <th>Familia</th>
                  <th>Fechas</th>
                  <th>Semanas</th>
                  <th>NL/sem prev.</th>
                  <th>Frec. prev.</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {b.blocks.map((x) => (
                  <tr key={x.lift + x.blockKey}>
                    <td>{x.lift}</td>
                    <td>{x.blockKey}</td>
                    <td>{x.familyKey}</td>
                    <td>
                      {x.startDate} → {x.endDate}
                    </td>
                    <td>{x.weeks}</td>
                    <td>{fmt(x.planned?.perWeek.nl)}</td>
                    <td>{fmt(x.planned?.perWeek.frequency)}</td>
                    <td>{x.closed ? 'cerrado' : 'en curso/futuro'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>

      <h3>Estructura (bloque → semana → día)</h3>
      <Async state={sessions}>
        {(s) => {
          const byBlock = new Map<string, typeof s>();
          s.forEach((x) =>
            byBlock.set(`${x.lift}·${x.blockKey}`, [...(byBlock.get(`${x.lift}·${x.blockKey}`) ?? []), x]),
          );
          return (
            <>
              {[...byBlock.entries()].map(([k, list]) => (
                <details key={k}>
                  <summary>
                    <strong>{k}</strong> <span className="muted small">({list.length} sesiones)</span>
                  </summary>
                  <ul className="small">
                    {[...list]
                      .sort((a, b) => a.weekNo - b.weekNo || a.dayNo - b.dayNo)
                      .map((x) => (
                        <li key={x.sessionKey}>
                          Sem {x.weekNo} · día {x.dayNo} · {x.date} · {x.exerciseName}: {x.sets.length}×
                          {x.sets[0]?.planned.reps}
                          {x.sets[0]?.planned.targetRpe != null
                            ? ` @${fmt(x.sets[0]?.planned.targetRpe)}`
                            : ' (sin RPE objetivo)'}
                          {x.sets[0]?.planned.kg != null ? ` · ${fmt(x.sets[0]?.planned.kg)} kg` : ''}
                        </li>
                      ))}
                  </ul>
                </details>
              ))}
            </>
          );
        }}
      </Async>

      <details className="lift">
        <summary>
          <strong>Importar plan (JSON)</strong> <span className="muted small">para pruebas locales</span>
        </summary>
        <p className="small muted">
          Arreglo de series previstas (o {'{ "sets": [...] }'}). Campos: id, sessionKey, slotKey,
          exerciseName, lift, plannedDate, setNo, reps, targetRpe, plannedKg, y opcionales blockKey, weekNo,
          dayNo, familyKey, refKg. Un «borrador» no modifica el plan vigente ni genera eventos.
        </p>
        <textarea rows={6} value={json} onChange={(e) => setJson(e.target.value)} aria-label="Plan JSON" />
        <div className="row">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'aplicado' | 'borrador')}
            aria-label="Estado de la versión"
          >
            <option value="aplicado">Aplicar</option>
            <option value="borrador">Guardar borrador</option>
          </select>
          <button onClick={send} disabled={!json.trim()}>
            Importar
          </button>
          {msg && <span className="small">{msg}</span>}
        </div>
      </details>
    </div>
  );
}
