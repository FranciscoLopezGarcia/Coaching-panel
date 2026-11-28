import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { Annotation } from './OverviewChart';
import { dateLabel, number } from './ui';

/**
 * Gráficos grandes del analizador de bloques. SOLO presentan lo que entrega la API (no recalculan).
 * Color = DIRECCIÓN del cambio contra el bloque anterior (celeste sube, naranja baja, gris sin cambio): no es un juicio de «mejor/peor».
 * El máximo e1RM observado lleva su propio color y tipografía (clase `e1rm-max`, variable `--e1rm-max`).
 */
export const DIR_COLOR = { up: 'var(--c-steel)', down: 'var(--c-bone)', flat: 'var(--c-gray)' } as const;
export type Dir = keyof typeof DIR_COLOR;
export const dirOf = (n: number | null | undefined): Dir =>
  n == null || n === 0 ? 'flat' : n > 0 ? 'up' : 'down';
export const arrowOf = (d: Dir) => (d === 'up' ? '↑' : d === 'down' ? '↓' : '=');
const BLOCK_COLORS = ['var(--c-gray)', 'var(--c-steel)', 'var(--c-bone)', 'var(--c-steel-dk)'];
const ZONE_COLORS = [
  'var(--c-gray)',
  'var(--c-steel-dk)',
  'var(--c-steel)',
  'var(--c-bone)',
  'var(--accent)',
];

export interface CDelta {
  abs: number | null;
  pct: number | null;
  unit: string;
  status: string;
}
export interface CRow {
  metricId: string;
  unit: string;
  values: (number | null)[];
  deltas: CDelta[];
  /** Semanas de cada bloque (rango, mediana y valores con fecha real). */
  spread: (CSpread | null)[];
}
export interface CBlock {
  blockKey: string;
  start: string;
  end: string;
  weeks: number;
  closed: boolean;
}

export function deltaText(d: CDelta | undefined): string {
  if (!d) return '';
  if (d.status === 'no_comparable' || d.status === 'incompatible_metric_family') return 'No comparable';
  if (d.abs === null) return '—';
  const sign = d.abs > 0 ? '+' : '';
  const unit = d.unit === '%1RM' || d.unit === '%' ? ' pp' : '';
  const pct = d.pct === null ? '' : ` (${d.pct > 0 ? '+' : ''}${number(d.pct, 1)}%)`;
  return `${sign}${number(d.abs, 1)}${unit}${pct}`;
}

/** Etiqueta de cambio coloreada (flecha + número). */
export function DeltaTag({ d }: { d: CDelta | undefined }) {
  if (!d) return null;
  const dir = d.status === 'ok' || d.status === 'nuevo' ? dirOf(d.abs) : 'flat';
  return (
    <span className={`delta-tag d-${dir}`}>
      <b>{arrowOf(dir)}</b> {deltaText(d)}
    </span>
  );
}

/* ---------- tooltip ---------- */
function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; node: ReactNode } | null>(null);
  const show = (e: MouseEvent, node: ReactNode) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, node });
  };
  const view = tip && (
    <div
      className="chart-tip"
      style={{
        left: tip.x,
        top: tip.y,
        transform: `translate(${tip.x > 480 ? 'calc(-100% - 14px)' : '14px'}, 12px)`,
      }}
    >
      {tip.node}
    </div>
  );
  return { ref, show, hide: () => setTip(null), view };
}

function niceScale(lo: number, hi: number, n = 4) {
  if (hi === lo) hi = lo + (Math.abs(lo) || 1);
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = a; t <= b + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { a, b, ticks };
}
const decimals = (id: string) => (id === 'tonnage_per_week' ? 0 : 1);

/* ---------- 1) gráfico grande de una métrica entre bloques: velas de rango + línea de valores ---------- */
/**
 * Cada bloque es una «vela»: el trazo va del mínimo al máximo de sus semanas, la marca horizontal es la mediana semanal y el punto es el
 * valor del bloque (el que usan los cambios entre bloques). Los puntos se unen con una línea coloreada por la dirección del cambio.
 * Con 4–6 semanas por bloque no se dibujan cuartiles: sería precisión inventada. Bloque sin datos = marca «No observada», nunca cero.
 */
