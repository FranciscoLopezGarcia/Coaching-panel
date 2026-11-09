import { SI_MODEL, type BlockMetrics } from '@coaching/contracts';
import { api } from '../../api/client';
import { Async } from '../../components/Async';
import { useLoad } from '../../hooks';
import { fmt } from '../../labels';

function Table({ title, list }: { title: string; list: BlockMetrics[] }) {
  return (
    <div>
      <h3>{title}</h3>
      {!list.length && <p className="muted small">Sin datos.</p>}
      {list.map((b) => (
        <details key={b.lift + b.blockKey} open>
          <summary>
            <strong>
              {b.lift} · {b.blockKey}
            </strong>{' '}
            <span className="muted small">
              {b.weeks.length} semanas · por semana: {fmt(b.perWeek.nl)} NL, {fmt(b.perWeek.sets)} series,
              frecuencia {fmt(b.perWeek.frequency)}
            </span>
          </summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sem</th>
                  <th>Series</th>
                  <th>NL</th>
                  <th>Tonelaje (kg)</th>
                  <th>Frec.</th>
                  <th>%ref medio</th>
                  <th>RPE medio</th>
                  <th>SI total</th>
                  <th>SI central</th>
                  <th>SI perif.</th>
                </tr>
              </thead>
              <tbody>
                {b.weekly.map((w) => (
                  <tr key={w.weekNo}>
                    <td>{w.weekNo}</td>
                    <td>{w.sets}</td>
                    <td>{w.nl}</td>
                    <td>{fmt(w.tonnage, 0)}</td>
                    <td>{w.frequency}</td>
                    <td>{w.meanPct != null ? fmt(100 * w.meanPct) : '—'}</td>
                    <td>{fmt(w.meanRpe)}</td>
                    <td>{fmt(w.si?.total, 2)}</td>
                    <td>{fmt(w.si?.central, 2)}</td>
                    <td>{fmt(w.si?.peripheral, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!b.siComplete && (
            <p className="small muted">
              SI incompleto: faltan RPE en algunas series, no se completa con supuestos.
            </p>
          )}
        </details>
      ))}
    </div>
  );
}

/** Carga: NL (suma de repeticiones, no series), series, tonelaje, intensidad y SI, con previsto y realizado en tablas separadas. */
export function LoadTab({ id }: { id: string }) {
  const load = useLoad(() => api.load(id), [id]);
  return (
    <Async state={load}>
      {(l) => (
        <div>
          <p className="small muted">
            NL = Σ repeticiones. SI: modelo <code>{SI_MODEL}</code> [aproximado], central ≈ intensidad,
            periférico ≈ repeticiones efectivas. Igual NL o igual SI no implica el mismo estímulo.
          </p>
          <Table title="Planificado" list={l.planned} />
          <Table title="Realizado" list={l.actual} />
        </div>
      )}
    </Async>
  );
}
