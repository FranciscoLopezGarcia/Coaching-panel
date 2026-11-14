import { useState } from 'react';
import { useLoad } from '../hooks';
import { Async } from '../components/Async';
import { get, query } from './api';
import { number } from './ui';

interface CoreMuscles {
  muscles: {
    rows: {
      muscle: string;
      label: string;
      directSets: number;
      indirectSets: number;
      equivalentSets: number;
      exercises: string[];
    }[];
    unmappedExercises: string[];
  };
}
/**
 * «Mapa muscular» (radar): series equivalentes por grupo en el período, previsto vs. realizado. Descriptivo: no dice qué grupo «debería» tener más.
 * El eje se escala al mayor valor mostrado; la tabla de abajo trae los números exactos.
 */
export function MuscleRadar({
  id,
  from,
  to,
  cutoff,
  view,
}: {
  id: string;
  from: string;
  to: string;
  cutoff: string;
  view?: string;
}) {
  const [basis, setBasis] = useState<'realizado' | 'previsto'>('realizado');
  const [show, setShow] = useState<'both' | 'one'>('both');
  const data = useLoad(async () => {
    const q = { from, to, cutoff, view: 'weeks', ...(view ? { muscleView: view } : {}) };
    const [real, plan] = await Promise.all([
      get<CoreMuscles>(id, 'core' + query({ ...q, basis: 'realizado' })),
      get<CoreMuscles>(id, 'core' + query({ ...q, basis: 'previsto', cutoff: to > cutoff ? to : cutoff })),
    ]);
    return { real: real.muscles, plan: plan.muscles };
  }, [id, from, to, cutoff, view]);
  return (
    <section className="muscle-radar">
      <div className="row between">
        <h3>Mapa muscular del período</h3>
        <div className="bd-seg" role="group" aria-label="Qué mostrar">
          <button type="button" aria-pressed={show === 'both'} onClick={() => setShow('both')}>
            Previsto y realizado
          </button>
          <button
            type="button"
            aria-pressed={show === 'one' && basis === 'realizado'}
            onClick={() => (setShow('one'), setBasis('realizado'))}
          >
            Solo realizado
          </button>
          <button
            type="button"
            aria-pressed={show === 'one' && basis === 'previsto'}
            onClick={() => (setShow('one'), setBasis('previsto'))}
          >
            Solo previsto
          </button>
        </div>
      </div>
      <Async state={data}>
        {(d) => {
          const keys = [...new Set([...d.real.rows, ...d.plan.rows].map((r) => r.muscle))];
          const labelOf = (k: string) =>
            [...d.real.rows, ...d.plan.rows].find((r) => r.muscle === k)?.label ?? k;
          const val = (rows: typeof d.real.rows, k: string) =>
            rows.find((r) => r.muscle === k)?.equivalentSets ?? 0;
          if (keys.length < 3)
            return (
              <p className="muted">
                Hacen falta al menos 3 grupos con series en el período para dibujar el mapa.
              </p>
            );
          const max = Math.max(1, ...keys.flatMap((k) => [val(d.real.rows, k), val(d.plan.rows, k)]));
          const R = 110;
          const C = 150;
          const pt = (i: number, v: number) => {
            const a = (2 * Math.PI * i) / keys.length - Math.PI / 2;
            const r = (R * v) / max;
            return `${C + r * Math.cos(a)},${C + r * Math.sin(a)}`;
          };
          const poly = (rows: typeof d.real.rows) => keys.map((k, i) => pt(i, val(rows, k))).join(' ');
          const showReal = show === 'both' || basis === 'realizado';
          const showPlan = show === 'both' || basis === 'previsto';
          return (
            <div className="radar-wrap">
              <svg
                viewBox="0 0 300 300"
                role="img"
                aria-label="Series equivalentes por grupo muscular"
                style={{ maxWidth: 380, width: '100%' }}
              >
                {[0.25, 0.5, 0.75, 1].map((f) => (
                  <polygon
                    key={f}
                    points={keys.map((_, i) => pt(i, max * f)).join(' ')}
                    fill="none"
                    stroke="currentColor"
                    opacity={0.18}
                  />
                ))}
                {keys.map((k, i) => {
                  const a = (2 * Math.PI * i) / keys.length - Math.PI / 2;
                  return (
                    <g key={k}>
                      <line
                        x1={C}
                        y1={C}
                        x2={C + R * Math.cos(a)}
                        y2={C + R * Math.sin(a)}
                        stroke="currentColor"
                        opacity={0.18}
                      />
                      <text
                        x={C + (R + 14) * Math.cos(a)}
                        y={C + (R + 14) * Math.sin(a)}
                        fontSize="8"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="currentColor"
                      >
                        {labelOf(k).split(' (')[0]}
                      </text>
                    </g>
                  );
                })}
                {showPlan && (
                  <polygon
                    points={poly(d.plan.rows)}
                    fill="#8a8f98"
                    fillOpacity={0.15}
                    stroke="#8a8f98"
                    strokeDasharray="4 3"
                  />
                )}
                {showReal && (
                  <polygon
                    points={poly(d.real.rows)}
                    fill="#3b82f6"
                    fillOpacity={0.25}
                    stroke="#3b82f6"
                    strokeWidth={2}
                  />
                )}
              </svg>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Grupo</th>
                      <th>Previsto</th>
                      <th>Realizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k}>
                        <td>{labelOf(k)}</td>
                        <td>{number(val(d.plan.rows, k))}</td>
                        <td>{number(val(d.real.rows, k))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted">
                Series equivalentes (directa 1, indirecta 0,5) en el período. Línea punteada = previsto; azul
                = realizado. Los grupos se superponen: no se suman entre sí.
                {d.real.unmappedExercises.length
                  ? ` Sin músculo asignado: ${d.real.unmappedExercises.join(', ')}.`
                  : ''}
              </p>
            </div>
          );
        }}
      </Async>
    </section>
  );
}
