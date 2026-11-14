import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { dateLabel, number } from './ui';

/**
 * Gráficos grandes del analizador de bloques. SOLO presentan lo que entrega la API (no recalculan).
 * Color = DIRECCIÓN del cambio contra el bloque anterior (celeste sube, naranja baja, gris sin cambio): no es un juicio de «mejor/peor».
 * El verde queda reservado para el máximo e1RM observado.
 */
export const DIR_COLOR = { up: '#4cc9f0', down: '#fb8f3c', flat: '#8a8d96' } as const;
export type Dir = keyof typeof DIR_COLOR;
export const dirOf = (n: number | null | undefined): Dir =>
  n == null || n === 0 ? 'flat' : n > 0 ? 'up' : 'down';
export const arrowOf = (d: Dir) => (d === 'up' ? '↗' : d === 'down' ? '↘' : '→');
const BLOCK_COLORS = ['#6b7a99', '#6d83f2', '#a07cf0', '#3fd0e0'];
const ZONE_COLORS = ['#4cc9f0', '#6d83f2', '#a07cf0', '#e879c6', '#fb8f3c'];

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
const decimals = (id: string) => (id === 'tonnage_per_week' || id === 'si_total_per_week' ? 0 : 1);

/* ---------- 1) gráfico grande de una métrica entre bloques ---------- */
export function MetricChart({ row, label, blocks }: { row: CRow; label: string; blocks: CBlock[] }) {
  const t = useTip();
  const [zoom, setZoom] = useState(false);
  const W = 960;
  const H = 380;
  const m = { l: 70, r: 24, t: 44, b: 96 };
  const vals = row.values.filter((v): v is number => v !== null);
  const hi = Math.max(...vals, 0);
  const lo = zoom && vals.length > 1 ? Math.min(...vals) - (Math.max(...vals) - Math.min(...vals)) * 0.4 : 0;
  const sc = niceScale(zoom ? lo : 0, hi * 1.08 || 1);
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const band = pw / Math.max(1, blocks.length);
  const bw = Math.min(130, band * 0.5);
  const x = (i: number) => m.l + band * (i + 0.5);
  const y = (v: number) => m.t + ph - ((v - sc.a) / (sc.b - sc.a)) * ph;
  const dec = decimals(row.metricId);
  const line = row.values.flatMap((v, i) => (v === null ? [] : [{ i, v }]));
  return (
    <div className="chart-box" ref={t.ref} onMouseLeave={t.hide}>
      <div className="chart-head">
        <h4>{label}</h4>
        <span className="muted small">
          {row.unit} · {zoom ? 'escala ajustada (no parte de cero)' : 'escala desde cero'}
        </span>
        <label className="chart-toggle">
          <input type="checkbox" checked={zoom} onChange={(e) => setZoom(e.target.checked)} /> Ajustar escala
        </label>
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
        {blocks.map((b, i) => {
          const v = row.values[i] ?? null;
          const d = i > 0 ? row.deltas[i - 1] : undefined;
          const dir = d && (d.status === 'ok' || d.status === 'nuevo') ? dirOf(d.abs) : 'flat';
          return (
            <g
              key={b.blockKey}
              className="chart-hit"
              onMouseMove={(e) =>
                t.show(
                  e,
                  <>
                    <strong>
                      B{i} · {b.blockKey}
                    </strong>
                    <div>
                      {dateLabel(b.start)} → {dateLabel(b.end)} · {b.weeks} sem
                    </div>
                    <div className="tip-big">
                      {v === null ? 'No observada' : `${number(v, dec)} ${row.unit}`}
                    </div>
                    {d && (
                      <div style={{ color: DIR_COLOR[dir] }}>
                        {arrowOf(dir)} {deltaText(d)} vs B{i - 1}
                      </div>
                    )}
                  </>,
                )
              }
            >
              <rect x={x(i) - band / 2} y={m.t} width={band} height={ph} className="chart-band" />
              {v === null ? (
                <>
                  <rect x={x(i) - bw / 2} y={m.t + ph - 3} width={bw} height={3} className="chart-missing" />
                  <text x={x(i)} y={m.t + ph - 12} textAnchor="middle" className="chart-note">
                    No observada
                  </text>
                </>
              ) : (
                <>
                  <rect
                    x={x(i) - bw / 2}
                    y={y(v)}
                    width={bw}
                    height={Math.max(2, m.t + ph - y(v))}
                    rx={6}
                    fill={BLOCK_COLORS[i % 4]}
                    opacity={b.closed ? 1 : 0.55}
                    strokeDasharray={b.closed ? undefined : '6 4'}
                    stroke={b.closed ? undefined : BLOCK_COLORS[i % 4]}
                  />
                  <text x={x(i)} y={y(v) - 10} textAnchor="middle" className="chart-val">
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
        {line.map((p) => (
          <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={5} className="chart-dot" />
        ))}
      </svg>
      {t.view}
    </div>
  );
}

/* ---------- 2) todas las métricas, cada una como mini-gráfico clickeable ---------- */
export function MetricGrid({
  rows,
  labels,
  blocks,
  selected,
  onSelect,
}: {
  rows: CRow[];
  labels: Record<string, string>;
  blocks: CBlock[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="metric-grid">
      {rows.map((r) => (
        <MiniBars
          key={r.metricId}
          row={r}
          label={labels[r.metricId] ?? r.metricId}
          blocks={blocks}
          on={selected === r.metricId}
          onSelect={() => onSelect(r.metricId)}
        />
      ))}
    </div>
  );
}
function MiniBars({
  row,
  label,
  blocks,
  on,
  onSelect,
}: {
  row: CRow;
  label: string;
  blocks: CBlock[];
  on: boolean;
  onSelect: () => void;
}) {
  const t = useTip();
  const W = 320;
  const H = 170;
  const vals = row.values.filter((v): v is number => v !== null);
  const hi = Math.max(...vals, 0) * 1.12 || 1;
  const band = (W - 20) / Math.max(1, blocks.length);
  const bw = band * 0.56;
  const dec = decimals(row.metricId);
  const last = row.deltas.at(-1);
  const lastDir = last && (last.status === 'ok' || last.status === 'nuevo') ? dirOf(last.abs) : 'flat';
  return (
    <button
      type="button"
      className={`mini-card ${on ? 'on' : ''}`}
      onClick={onSelect}
      ref={t.ref as never}
      onMouseLeave={t.hide}
    >
      <span className="mini-top">
        <strong>{label}</strong>
        <span className={`delta-tag d-${lastDir}`}>
          <b>{arrowOf(lastDir)}</b> {last ? deltaText(last) : '—'}
        </span>
      </span>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
        {blocks.map((b, i) => {
          const v = row.values[i] ?? null;
          const cx = 10 + band * (i + 0.5);
          const h = v === null ? 0 : ((v ?? 0) / hi) * (H - 62);
          const d = i > 0 ? row.deltas[i - 1] : undefined;
          const dir = d && (d.status === 'ok' || d.status === 'nuevo') ? dirOf(d.abs) : 'flat';
          return (
            <g
              key={b.blockKey}
              onMouseMove={(e) =>
                t.show(
                  e as unknown as MouseEvent,
                  <>
                    <strong>
                      B{i} · {b.blockKey}
                    </strong>
                    <div className="tip-big">
                      {v === null ? 'No observada' : `${number(v, dec)} ${row.unit}`}
                    </div>
                    {d && (
                      <div style={{ color: DIR_COLOR[dir] }}>
                        {arrowOf(dir)} {deltaText(d)}
                      </div>
                    )}
                  </>,
                )
              }
            >
              <rect x={cx - band / 2} y={0} width={band} height={H} fill="transparent" />
              {v === null ? (
                <rect x={cx - bw / 2} y={H - 40} width={bw} height={2} className="chart-missing" />
              ) : (
                <rect
                  x={cx - bw / 2}
                  y={H - 40 - h}
                  width={bw}
                  height={Math.max(2, h)}
                  rx={4}
                  fill={BLOCK_COLORS[i % 4]}
                  opacity={b.closed ? 1 : 0.55}
                />
              )}
              {v !== null && (
                <text x={cx} y={H - 46 - h} textAnchor="middle" className="chart-val sm">
                  {number(v, dec)}
                </text>
              )}
              <text x={cx} y={H - 22} textAnchor="middle" className="chart-note">
                B{i}
              </text>
              {d && (
                <text x={cx} y={H - 6} textAnchor="middle" className="chart-delta sm" fill={DIR_COLOR[dir]}>
                  {arrowOf(dir)} {d.pct === null ? '' : `${d.pct > 0 ? '+' : ''}${number(d.pct, 0)}%`}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {t.view}
    </button>
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
const C_DONE = '#4cc9f0';
const C_SKIP = '#fb8f3c';
const C_UNK = '#59606e';
export function ComplianceChart({ data, blocks }: { data: CCompliance[]; blocks: CBlock[] }) {
  const t = useTip();
  const pctOf = (a: number, b: number) => (b ? (100 * a) / b : 0);
  const weeks = data.flatMap((c, bi) => c.weeks.map((w) => ({ ...w, bi, blockKey: c.blockKey })));
  const H = 150;
  return (
    <div className="chart-box" ref={t.ref} onMouseLeave={t.hide}>
      <div className="chart-head">
        <h4>Cumplimiento: previsto vs hecho</h4>
        <span className="muted small">
          sobre las series previstas hasta el corte; «sin registro» no es «omitida»
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
      <h5 className="chart-sub">Semana a semana (% de series hechas)</h5>
      <svg viewBox={`0 0 960 ${H}`} className="chart-svg" role="img" aria-label="Cumplimiento semanal">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line
              x1={40}
              x2={950}
              y1={H - 30 - (g / 100) * (H - 50)}
              y2={H - 30 - (g / 100) * (H - 50)}
              className="chart-grid"
            />
            <text x={32} y={H - 26 - (g / 100) * (H - 50)} className="chart-axis" textAnchor="end">
              {g}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const bw = 910 / Math.max(1, weeks.length);
          const x0 = 40 + i * bw;
          const share = w.setsPlanned ? w.setsDone / w.setsPlanned : null;
          const h = share === null ? 0 : share * (H - 50);
          return (
            <g
              key={`${w.blockKey}${w.weekNo}`}
              onMouseMove={(e) =>
                t.show(
                  e as unknown as MouseEvent,
                  <>
                    <strong>
                      {w.blockKey} · S{w.weekNo}
                    </strong>
                    <div className="tip-big">
                      {share === null ? '—' : `${number(100 * share, 0)}% hechas`}
                    </div>
                    <div>
                      {w.setsDone}/{w.setsPlanned} · omitidas {w.setsSkipped} · sin registro {w.setsUnknown}
                    </div>
                  </>,
                )
              }
            >
              <rect x={x0} y={0} width={bw} height={H - 30} fill="transparent" />
              <rect
                x={x0 + bw * 0.12}
                y={H - 30 - h}
                width={bw * 0.76}
                height={Math.max(h, 1.5)}
                rx={3}
                fill={BLOCK_COLORS[w.bi % 4]}
              />
              {(w.weekNo === 1 || weeks.length < 16) && (
                <text x={x0 + bw / 2} y={H - 12} textAnchor="middle" className="chart-note">
                  {w.weekNo === 1 ? `${w.blockKey} · S1` : `S${w.weekNo}`}
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
const LINE_COLORS = ['#6d83f2', '#e879c6', '#4cc9f0', '#fb8f3c', '#a07cf0', '#9aa4b8'];
export function E1rmChart({
  lift,
  variants,
  blocks,
}: {
  lift: string;
  variants: CVariant[];
  blocks: CBlock[];
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
                    fill={best ? '#4fb985' : LINE_COLORS[ni % 6]}
                    stroke="#0b0b0e"
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