export interface CSpread {
  points: { week: number; date: string; value: number | null }[];
  n: number;
  min: number | null;
  median: number | null;
  max: number | null;
}
const hasRange = (sp: CSpread | null | undefined): sp is CSpread =>
  !!sp && sp.min !== null && sp.max !== null && sp.median !== null;

/** Escala vertical que cubre los rangos semanales y los valores de bloque (no parte de cero: la posición, no el largo, comunica). */
function fitScale(row: CRow) {
  const all = [
    ...row.values.filter((v): v is number => v !== null),
    ...row.spread.flatMap((sp) => (hasRange(sp) ? [sp.min as number, sp.max as number] : [])),
  ];
  if (!all.length) return niceScale(0, 1);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.18;
  return niceScale(lo - pad, hi + pad);
}

function RangeTip({
  b,
  i,
  row,
  d,
  dec,
}: {
  b: CBlock;
  i: number;
  row: CRow;
  d: CDelta | undefined;
  dec: number;
}) {
  const v = row.values[i] ?? null;
  const sp = row.spread[i];
  const dir = d && (d.status === 'ok' || d.status === 'nuevo') ? dirOf(d.abs) : 'flat';
  return (
    <>
      <strong>
        B{i} · {b.blockKey}
      </strong>
      <div>
        {dateLabel(b.start)} a {dateLabel(b.end)} · {b.weeks} sem{b.closed ? '' : ' · en curso'}
      </div>
      <div className="tip-big">
        {v === null ? 'No observada' : `${number(v, dec)} ${row.unit} (valor del bloque)`}
      </div>
      {hasRange(sp) && (
        <div>
          semanas: {number(sp.min as number, dec)} – {number(sp.max as number, dec)} · mediana{' '}
          {number(sp.median as number, dec)} · {sp.n} con dato
        </div>
      )}
      {d && (
        <div style={{ color: DIR_COLOR[dir] }}>
          {arrowOf(dir)} {deltaText(d)} vs B{i - 1}
        </div>
      )}
    </>
  );
}

