import { fmt } from '../labels';

export interface Point {
  x: string;
  y: number;
}

/** Gráfico de línea simple en SVG. Eje X por fecha (orden cronológico, espaciado temporal); solo muestra una magnitud por gráfico. */
export function LineChart({ points, label, unit }: { points: Point[]; label: string; unit: string }) {
  if (points.length < 2) return <p className="muted small">{label}: se necesitan al menos 2 puntos.</p>;
  const W = 640;
  const H = 180;
  const pad = { l: 44, r: 12, t: 12, b: 24 };
  const ys = points.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const times = points.map((p) => Date.parse(p.x));
  const first = times[0]!;
  const duration = times.at(-1)! - first || 1;
  const x = (i: number) => pad.l + ((times[i]! - first) * (W - pad.l - pad.r)) / duration;
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  return (
    <figure className="chart">
      <figcaption className="small muted">
        {label} ({unit})
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}: de ${fmt(points[0]?.y)} a ${fmt(points.at(-1)?.y)} ${unit}`}
      >
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="axis" />
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} className="axis" />
        <text x={4} y={y(hi) + 4} className="tick">
          {fmt(hi)}
        </text>
        <text x={4} y={y(lo) + 4} className="tick">
          {fmt(lo)}
        </text>
        <text x={pad.l} y={H - 6} className="tick">
          {points[0]?.x}
        </text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" className="tick">
          {points.at(-1)?.x}
        </text>
        <path d={d} className="line" fill="none" />
        {points.map((p, i) => (
          <circle key={p.x + i} cx={x(i)} cy={y(p.y)} r={3} className="dot">
            <title>{`${p.x}: ${fmt(p.y)} ${unit}`}</title>
          </circle>
        ))}
      </svg>
    </figure>
  );
}
