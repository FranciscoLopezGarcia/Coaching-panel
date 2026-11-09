import { useEffect, useState } from 'react';
import type { Comparison } from '@coaching/contracts';
import { api } from '../../api/client';
import { Async } from '../../components/Async';
import { useLoad } from '../../hooks';
import { fmt } from '../../labels';

const cell = (v: number | string | null) => (v === null ? '—' : typeof v === 'number' ? fmt(v, 2) : v);

/** Comparativas A/B de bloques, normalizadas por semana. Planificado y realizado se eligen y NUNCA se mezclan. */
export function CompareTab({ id }: { id: string }) {
  const blocks = useLoad(() => api.blocks(id), [id]);
  const [lift, setLift] = useState('SQ');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [universe, setUniverse] = useState('planned');
  const [scope, setScope] = useState('shared');
  const [res, setRes] = useState<Comparison | null>(null);
  const [err, setErr] = useState('');
  const keys = [
    ...new Set(
      (blocks.data?.blocks ?? []).filter((x) => lift === 'ALL' || x.lift === lift).map((x) => x.blockKey),
    ),
  ];
  useEffect(() => {
    if (keys.length >= 2 && (!keys.includes(a) || !keys.includes(b))) {
      setA(keys[0] as string);
      setB(keys[1] as string);
    }
  }, [keys.join('|'), lift]);
  useEffect(() => {
    if (!a || !b) return;
    api
      .compare(id, { lift, a, b, universe, scope })
      .then((r) => {
        setRes(r);
        setErr('');
      })
      .catch((e: Error) => setErr(e.message));
  }, [id, lift, a, b, universe, scope]);
  return (
    <Async state={blocks}>
      {() => (
        <div>
          <div className="row">
            <label>
              Lift{' '}
              <select value={lift} onChange={(e) => setLift(e.target.value)}>
                <option value="SQ">Sentadilla</option>
                <option value="BP">Banca</option>
                <option value="DL">Peso muerto</option>
                <option value="ALL">Contexto global</option>
              </select>
            </label>
            <label>
              A{' '}
              <select value={a} onChange={(e) => setA(e.target.value)}>
                {keys.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              B{' '}
              <select value={b} onChange={(e) => setB(e.target.value)}>
                {keys.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Universo{' '}
              <select value={universe} onChange={(e) => setUniverse(e.target.value)}>
                <option value="planned">Planificado</option>
                <option value="actual">Realizado</option>
              </select>
            </label>
            <label>
              Vista{' '}
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="shared">Primeras N semanas compartidas</option>
                <option value="full">Bloque completo</option>
              </select>
            </label>
          </div>
          {keys.length < 2 && (
            <p className="muted">Hace falta tener al menos dos bloques del mismo lift para comparar.</p>
          )}
          {err && <p className="error">{err}</p>}
          {res && (
            <>
              <ul className="small muted">
                {res.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Variable</th>
                      <th>A · {res.a.blockKey}</th>
                      <th>B · {res.b.blockKey}</th>
                      <th>Diferencia</th>
                      <th>%</th>
                      <th>Cobertura</th>
                      <th>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.rows.map((r) => (
                      <tr key={r.key}>
                        <td>
                          {r.label} <span className="muted small">{r.unit}</span>
                        </td>
                        <td>{cell(r.a)}</td>
                        <td>{cell(r.b)}</td>
                        <td>{r.diff !== null ? fmt(r.diff, 2) : '—'}</td>
                        <td>{r.pctDiff !== null ? fmt(r.pctDiff) : '—'}</td>
                        <td>{r.coverage}</td>
                        <td className="small muted">{r.note ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </Async>
  );
}