export function MetricChart({ row, label, blocks }: { row: CRow; label: string; blocks: CBlock[] }) {
  const t = useTip();
  const W = 960;
  const H = 380;
  const m = { l: 70, r: 24, t: 44, b: 96 };
  const sc = fitScale(row);
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const band = pw / Math.max(1, blocks.length);
  const cap = Math.min(46, band * 0.22);
  const x = (i: number) => m.l + band * (i + 0.5);
  const y = (v: number) => m.t + ph - ((v - sc.a) / (sc.b - sc.a)) * ph;
  const dec = decimals(row.metricId);
  const line = row.values.flatMap((v, i) => (v === null ? [] : [{ i, v }]));
  return (
    <div className="chart-box" ref={t.ref} onMouseLeave={t.hide}>
      <div className="chart-head">
        <h4>{label}</h4>
        <span className="muted small">
          {row.unit} · trazo = rango de las semanas · marca = mediana · punto = valor del bloque
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={`${label} por bloque`}>
        {sc.ticks.map((tk) => (
          <g key={tk}>
            <line x1={m.l} x2={W - m.r} y1={y(tk)} y2={y(tk)} className="chart-grid" />
            <text x={m.l - 10} y={y(tk) + 4} className="chart-axis" textAnchor="end">
              {number(tk, tk % 1 ? 1 : 0)}
            </text>
          </g>
        ))}
        {line.slice(1).map((p, k) => {
          const a = line[k]!;
          const d = row.deltas[p.i - 1];
          const dir = d && (d.status === 'ok' || d.status === 'nuevo') ? dirOf(p.v - a.v) : 'flat';
          return (
            <line
              key={p.i}
              x1={x(a.i)}
              y1={y(a.v)}
              x2={x(p.i)}
              y2={y(p.v)}
              stroke={DIR_COLOR[dir]}
              strokeWidth={3}
              strokeLinecap="round"
              className="chart-link"
            />
          );
        })}
        {blocks.map((b, i) => {
          const v = row.values[i] ?? null;
          const sp = row.spread[i];
          const d = i > 0 ? row.deltas[i - 1] : undefined;
          const dir = d && (d.status === 'ok' || d.status === 'nuevo') ? dirOf(d.abs) : 'flat';
          const color = BLOCK_COLORS[i % 4];
          return (
            <g
              key={b.blockKey}
              className="chart-hit"
              onMouseMove={(e) => t.show(e, <RangeTip b={b} i={i} row={row} d={d} dec={dec} />)}
            >
              <rect x={x(i) - band / 2} y={m.t} width={band} height={ph} className="chart-band" />
              {v === null ? (
                <>
                  <rect
                    x={x(i) - cap}
                    y={m.t + ph - 3}
                    width={cap * 2}
                    height={3}
                    className="chart-missing"
                  />
                  <text x={x(i)} y={m.t + ph - 12} textAnchor="middle" className="chart-note">
                    No observada
                  </text>
                </>
              ) : (
                <>
                  {hasRange(sp) && (
                    <>
                      <rect
                        x={x(i) - 9}
                        y={y(sp.max as number)}
                        width={18}
                        height={Math.max(2, y(sp.min as number) - y(sp.max as number))}
                        fill={color}
                        opacity={b.closed ? 0.32 : 0.16}
                        stroke={color}
                        strokeWidth={1.5}
                        strokeDasharray={b.closed ? undefined : '5 3'}
                      />
                      <line
                        x1={x(i) - cap * 0.5}
                        x2={x(i) + cap * 0.5}
                        y1={y(sp.max as number)}
                        y2={y(sp.max as number)}
                        stroke={color}
                        strokeWidth={2}
                      />
                      <line
                        x1={x(i) - cap * 0.5}
                        x2={x(i) + cap * 0.5}
                        y1={y(sp.min as number)}
                        y2={y(sp.min as number)}
                        stroke={color}
                        strokeWidth={2}
                      />
                      <line
                        x1={x(i) - cap}
                        x2={x(i) + cap}
                        y1={y(sp.median as number)}
                        y2={y(sp.median as number)}
                        stroke="var(--c-bone)"
                        strokeWidth={3}
                      />
                    </>
                  )}
                  <circle cx={x(i)} cy={y(v)} r={6} className="chart-dot" />
                  <text
                    x={x(i)}
                    y={y(hasRange(sp) ? (sp.max as number) : v) - 12}
                    textAnchor="middle"
                    className="chart-val"
                  >
                    {number(v, dec)}
                  </text>
                </>
              )}
              <text x={x(i)} y={H - 62} textAnchor="middle" className="chart-xl">
                B{i} · {b.blockKey}
              </text>
              <text x={x(i)} y={H - 46} textAnchor="middle" className="chart-note">
                {dateLabel(b.start)}–{dateLabel(b.end)}
              </text>
              {d && (
                <text x={x(i)} y={H - 20} textAnchor="middle" className="chart-delta" fill={DIR_COLOR[dir]}>
                  {arrowOf(dir)} {deltaText(d)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {t.view}
    </div>
  );
}

/* ---------- 3) zonas de intensidad: barras apiladas por bloque + cambios en pp ---------- */
export interface CZones {
  cuts: number[];
  byBlock: {
    blockKey: string;
    withRef: number;
    withoutRef: number;
    zones: {
      zone: number;
      label: string;
      range: string;
      sets: number;
      reps: number;
      shareSets: number | null;
    }[];
  }[];
}
export function ZonesChart({ zones, blocks }: { zones: CZones; blocks: CBlock[] }) {
  const t = useTip();
  const nz = zones.byBlock[0]?.zones.length ?? 0;
  return (
    <div className="chart-box" ref={t.ref} onMouseLeave={t.hide}>
      <div className="chart-head">
        <h4>Distribución por zonas de intensidad</h4>
        <span className="muted small">% de series con referencia · cortes {zones.cuts.join(' · ')} %1RM</span>
      </div>
      <div className="zone-legend">
        {(zones.byBlock[0]?.zones ?? []).map((z, i) => (
          <span key={z.zone}>
            <i style={{ background: ZONE_COLORS[i % 5] }} /> {z.label} · {z.range} %1RM
          </span>
        ))}
      </div>
      {zones.byBlock.map((bz, bi) => {
        const prev = zones.byBlock[bi - 1];
        const b = blocks[bi];
        return (
          <div className="zone-row" key={bz.blockKey}>
            <div className="zone-label">
              <strong>
                B{bi} · {bz.blockKey}
              </strong>
              <span className="muted small">{b ? `${dateLabel(b.start)}–${dateLabel(b.end)}` : ''}</span>
            </div>
            <div className="zone-bar">
              {bz.withRef === 0 ? (
                <span className="muted small">Sin series con referencia fechada</span>
              ) : (
                bz.zones.map((z, i) =>
                  z.shareSets === null || z.shareSets === 0 ? null : (
                    <div
                      key={z.zone}
                      className="zone-seg"
                      style={{ width: `${100 * z.shareSets}%`, background: ZONE_COLORS[i % 5] }}
                      onMouseMove={(e) =>
                        t.show(
                          e,
                          <>
                            <strong>
                              {z.label} · {z.range} %1RM
                            </strong>
                            <div className="tip-big">{number(100 * z.shareSets!, 0)}% de las series</div>
                            <div>
                              {z.sets} series · {z.reps} reps
                            </div>
                          </>,
                        )
                      }
                    >
                      {z.shareSets > 0.08 ? `${number(100 * z.shareSets, 0)}%` : ''}
                    </div>
                  ),
                )
              )}
            </div>
            <div className="zone-deltas">
              {prev && nz > 0 ? (
                bz.zones.map((z, i) => {
                  const pz = prev.zones[i];
                  if (!pz || z.shareSets === null || pz.shareSets === null)
                    return (
                      <span key={i} className="delta-tag d-flat">
                        —
                      </span>
                    );
                  const pp = 100 * (z.shareSets - pz.shareSets);
                  const dir = Math.abs(pp) < 0.5 ? 'flat' : dirOf(pp);
                  return (
                    <span
                      key={i}
                      className={`delta-tag d-${dir}`}
                      title={`${z.label}: cambio en puntos porcentuales vs B${bi - 1}`}
                    >
                      <i style={{ background: ZONE_COLORS[i % 5] }} /> {arrowOf(dir)} {pp > 0 ? '+' : ''}
                      {number(pp, 0)} pp
                    </span>
                  );
                })
              ) : (
                <span className="muted small">referencia</span>
              )}
            </div>
          </div>
        );
      })}
      {t.view}
    </div>
  );
}

/* ---------- 4) cumplimiento: apilado por bloque + semana a semana ---------- */
export interface CCompliance {
  blockKey: string;
  weeks: {
    weekNo: number;
    setsPlanned: number;
    setsDone: number;
    setsSkipped: number;
    setsUnknown: number;
    setsDoneShare: number | null;
  }[];
  total: {
    setsPlanned: number;
    setsDone: number;
    setsSkipped: number;
    setsUnknown: number;
    sessionsPlanned: number;
    sessionsWithWork: number;
  };
}
const C_DONE = 'var(--c-steel)';
const C_SKIP = 'var(--c-bone)';
const C_UNK = 'var(--c-gray)';
export function ComplianceChart({ data, blocks }: { data: CCompliance[]; blocks: CBlock[] }) {
  const t = useTip();
  const pctOf = (a: number, b: number) => (b ? (100 * a) / b : 0);
  return (
    <div className="chart-box" ref={t.ref} onMouseLeave={t.hide}>
      <div className="chart-head">
        <h4>Cumplimiento: previsto vs hecho</h4>
        <span className="muted small">
          el % = hechas / previstas al corte (cuenta las sin registro); «sin registro» no es «omitida» ni
          «hecha»
        </span>
      </div>
      <div className="zone-legend">
        <span>
          <i style={{ background: C_DONE }} /> Hechas
        </span>
        <span>
          <i style={{ background: C_SKIP }} /> Omitidas
        </span>
        <span>
          <i style={{ background: C_UNK }} /> Sin registro
        </span>
      </div>
      {data.map((c, bi) => {
        const p = c.total.setsPlanned;
        const prev = data[bi - 1];
        const share = p ? c.total.setsDone / p : null;
        const pshare = prev && prev.total.setsPlanned ? prev.total.setsDone / prev.total.setsPlanned : null;
        const pp = share !== null && pshare !== null ? 100 * (share - pshare) : null;
        const dir = pp === null || Math.abs(pp) < 0.5 ? 'flat' : dirOf(pp);
        const seg = (n: number, color: string, label: string) =>
          n === 0 ? null : (
            <div
              className="zone-seg"
              style={{ width: `${pctOf(n, p)}%`, background: color }}
              onMouseMove={(e) =>
                t.show(
                  e,
                  <>
                    <strong>
                      B{bi} · {c.blockKey}
                    </strong>
                    <div className="tip-big">
                      {n} series {label}
                    </div>
                    <div>
                      de {p} previstas · sesiones con trabajo {c.total.sessionsWithWork}/
                      {c.total.sessionsPlanned}
                    </div>
                  </>,
                )
              }
            >
              {pctOf(n, p) > 9 ? `${number(pctOf(n, p), 0)}%` : ''}
            </div>
          );
        return (
          <div className="zone-row" key={c.blockKey}>
            <div className="zone-label">
              <strong>
                B{bi} · {c.blockKey}
              </strong>
              <span className="muted small">
                {blocks[bi] ? `${dateLabel(blocks[bi]!.start)}–${dateLabel(blocks[bi]!.end)}` : ''}
              </span>
            </div>
            <div className="zone-bar">
              {p === 0 ? (
                <span className="muted small">Sin series previstas hasta el corte</span>
              ) : (
                <>
                  {seg(c.total.setsDone, C_DONE, 'hechas')}
                  {seg(c.total.setsSkipped, C_SKIP, 'omitidas')}
                  {seg(c.total.setsUnknown, C_UNK, 'sin registro')}
                </>
              )}
            </div>
            <div className="zone-deltas">
              <span className="ba-val">{share === null ? '—' : `${number(100 * share, 0)}%`}</span>
              {pp !== null && (
                <span className={`delta-tag d-${dir}`}>
                  <b>{arrowOf(dir)}</b> {pp > 0 ? '+' : ''}
                  {number(pp, 0)} pp
                </span>
              )}
            </div>
          </div>
        );
      })}
      {t.view}
    </div>
  );
}

/* ---------- 5) e1RM a lo largo de los bloques (un gráfico grande por movimiento) ---------- */
export interface CVariant {
  lift: string;
  variantKey: string;
  exerciseName: string;
  blockKey: string;
  weekly: { week: number; e1rm: number; n: number; lastDate: string; rpeMin: number; rpeMax: number }[];
  bestKg: number | null;
  bestWeek: number | null;
}
const LINE_COLORS = [
  'var(--c-steel)',
  'var(--c-bone)',
  'var(--c-gray)',
  'var(--c-steel-dk)',
  'var(--accent)',
  'var(--muted)',
];
export function E1rmChart({
  lift,
  variants,
  blocks,
  marks = [],
}: {
  lift: string;
  variants: CVariant[];
  blocks: CBlock[];
  /** Cambios de plan: se ubican dentro del bloque que los contiene, por fecha. */
  marks?: Annotation[];
}) {
  const t = useTip();
  const mine = variants.filter((v) => v.lift === lift && v.weekly.length);
  if (!mine.length) return null;
  const offsets: number[] = [];
  let acc = 0;
  for (const b of blocks) {
    offsets.push(acc);
    acc += Math.max(1, b.weeks);
  }
  const total = Math.max(1, acc);
  const names = [...new Set(mine.map((v) => v.variantKey))];
  const pts = mine.flatMap((v) => {
    const bi = blocks.findIndex((b) => b.blockKey === v.blockKey);
    return v.weekly.map((p) => ({ v, p, x: offsets[bi]! + p.week - 1, bi }));
  });
  const all = pts.map((q) => q.p.e1rm);
  const sc = niceScale(Math.min(...all) - 4, Math.max(...all) + 4);
  const W = 960;
  const H = 340;
  const m = { l: 62, r: 20, t: 24, b: 56 };
  const X = (i: number) => m.l + ((i + 0.5) / total) * (W - m.l - m.r);
  const Y = (v: number) => m.t + (H - m.t - m.b) * (1 - (v - sc.a) / (sc.b - sc.a));
  const bestAll = Math.max(...all);
  return (
    <div className="chart-box" ref={t.ref} onMouseLeave={t.hide}>
      <div className="chart-head">
        <h4>e1RM semanal · {lift === 'SQ' ? 'Sentadilla' : lift === 'BP' ? 'Banca' : 'Peso muerto'}</h4>
        <span className="muted small">
          máximo observado por semana (curva RPE con RPE real) · hueco = semana sin registro · punto verde =
          máximo observado
        </span>
      </div>
      <div className="zone-legend">
        {names.map((n, i) => (
          <span key={n}>
            <i style={{ background: LINE_COLORS[i % 6] }} />{' '}
            {mine.find((v) => v.variantKey === n)?.exerciseName ?? n}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={`e1RM de ${lift}`}>
        {blocks.map((b, bi) => (
          <g key={b.blockKey}>
            <rect
              x={X(offsets[bi]!) - (W - m.l - m.r) / total / 2}
              y={m.t}
              width={((W - m.l - m.r) / total) * Math.max(1, b.weeks)}
              height={H - m.t - m.b}
              fill={BLOCK_COLORS[bi % 4]}
              opacity={bi % 2 ? 0.1 : 0.04}
            />
            <text
              x={X(offsets[bi]! + Math.max(1, b.weeks) / 2 - 0.5)}
              y={H - 30}
              textAnchor="middle"
              className="chart-xl"
            >
              B{bi} · {b.blockKey}
            </text>
            <text
              x={X(offsets[bi]! + Math.max(1, b.weeks) / 2 - 0.5)}
              y={H - 14}
              textAnchor="middle"
              className="chart-note"
            >
              {b.weeks} sem
            </text>
          </g>
        ))}
        {sc.ticks.map((tk) => (
          <g key={tk}>
            <line x1={m.l} x2={W - m.r} y1={Y(tk)} y2={Y(tk)} className="chart-grid" />
            <text x={m.l - 8} y={Y(tk) + 4} className="chart-axis" textAnchor="end">
              {number(tk, 0)}
            </text>
          </g>
        ))}
        {marks.flatMap((mk, k) => {
          const bi = blocks.findIndex((b) => mk.date >= b.start && mk.date <= b.end);
          if (bi < 0) return [];
          const wk = (Date.parse(mk.date) - Date.parse(blocks[bi]!.start)) / (7 * 864e5);
          const px = X(offsets[bi]! + Math.min(wk, Math.max(1, blocks[bi]!.weeks)) - 0.5);
          return [
            <g key={`mk${k}`}>
              <title>{`${mk.label} · rige desde ${dateLabel(mk.date)}`}</title>
              <line
                x1={px}
                x2={px}
                y1={m.t}
                y2={H - m.b}
                stroke="var(--accent)"
                strokeWidth={1.4}
                strokeDasharray="5 4"
              />
              <text
                x={px + 4}
                y={m.t + 14 + (k % 3) * 12}
                className="chart-note"
                style={{ fill: 'var(--accent)' }}
              >
                {mk.label}
              </text>
            </g>,
          ];
        })}
        {names.map((n, ni) => {
          const mineV = pts.filter((q) => q.v.variantKey === n).sort((a, b) => a.x - b.x);
          const segs: (typeof mineV)[] = [];
          let cur: typeof mineV = [];
          for (const q of mineV) {
            if (cur.length && q.x !== cur.at(-1)!.x + 1) {
              segs.push(cur);
              cur = [];
            }
            cur.push(q);
          }
          if (cur.length) segs.push(cur);
          return (
            <g key={n}>
              {segs.map((s, si) =>
                s.length > 1 ? (
                  <polyline
                    key={si}
                    points={s.map((q) => `${X(q.x)},${Y(q.p.e1rm)}`).join(' ')}
                    fill="none"
                    stroke={LINE_COLORS[ni % 6]}
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                  />
                ) : null,
              )}
              {mineV.map((q) => {
                const best = q.p.e1rm === bestAll && q.v.bestWeek === q.p.week;
                return (
                  <circle
                    key={`${q.v.blockKey}${q.p.week}`}
                    cx={X(q.x)}
                    cy={Y(q.p.e1rm)}
                    r={best ? 7 : 4.5}
                    fill={best ? 'var(--e1rm-max)' : LINE_COLORS[ni % 6]}
                    stroke="var(--bg)"
                    strokeWidth={1.5}
                    className="chart-pt"
                    onMouseMove={(e) =>
                      t.show(
                        e as unknown as MouseEvent,
                        <>
                          <strong>{q.v.exerciseName}</strong>
                          <div>
                            {q.v.blockKey} · S{q.p.week} · {dateLabel(q.p.lastDate)}
                          </div>
                          <div className="tip-big">{number(q.p.e1rm, 1)} kg</div>
                          <div>
                            n={q.p.n} · RPE {q.p.rpeMin}–{q.p.rpeMax}
                          </div>
                        </>,
                      )
                    }
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      {t.view}
    </div>
  );
}
