import { prescribedReps } from './prescription';
import type { ExposureDetail } from './api';
import { number, dateLabel } from './ui';
export function ExposureHistory({ value }: { value: ExposureDetail }) {
  return (
    <aside className="exposure-history">
      <h3>{value.exercise} · exposiciones anteriores</h3>
      <p className="small muted">
        {value.comparability.segments} tramos de comparabilidad ·{' '}
        {value.comparability.currentSegmentExposures} exposiciones en el actual
      </p>
      {value.sessions
        .slice(-4)
        .reverse()
        .map((s) => (
          <section key={s.sessionKey}>
            <h4>
              {dateLabel(s.date)} · {s.variantKey}
            </h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Serie</th>
                    <th>Prescripción</th>
                    <th>Ejecución</th>
                  </tr>
                </thead>
                <tbody>
                  {s.sets.map((x, i) => (
                    <tr key={i}>
                      <td>{x.setNo}</td>
                      <td>
                        {prescribedReps(x.planned.reps, x.planned.protocol)} × {number(x.planned.kg)} kg
                        <p className="small muted">RPE {number(x.planned.targetRpe)}</p>
                      </td>
                      <td>
                        {number(x.actual?.reps)} × {number(x.actual?.kg)} kg
                        <p className="small muted">RPE real {number(x.actual?.rpe)}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      {value.comparability.breaks.length > 0 && (
        <p className="message">Hay cambios de contexto que limitan la comparabilidad.</p>
      )}
    </aside>
  );
}
