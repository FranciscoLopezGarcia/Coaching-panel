import { api } from '../../api/client';
import { Async } from '../../components/Async';
import { LineChart } from '../../components/LineChart';
import { useLoad } from '../../hooks';
import { fmt, LIFT_NAMES } from '../../labels';

/** Rendimiento: e1RM de tabla por exposición (benchmark = ejercicio de competencia) y récords REALES de kg, claramente separados. */
export function PerformanceTab({ id }: { id: string }) {
  const perf = useLoad(() => api.performance(id), [id]);
  return (
    <Async state={perf}>
      {(p) => (
        <div>
          <p className="small muted">
            E = kg ÷ %tabla(reps, RPE real). Sin RPE real no hay E. Un e1RM no es un récord real de kg: los
            récords se muestran aparte.
          </p>
          {(Object.keys(p) as (keyof typeof p)[]).map((l) => {
            const x = p[l];
            if (!x) return null;
            const comp = x.exposures.filter((e) => e.e !== null);
            return (
              <section key={l} className="lift">
                <h3>{LIFT_NAMES[l]}</h3>
                <LineChart
                  label="E por exposición"
                  unit="kg"
                  points={comp.map((e) => ({ x: e.date, y: e.e as number }))}
                />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Slot</th>
                        <th>Mejor serie</th>
                        <th>E (kg)</th>
                        <th>RPE real − objetivo</th>
                        <th>Cumplimiento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...x.exposures].reverse().map((e) => (
                        <tr key={e.sessionKey}>
                          <td>{e.date}</td>
                          <td>{e.exposureId}</td>
                          <td>
                            {e.best ? (
                              `${fmt(e.best.kg)}×${e.best.reps} @${fmt(e.best.rpe)}`
                            ) : (
                              <span className="muted">sin RPE real</span>
                            )}
                          </td>
                          <td>{fmt(e.e)}</td>
                          <td>{fmt(e.rpeDev)}</td>
                          <td>{Math.round(e.compliance * 100)} %</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h4>Récords reales (kg por repeticiones, ejercicio de competencia)</h4>
                {x.records.length ? (
                  <p className="small">
                    {x.records.map((r) => `${r.reps} rep: ${fmt(r.kg)} kg (${r.date})`).join(' · ')}
                  </p>
                ) : (
                  <p className="muted small">Sin series hechas.</p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Async>
  );
}
