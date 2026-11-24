import { useRef, useState } from 'react';
import { usePlanMarks } from './planMarks';
import { number } from './ui';
export interface Trace {
  label: string;
  color: string;
  points: { date: string; value: number | null }[];
  dashed?: boolean;
  dotsOnly?: boolean;
  /** Texto de la leyenda para una serie punteada (por defecto «total»). */
  legend?: string;
}
/** Marca vertical punteada en una fecha (p. ej. un cambio de plan). */
export interface Annotation {
  date: string;
  label: string;
  /** La fecha de vigencia es una estimación. */
  estimated?: boolean;
}
/** Banda horizontal de referencia (p. ej. desde el umbral configurado hacia arriba). */
export interface Threshold {
  from: number;
  to: number;
  label: string;
  color: string;
}
const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const short = (d: string) =>
  new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    .format(new Date(d + 'T12:00:00Z'))
    .replace('.', '');
const long = (d: string) =>
  new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(d + 'T12:00:00Z'));

/** Gráfico de líneas grande. Al pasar el mouse muestra una guía vertical y el detalle de cada serie en esa fecha (valor, cambio vs el punto anterior, mejor y promedio). */
export function OverviewChart({
  title,
  unit,
  traces,
  period,
  bands,
  zoom,
  onPick,
  highlight,
  annotations,
  thresholds,
  area,
  domain,
  height,
  width,
  linkedDate,
  onHoverDate,
}: {
  title: string;
  unit: string;
  traces: Trace[];
  period?: { from: string; to: string };
  /** Franjas de fondo (p. ej. un color por bloque). */
  bands?: { from: string; to: string; color: string; label: string }[];
  /** El eje vertical no parte de 0: se ajusta al rango de los datos (para ver evoluciones de e1RM). */
  zoom?: boolean;
  /** Clic en el gráfico: devuelve la fecha del punto más cercano. */
  onPick?: (date: string) => void;
  /** Fecha (inicio de semana) a destacar con una franja de color. */
  highlight?: string;
  /** Líneas verticales punteadas con rótulo (cambios de plan). */
  annotations?: Annotation[];
  /** Bandas horizontales de referencia. Los umbrales los define el coach: no se infieren. */
  thresholds?: Threshold[];
  /** Rellena el área bajo cada serie (no solo cuando hay una). */
  area?: boolean;
  /** Fija el eje vertical (p. ej. escalas 1–10). */
  domain?: [number, number];
  /** Alto del gráfico en unidades del viewBox (por defecto 340). */
  height?: number;
  /** Ancho del viewBox (por defecto 720): más ancho = letras más chicas en pantallas grandes. */
  width?: number;
  /** Fecha resaltada desde afuera (p. ej. la fila de la tabla vinculada): dibuja la guía y agranda los puntos de esa fecha. */
  linkedDate?: string | null;
  /** Avisa la fecha bajo el cursor (o null al salir), para resaltar la fila de la tabla vinculada. */
  onHoverDate?: (date: string | null) => void;
}) {
  const planChanges = usePlanMarks();
  const marks = annotations ?? planChanges;
  const box = useRef<HTMLElement | null>(null);
  const [hover, setHover] = useState<{ date: string; left: number } | null>(null);
  const values = traces.flatMap((t) => t.points.flatMap((p) => (p.value === null ? [] : [p.value])));
  if (!values.length) return <p className="small chart-empty">Sin registros comparables.</p>;
  const dates = traces.flatMap((t) =>
    t.points.filter((p) => p.value !== null).map((p) => Date.parse(p.date)),
  );
  const a = Math.min(period ? Date.parse(period.from) : Infinity, ...dates);
  const b = Math.max(period ? Date.parse(period.to) : -Infinity, ...dates);
  const vmin = Math.min(...values);
  const rawHigh = Math.max(...values);
  const span = Math.max(rawHigh - vmin, rawHigh * 0.05, 1);
  const low = domain
    ? domain[0]
    : zoom
      ? Math.max(0, Math.floor((vmin - span * 0.25) / 5) * 5)
      : Math.min(0, vmin);
  const high = domain ? domain[1] : zoom ? rawHigh + span * 0.2 : rawHigh * 1.08 || 1;
  const W = width ?? 720;
  const H = height ?? 340;
  const L = 62;
  const R = 16;
  const T = 16;
  const B = H - 44;
  const x = (date: string) => L + ((Date.parse(date) - a) / Math.max(b - a, DAY)) * (W - L - R);
  const y = (value: number) => B - ((value - low) / Math.max(high - low, 1e-9)) * (B - T);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => low + (high - low) * f);
  const xt = Array.from({ length: 5 }, (_, i) => a + ((b - a) * i) / 4);
  const live = traces.filter((t) => t.points.some((p) => p.value !== null));
  const single = live.length === 1;
  const allDates = [
    ...new Set(live.flatMap((t) => t.points.filter((p) => p.value !== null).map((p) => p.date))),
  ].sort();
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = allDates[0] as string;
    for (const d of allDates) if (Math.abs(x(d) - vx) < Math.abs(x(best) - vx)) best = d;
    setHover({ date: best, left: (x(best) / W) * r.width });
    onHoverDate?.(best);
  };
  const guide = hover?.date ?? linkedDate ?? null;
  const detail = (t: Trace) => {
    const pts = t.points.filter((p) => p.value !== null) as { date: string; value: number }[];
    const i = pts.findIndex((p) => p.date === hover?.date);
    if (i < 0) return null;
    const cur = pts[i]!.value;
    const prev = i > 0 ? pts[i - 1]!.value : null;
    const best = Math.max(...pts.map((p) => p.value));
    const avg = pts.reduce((s, p) => s + p.value, 0) / pts.length;
    return { cur, prev, best, avg, n: i + 1, total: pts.length };
  };
  return (
    <figure className="overview-chart" ref={box} style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title} · ${unit}`}
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHover(null);
          onHoverDate?.(null);
        }}
        onClick={() => hover && onPick?.(hover.date)}
        style={onPick ? { cursor: 'pointer' } : undefined}
      >
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="curve-grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end">
              {number(v, rawHigh < 20 ? 1 : 0)}
            </text>
          </g>
        ))}
        {xt.map((ms, i) => (
          <text
            key={i}
            x={L + ((W - L - R) * i) / 4}
            y={B + 24}
            textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
          >
            {short(iso(ms))}
          </text>
        ))}
        {(bands ?? []).map((bd, i) => {
          const x1 = Math.max(L, x(bd.from));
          const x2 = Math.min(W - R, x(bd.to) + ((W - L - R) * 6 * DAY) / Math.max(b - a, DAY));
          return x2 > x1 ? (
            <g key={'b' + i}>
              <rect x={x1} y={T} width={x2 - x1} height={B - T} fill={bd.color} opacity="0.09" />
              <rect x={x1} y={T} width={x2 - x1} height={4} fill={bd.color} opacity="0.7" />
              {x2 - x1 > 78 && (
                <text x={x1 + 5} y={T + 17} className="band-label" style={{ fill: bd.color }}>
                  {bd.label}
                </text>
              )}
            </g>
          ) : null;
        })}
        {highlight && (
          <g>
            <rect
              x={x(highlight) - 6}
              y={T}
              width={Math.max(14, ((W - L - R) * 7 * DAY) / Math.max(b - a, DAY))}
              height={B - T}
              fill="var(--accent)"
              opacity="0.16"
            />
            <line
              x1={x(highlight)}
              x2={x(highlight)}
              y1={T}
              y2={B}
              stroke="var(--accent)"
              strokeWidth="2.5"
            />
          </g>
        )}
        {(thresholds ?? []).map((th, i) => {
          const y1 = y(Math.min(high, Math.max(low, th.to)));
          const y2 = y(Math.min(high, Math.max(low, th.from)));
          return y2 > y1 ? (
            <g key={'t' + i}>
              <rect x={L} y={y1} width={W - L - R} height={y2 - y1} fill={th.color} opacity="0.12" />
              <line x1={L} x2={W - R} y1={y2} y2={y2} stroke={th.color} strokeDasharray="5 4" opacity="0.8" />
              <text
                x={W - R - 4}
                y={y1 + 14}
                textAnchor="end"
                className="band-label"
                style={{ fill: th.color }}
              >
                {th.label}
              </text>
            </g>
          ) : null;
        })}
        {marks
          .filter((an) => Date.parse(an.date) >= a && Date.parse(an.date) <= b)
          .map((an, i) => (
            <g key={'a' + i} className="chart-annotation">
              <title>{`${an.label} · rige desde ${an.date}${an.estimated ? ' (fecha estimada)' : ''}`}</title>
              <line
                x1={x(an.date)}
                x2={x(an.date)}
                y1={T}
                y2={B}
                stroke="var(--accent)"
                strokeWidth={1.4}
                strokeDasharray={an.estimated ? '2 4' : '5 4'}
                opacity="0.85"
              />
              <text
                x={x(an.date) + 4}
                y={T + 31 + (i % 3) * 12}
                className="band-label"
                style={{ fill: 'var(--accent)' }}
              >
                {an.label}
              </text>
            </g>
          ))}
        {guide && Date.parse(guide) >= a && Date.parse(guide) <= b && (
          <line x1={x(guide)} x2={x(guide)} y1={T} y2={B} className="chart-guide" />
        )}
        {traces.map((t, i) => {
          const pts = t.points.filter((p) => p.value !== null) as { date: string; value: number }[];
          if (!pts.length) return null;
          let drawing = false;
          const path = t.points
            .map((p) => {
              if (p.value === null) {
                drawing = false;
                return '';
              }
              const command = drawing ? 'L' : 'M';
              drawing = true;
              return `${command}${x(p.date)},${y(p.value)}`;
            })
            .join(' ');
          return (
            <g key={i} style={{ color: t.color }}>
              {(single || area) && !t.dotsOnly && !t.dashed && pts.length > 1 && (
                <path
                  d={`M${x(pts[0]!.date)},${B} ${pts.map((p) => `L${x(p.date)},${y(p.value)}`).join(' ')} L${x(pts[pts.length - 1]!.date)},${B} Z`}
                  fill="currentColor"
                  opacity="0.12"
                />
              )}
              {!t.dotsOnly && (
                <path
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={t.dashed ? 2.4 : 3.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={t.dashed ? '6 5' : undefined}
                />
              )}
              {pts.map((p, j) => (
                <circle
                  key={j}
                  cx={x(p.date)}
                  cy={y(p.value)}
                  r={guide === p.date ? 7 : 4.8}
                  fill={guide === p.date ? 'currentColor' : 'var(--surface, #fff)'}
                  stroke="currentColor"
                  strokeWidth="2.6"
                />
              ))}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div
          className="chart-tip"
          style={{ left: Math.min(Math.max(hover.left + 14, 6), 9999) }}
          role="status"
        >
          <strong>{long(hover.date)}</strong>
          {live.map((t, i) => {
            const d = detail(t);
            if (!d) return null;
            const diff = d.prev === null ? null : d.cur - d.prev;
            return (
              <div className="chart-tip-row" key={i}>
                <span>
                  <i style={{ background: t.color }} /> {t.label}
                </span>
                <b>
                  {number(d.cur, 1)} {unit}
                </b>
                <small>
                  {diff === null
                    ? 'primer punto'
                    : `${diff >= 0 ? '▲' : '▼'} ${number(Math.abs(diff), 1)} (${d.prev ? number((diff / d.prev) * 100, 0) : '—'} %) vs anterior`}
                  {' · mejor '}
                  {number(d.best, 1)}
                  {' · prom. '}
                  {number(d.avg, 1)}
                  {` · punto ${d.n}/${d.total}`}
                </small>
              </div>
            );
          })}
        </div>
      )}
      <figcaption>
        {live.map((t, i) => (
          <span key={i}>
            <i style={{ background: t.color }} />
            {t.label}
            {t.dashed ? ` · ${t.legend ?? 'total'}` : ''}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
