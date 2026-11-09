import { api } from '../../api/client';
import { Async } from '../../components/Async';
import { useLoad } from '../../hooks';
import { fmt, TTP_NAMES } from '../../labels';

/** Microciclos y TTP: respuesta por familia, ventanas históricas y candidatos a "golden". Descriptivo; sin porcentajes ficticios. */
export function MicrocyclesTab({ id }: { id: string }) {
  const data = useLoad(() => api.blocks(id), [id]);
  return (
    <Async state={data}>
      {({ blocks, families }) => (
        <div>
          <p className="small muted">
            «Mejor observado al cierre» no es un TTP delimitado: si el bloque termina mejorando, el TTP queda
            «no delimitado». Una pausa por enfermedad o agenda no establece un pico. Estas lecturas son una
            propuesta operativa, no una predicción.
          </p>
          <h3>Bloques</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lift</th>
                  <th>Bloque</th>
                  <th>Familia</th>
                  <th>Exposiciones</th>
                  <th>E inicio → fin</th>
                  <th>Δ</th>
                  <th>Cumpl.</th>
                  <th>TTP</th>
                  <th>Mejor semana</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((b) => (
                  <tr key={b.lift + b.blockKey}>
                    <td>{b.lift}</td>
                    <td>{b.blockKey}</td>
                    <td>{b.familyKey}</td>
                    <td>{b.comparableExposures}</td>
                    <td>
                      {b.eStart !== null && b.eEnd !== null ? `${fmt(b.eStart)} → ${fmt(b.eEnd)}` : '—'}
                    </td>
                    <td>
                      {b.eChange
                        ? `${fmt(b.eChange.kg)} kg${b.eChange.pct != null ? ` (${fmt(b.eChange.pct)} %)` : ''}`
                        : '—'}
                    </td>
                    <td>{b.compliance != null ? `${Math.round(b.compliance * 100)} %` : '—'}</td>
                    <td>{TTP_NAMES[b.ttp.state]}</td>
                    <td>
                      {b.ttp.bestWeek ?? '—'}
                      {b.ttp.windowWeeks ? ` (ventana ${b.ttp.windowWeeks[0]}–${b.ttp.windowWeeks[1]})` : ''}
                    </td>
                    <td className="small">{b.ttp.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Familias de microciclo</h3>
          {!families.length && <p className="muted">Sin familias todavía.</p>}
          {families.map((f) => (
            <article key={f.lift + f.familyKey} className="card">
              <div className="card-head">
                <strong>
                  {f.lift} · {f.familyKey}
                </strong>
                <span className="chip">{f.cycles} ciclo(s)</span>
                <span className="chip">{f.delimited} delimitado(s)</span>
                <span className="chip">{f.pattern.replace(/_/g, ' ')}</span>
                <span className="chip">
                  golden: {f.golden.replace('_', ' ')}
                  {f.coachConfirmed ? ' · confirmado por el coach' : ''}
                </span>
              </div>
              <p className="small">
                {f.bestWeekMedian !== null
                  ? `Mejor semana: mediana ${fmt(f.bestWeekMedian)}${f.bestWeekRange ? `, rango ${f.bestWeekRange[0]}–${f.bestWeekRange[1]}` : ''} (n=${f.delimited}).`
                  : 'Sin ventanas delimitadas.'}
                {f.objective ? ` Objetivo declarado: ${f.objective}.` : ''}
              </p>
              {f.excluded.length > 0 && (
                <p className="small muted">Fuera de la mediana: {f.excluded.join(' · ')}</p>
              )}
              <p className="small muted">{f.note}</p>
            </article>
          ))}
        </div>
      )}
    </Async>
  );
}
