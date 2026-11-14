import { useState } from 'react';
import { api } from '../../api/client';
import { Async } from '../../components/Async';
import { LineChart } from '../../components/LineChart';
import { useLoad } from '../../hooks';
import { fmt } from '../../labels';

/** TRAC ampliado (opcional): no entra en la disposición. */
const EXTRAS: [string, string][] = [
  ['soreness', 'Dolor muscular'],
  ['confidence', 'Confianza'],
  ['sleepHours', 'Horas de sueño'],
  ['bodyweightKg', 'Peso (kg)'],
];
const FIELDS: [string, string][] = [
  ['sleep', 'Sueño'],
  ['energy', 'Energía'],
  ['motivation', 'Ganas'],
  ['stress', 'Estrés'],
  ['pain', 'Dolor'],
];

/** Recuperación: check-in semanal propio (NO es TRAC). Un check-in viejo no reescribe el rendimiento registrado. */
export function RecoveryTab({ id }: { id: string }) {
  const rows = useLoad(() => api.checkins(id), [id]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [vals, setVals] = useState<Record<string, string>>({
    sleep: '',
    energy: '',
    motivation: '',
    stress: '',
    pain: '',
    soreness: '',
    confidence: '',
    sleepHours: '',
    bodyweightKg: '',
  });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.addCheckin(id, {
        date,
        ...Object.fromEntries([...FIELDS, ...EXTRAS].map(([k]) => [k, vals[k] ? Number(vals[k]) : null])),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setMsg('Guardado');
      rows.reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Async state={rows}>
      {(r) => (
        <div>
          <p className="small muted">
            Disposición (1–10) = promedio de sueño, energía, ganas, (11 − estrés) y (10 − dolor); requiere los
            5 campos. Es una medida propia, no el TRAC de RTS ni de PRG, y es semanal: no genera un estado
            diario retrospectivo.
          </p>
          <LineChart
            label="Disposición"
            unit="/10"
            points={[...r]
              .reverse()
              .filter((x) => x.readiness !== null)
              .map((x) => ({ x: x.date, y: x.readiness as number }))}
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  {FIELDS.map(([, l]) => (
                    <th key={l}>{l}</th>
                  ))}
                  <th>Disposición</th>
                  {EXTRAS.map(([, l]) => (
                    <th key={l}>{l}</th>
                  ))}
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {r.map((x) => (
                  <tr key={x.date}>
                    <td>{x.date}</td>
                    {FIELDS.map(([k]) => (
                      <td key={k}>{fmt((x as unknown as Record<string, number | null>)[k], 0)}</td>
                    ))}
                    <td>{fmt(x.readiness)}</td>
                    {EXTRAS.map(([k]) => (
                      <td key={k}>
                        {fmt((x as unknown as Record<string, number | null | undefined>)[k] ?? null, 1)}
                      </td>
                    ))}
                    <td className="small">{x.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="lift" open={!r.length}>
            <summary>
              <strong>Registrar check-in</strong>
            </summary>
            <div className="grid-params">
              <label>
                Fecha <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              {FIELDS.map(([k, l]) => (
                <label key={k}>
                  {l} (1–10){' '}
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={vals[k]}
                    onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
                  />
                </label>
              ))}
              {EXTRAS.map(([k, l]) => (
                <label key={k}>
                  {l} (opcional){' '}
                  <input
                    type="number"
                    step="any"
                    value={vals[k]}
                    onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
                  />
                </label>
              ))}
              <label>
                Nota (opcional){' '}
                <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
            <div className="row">
              <button disabled={busy} onClick={save}>
                Guardar
              </button>
              {msg && <span className="small">{msg}</span>}
            </div>
          </details>
        </div>
      )}
    </Async>
  );
}
