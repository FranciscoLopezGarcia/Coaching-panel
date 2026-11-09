import { useState } from 'react';
import { useLoad } from '../hooks';
import { fetchProjection, projectionVariable, type Point } from './adapter';
import { number, dateLabel, Detail } from '../workspace/ui';
export function Curve({
  observations,
  trend = [],
  forecast = [],
  range = [],
  cutoff,
}: {
  observations: Point[];
  trend?: Point[];
  forecast?: Point[];
  range?: { date: string; lower: number; upper: number }[];
  cutoff: string;
}) {
  const points = [...observations, ...trend, ...forecast];
  if (!points.length) return <div className="empty">No hay observaciones comparables en este período.</div>;
  const dates = [...points.map((p) => Date.parse(p.date)), Date.parse(cutoff)];
  const a = Math.min(...dates),
    b = Math.max(...dates);
  const ys = [...points.map((p) => p.value), ...range.flatMap((p) => [p.lower, p.upper])];
  const low = Math.min(...ys),
    high = Math.max(...ys),
    pad = Math.max((high - low) * 0.15, 1);
  const x = (d: string) => 60 + ((Date.parse(d) - a) / Math.max(b - a, 86400000)) * 840;
  const y = (v: number) => 240 - ((v - low + pad) / (high - low + 2 * pad)) * 205;
  const line = (ps: Point[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${x(p.date)},${y(p.value)}`).join(' ');
  return (
    <figure className="performance-curve">
      <svg
        viewBox="0 0 940 290"
        role="img"
        aria-label={
          forecast.length
            ? 'Fuerza: observaciones, tendencia y proyección en kilogramos'
            : 'Fuerza observada en kilogramos'
        }
      >
        {[low, (low + high) / 2, high].map((v, i) => (
          <g key={i}>
            <line x1="60" x2="900" y1={y(v)} y2={y(v)} className="curve-grid" />
            <text x="8" y={y(v) + 4}>
              {number(v)} kg
            </text>
          </g>
        ))}
        {forecast.length > 0 && (
          <>
            <rect
              x={x(cutoff)}
              y="20"
              width={Math.max(0, 900 - x(cutoff))}
              height="230"
              className="future-zone"
            />
            <line x1={x(cutoff)} x2={x(cutoff)} y1="20" y2="250" className="cutoff-line" />
            <text x={Math.min(x(cutoff) + 8, 830)} y="16">
              Proyección
            </text>
          </>
        )}
        {range.length > 1 && (
          <path
            className="forecast-band"
            d={
              line(range.map((p) => ({ date: p.date, value: p.upper }))) +
              ' ' +
              [...range]
                .reverse()
                .map((p) => `L${x(p.date)},${y(p.lower)}`)
                .join(' ') +
              ' Z'
            }
          />
        )}
        {range.length === 1 &&
          range.map((r) => (
            <g key={r.date}>
              <line
                x1={x(r.date)}
                x2={x(r.date)}
                y1={y(r.lower)}
                y2={y(r.upper)}
                stroke="currentColor"
                strokeWidth="3"
              >
                <title>
                  Rango empírico al horizonte: {number(r.lower)}–{number(r.upper)} kg
                </title>
              </line>
            </g>
          ))}
        <path d={line(trend)} className="fit-line" />
        <path d={line(forecast)} className="forecast-line" />
        {observations.map((p, i) => (
          <circle key={i} cx={x(p.date)} cy={y(p.value)} r="4" className="observed-dot">
            <title>
              {p.date}: {number(p.value)} kg · observado
            </title>
          </circle>
        ))}
        <text x="60" y="278">
          {dateLabel(new Date(a).toISOString().slice(0, 10))}
        </text>
        <text x="900" y="278" textAnchor="end">
          {dateLabel(new Date(b).toISOString().slice(0, 10))}
        </text>
      </svg>
      <figcaption>
        <span>● Observado</span>
        {trend.length > 0 && <span>━ Tendencia ajustada</span>}
        {forecast.length > 0 && <span>┄ Proyección condicional</span>}
        {!!range.length && <span>▰ Rango del backend</span>}
      </figcaption>
    </figure>
  );
}
export function PerformanceCurve({
  id,
  exercise,
  variant,
  method,
  from,
  to,
  historical,
  cutoff,
}: {
  id: string;
  exercise: string;
  variant: string;
  method: string;
  from: string;
  to: string;
  historical: Point[];
  cutoff: string;
}) {
  const [horizon, setHorizon] = useState('28');
  const data = useLoad(
    () =>
      projectionVariable(method)
        ? fetchProjection(id, {
            exercise,
            variantKey: variant,
            variable: projectionVariable(method)!,
            cutoff,
            from,
            to,
            horizonDays: horizon,
            scope: 'history',
          })
        : Promise.resolve(null),
    [id, exercise, variant, method, from, to, horizon, cutoff],
  );
  const p = data.data;
  return (
    <div className="curve-module">
      <div className="row between">
        <span className="chip">e1RM · estimación · proyección experimental</span>
        <label>
          Horizonte
          <select value={horizon} onChange={(e) => setHorizon(e.target.value)}>
            <option value="14">14 días</option>
            <option value="28">28 días</option>
            <option value="56">56 días</option>
          </select>
        </label>
      </div>
      <Curve
        observations={p?.observations ?? historical}
        trend={p?.trend}
        forecast={p?.forecast}
        range={p?.range}
        cutoff={p?.cutoff ?? cutoff}
      />
      {data.loading && (
        <p role="status" className="small muted">
          Actualizando curva…
        </p>
      )}
      {data.error && (
        <p role="alert" className="message error">
          {data.error}
          <button onClick={data.reload}>Reintentar</button>
        </p>
      )}
      {p ? (
        <>
          {p.rangeWarnings.map((r, i) => (
            <p className="message" key={i}>
              {r.message}
            </p>
          ))}
          {p.range.length > 0 && p.rangeLabel && <p className="small muted">{p.rangeLabel}</p>}
          <div className="curve-summary">
            <div>
              <small>TENDENCIA</small>
              <strong>{p.summary.trend.label}</strong>
            </div>
            <div>
              <small>
                {p.selectedBaseline
                  ? 'Proyección de mantenimiento del nivel reciente'
                  : 'PROYECCIÓN CONDICIONAL'}
              </small>
              <strong>
                {p.summary.projection
                  ? `${number(p.summary.projection.valueKg)} kg · ${p.summary.projection.horizonDays} días`
                  : 'No disponible'}
              </strong>
            </div>
            <div>
              <small>DATOS</small>
              <strong>
                {p.quality.exposures} exposiciones · {p.quality.sufficiency}
              </strong>
            </div>
          </div>
          <p className="curve-limit">{p.summary.limitation}</p>
          {p.summary.projection && (
            <p className="small muted">
              Referencia de partida: {number(p.summary.projection.baselineKg)} kg →{' '}
              {number(p.summary.projection.valueKg)} kg proyectados.
            </p>
          )}
          {p.range.length > 0 && <p className="small muted">{p.rangeNotice}</p>}
          {p.baseline && (
            <p className="small muted">
              Referencia: baseline. Sin mejora demostrada frente a esa referencia.
            </p>
          )}
          {p.reasons.length > 0 && (
            <details>
              <summary>Advertencias y disponibilidad · {p.reasons.length}</summary>
              <ul>
                {p.reasons.map((r) => (
                  <li key={r.code}>{r.message}</li>
                ))}
              </ul>
            </details>
          )}
          <details>
            <summary>Método, calidad y alcance del ajuste</summary>
            <Detail
              value={{ metodo: p.method, periodos: p.periods, calidad: p.quality, resumen: p.summary }}
            />
          </details>
        </>
      ) : (
        !data.loading &&
        !data.error && (
          <p className="small muted">
            Histórico observado. La proyección todavía no está disponible en este servidor.
          </p>
        )
      )}
    </div>
  );
}
