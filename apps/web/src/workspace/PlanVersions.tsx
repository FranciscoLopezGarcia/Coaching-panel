import { useState } from 'react';
import type { ImportPlanInput } from '@coaching/contracts';
import { api } from '../api/client';
import { useLoad } from '../hooks';
import { Async } from '../components/Async';
import { get } from './api';
import { number, Message } from './ui';
export function PlanVersions({ id }: { id: string }) {
  const list = useLoad(() => api.versions(id), [id]);
  const [key, setKey] = useState('');
  const snapshot = useLoad(
    () =>
      key
        ? get<{ status: string; label: string; sets: ImportPlanInput['sets'] }>(
            id,
            'plan-versions/' + encodeURIComponent(key),
          )
        : Promise.resolve(null),
    [id, key],
  );
  return (
    <details className="card">
      <summary>Versiones y borradores guardados</summary>
      <Async state={list}>
        {(versions) => (
          <label>
            Reabrir una versión
            <select value={key} onChange={(e) => setKey(e.target.value)}>
              <option value="">Elegí una versión</option>
              {[...versions].reverse().map((v) => (
                <option key={v.id} value={v.id}>
                  #{v.seq} · {v.status} · {v.label} · {v.detectedOn}
                </option>
              ))}
            </select>
          </label>
        )}
      </Async>
      {key && (
        <Async state={snapshot}>
          {(v) => (
            <>
              <h3>{v.label}</h3>
              {v.status === 'borrador' && (
                <Message>
                  Borrador guardado en el servidor. Se abre su contenido para revisar; no modifica el plan
                  publicado.
                </Message>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha / semana</th>
                      <th>Ejercicio / serie</th>
                      <th>Reps</th>
                      <th>Kg</th>
                      <th>RPE</th>
                      <th>Segmento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.sets.map((s) => (
                      <tr key={s.id}>
                        <td>
                          {s.plannedDate} · S{s.weekNo}
                        </td>
                        <td>
                          {s.exerciseName} · {s.setNo}
                        </td>
                        <td>{s.reps}</td>
                        <td>{number(s.plannedKg)}</td>
                        <td>{number(s.targetRpe)}</td>
                        <td>{s.protocol?.segment ?? 'trabajo'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Async>
      )}
    </details>
  );
}
