import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, query } from './api';
import { dateLabel, number, readSearch, updateSearch } from './ui';
import { OverviewChart } from './OverviewChart';
import { MovementFilter, useMov, type Mov } from './MovementFilter';
import './blockdash.css';

/**
 * Resultado de los bloques en una sola vista: línea de tiempo, previsto vs realizado, 1RM, volumen por músculo/patrón, fatiga y sesiones.
 * Solo presenta lo que entrega GET /core (no recalcula). «Previsto» = prescripción del plan; «Realizado» = series ejecutadas registradas.
 */
interface Val {
  value: number | null;
  status: string;
}
interface Totals {
  nl: Val;
  sets: Val;
  tonnage: Val;
  si: { rts: { total: Val; central: Val; peripheral: Val } };
  e1rm: { curve: Val };
}
interface PatternRows {
  rows: {
    pattern: string;
    sets: number;
    nl: number;
    tonnage: number | null;
    si?: { total: number } | null;
  }[];
}
interface MuscleRows {
  rows: {
    muscle: string;
    directSets: number;
    indirectSets: number;
    equivalentSets: number;
    equivalentReps?: number;
    equivalentTonnage?: number | null;
  }[];
}
interface Week {
  week: { from: string; to: string; partial: boolean };
  sessions: number;
  totals: Totals;
  patterns: PatternRows;
  muscles?: MuscleRows;
  fatigue?: { endFatigue?: { mean: number | null; n: number } };
}
interface Session {
  sessionKey: string;
  blockKey?: string | null;
  date: string;
  totals: Totals;
  exercises: {
    exerciseName: string;
    lift: string | null;
    priority?: number | null;
    exposureRole?: string | null;
    metrics?: {
      nl: Val;
      sets: Val;
      tonnage: Val;
      si: { rts: { total: Val } };
      e1rm: { curve: Val };
    };
    fatigueBetweenSets?: {
      sets: {
        setNo: number;
        kg: number | null;
        reps: number | null;
        rpe: number | null;
        target?: { rpe: number | null } | null;
        rpeVsTarget?: number | null;
      }[];
    };
  }[];
}
interface Core {
  totals: Totals;
  patterns: PatternRows;
  muscles: MuscleRows;
  sessions: Session[];
  weeks: Week[];
}
interface Ref {
  exerciseName: string;
  kg: number;
  source: string;
  asOf: string;
}
type Lift = 'SQ' | 'BP' | 'DL';
type Tab =
  | 'semanas'
  | 'movimiento'
  | 'detalle'
  | 'comparativa'
  | 'sesiones'
  | 'distribucion'
  | 'fatiga'
  | 'graficos'
  | 'ejercicios';
// por ahora todo en la familia del azul; más adelante se podrá asignar un color por atleta y bloque
const PALETTE = ['#3d74e0', '#2f5cc0', '#6a97f0', '#4a86c7', '#27478f', '#85a9ee', '#3a63b5', '#8a8d96'];
const PATTERN_LABEL: Record<string, string> = {
  sentadilla: 'Sentadilla',
  bisagra_cadera: 'Bisagra',
  unilateral_pierna: 'Pierna unilateral',
  empuje_horizontal: 'Empuje horiz.',
  empuje_vertical: 'Empuje vert.',
  traccion_horizontal: 'Tracción horiz.',
  traccion_vertical: 'Tracción vert.',
  aislamiento_pierna: 'Aisl. pierna',
  aislamiento_brazos: 'Brazos',
  aislamiento_hombro_espalda: 'Hombro / espalda',
  core: 'Core',
  transporte_olimpico: 'Transporte / olímpico',
};
const label = (p: string) => PATTERN_LABEL[p] ?? p.replace(/_/g, ' ');
const blockOf = (sessionKey: string) => sessionKey.replace(/-w\d+-s\d+$/, '');
const WIDE = { from: '2020-01-01', to: '2035-12-31' };
const DAY = 86400000;
const t = (d: string) => Date.parse(d + 'T00:00:00Z');
const todayIso = () => new Date().toISOString().slice(0, 10);
const asVal = (v: number): Val => ({ value: v, status: 'available' });

interface Block {
  key: string;
  from: string;
  to: string;
  color: string;
}
interface Pt {
  x: string;
  a: number;
  b: number;
  tip: string;
  color: string;
}

/** Barras semanales: gris = previsto, color = realizado. Grande y con ejes legibles. Solo hasta hoy. */
function Compare({
  title,
  unit,
  pts,
  paired,
  onPick,
  highlight,
}: {
  title: string;
  unit: string;
  pts: Pt[];
  paired: boolean;
  onPick?: (week: string) => void;
  highlight?: string;
}) {
  const [hv, setHv] = useState<number | null>(null);
  const max = Math.max(1, ...pts.flatMap((p) => [p.a, p.b]));
  const n = Math.max(1, pts.length);
  const W = 720;
  const H = 300;
  const base = 250;
  const plotH = 216;
  const left = 62;
  const slot = (W - left - 10) / n;
  const bw = Math.max(4, Math.min(30, slot / (paired ? 2.2 : 1.35)));
  const step = Math.ceil(n / 8);
  return (
    <figure className="bd-chart bd-big" style={{ position: 'relative' }}>
      <figcaption>
        <strong>{title}</strong>
        <span>{unit}</span>
        {paired && (
          <span className="bd-key">
            <i className="plan" /> previsto <i className="real" /> realizado
          </span>
        )}
      </figcaption>
      {max <= 1 ? (
        <p className="small chart-empty">Sin datos en este período.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={left} x2={W - 4} y1={base - f * plotH} y2={base - f * plotH} className="bd-grid" />
              <text x={left - 6} y={base - f * plotH + 4} textAnchor="end">
                {number(max * f, 0)}
              </text>
            </g>
          ))}
          {pts.map((p, i) => {
            const x = left + 4 + i * slot;
            const ha = (p.a / max) * plotH;
            const hb = (p.b / max) * plotH;
            return (
              <g key={p.x + i}>
                {paired ? (
                  <>
                    <rect x={x} y={base - ha} width={bw} height={ha} className="bd-plan" rx="2">
                      <title>{`${dateLabel(p.x)} · previsto ${number(p.a, 0)} ${unit}`}</title>
                    </rect>
                    <rect x={x + bw + 1} y={base - hb} width={bw} height={hb} fill={p.color} rx="2">
                      <title>{`${dateLabel(p.x)} · realizado ${number(p.b, 0)} ${unit} · ${p.tip}`}</title>
                    </rect>
                  </>
                ) : (
                  <rect x={x} y={base - ha} width={bw} height={ha} fill={p.color} rx="2">
                    <title>{`${dateLabel(p.x)} · ${number(p.a, 0)} ${unit} · ${p.tip}`}</title>
                  </rect>
                )}
                {i % step === 0 && (
                  <text x={x + bw} y={base + 18} textAnchor="middle" className="bd-axis">
                    {dateLabel(p.x).replace('.', '')}
                  </text>
                )}
              </g>
            );
          })}
          {pts.map((p, i) => (
            <rect
              key={'h' + i}
              x={left + 4 + i * slot - 2}
              y={0}
              width={slot}
              height={base + 30}
              fill={
                highlight === p.x ? 'rgba(79,70,229,.20)' : hv === i ? 'rgba(79,70,229,.08)' : 'transparent'
              }
              stroke={highlight === p.x ? 'var(--accent)' : 'none'}
              strokeWidth="2"
              style={onPick ? { cursor: 'pointer' } : undefined}
              onMouseEnter={() => setHv(i)}
              onMouseLeave={() => setHv(null)}
              onClick={() => onPick?.(p.x)}
            />
          ))}
        </svg>
      )}
      {hv !== null && pts[hv] && (
        <div
          className="chart-tip"
          style={{ left: `${Math.min(70, Math.max(2, ((left + 4 + hv * slot) / W) * 100 + 3))}%` }}
          role="status"
        >
          <strong>
            Semana del {dateLabel(pts[hv]!.x)} al{' '}
            {dateLabel(new Date(Date.parse(pts[hv]!.x) + 6 * 86400000).toISOString().slice(0, 10))}
          </strong>
          <div className="chart-tip-row">
            <span>
              <i style={{ background: pts[hv]!.color }} /> {pts[hv]!.tip || 'bloque'}
            </span>
            <b>
              {number(paired ? pts[hv]!.b : pts[hv]!.a, 1)} {unit}
            </b>
            <small>
              {paired
                ? `previsto ${number(pts[hv]!.a, 1)} · ${pts[hv]!.a ? number((pts[hv]!.b / pts[hv]!.a) * 100, 0) : '—'} % de lo previsto · diferencia ${number(pts[hv]!.b - pts[hv]!.a, 1)}`
                : 'dosis prevista'}
              {hv > 0
                ? ` · vs semana anterior ${number((paired ? pts[hv]!.b : pts[hv]!.a) - (paired ? pts[hv - 1]!.b : pts[hv - 1]!.a), 1)}`
                : ''}
            </small>
          </div>
        </div>
      )}
    </figure>
  );
}

function Lines({
  title,
  unit,
  series,
  zoom,
}: {
  title: string;
  unit: string;
  zoom?: boolean;
  series: { name: string; color: string; pts: { x: string; v: number | null }[] }[];
}) {
  return (
    <figure className="bd-chart bd-big">
      <figcaption>
        <strong>{title}</strong>
        <span>{unit}</span>
      </figcaption>
      <OverviewChart
        title={title}
        unit={unit}
        zoom={zoom}
        traces={series.map((s) => ({
          label: s.name,
          color: s.color,
          points: s.pts.map((p) => ({ date: p.x, value: p.v })),
        }))}
      />
    </figure>
  );
}

function HBars({
  title,
  unit,
  rows,
}: {
  title: string;
  unit: string;
  rows: { name: string; value: number; sub?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="bd-chart">
      <figcaption>
        <strong>{title}</strong>
        <span>{unit}</span>
      </figcaption>
      {rows.length === 0 ? (
        <p className="small chart-empty">Sin datos en este período.</p>
      ) : (
        <ul className="bd-hbars">
          {rows.map((r) => (
            <li key={r.name} title={r.sub}>
              <span className="bd-hname">{r.name}</span>
              <span className="bd-htrack">
                <span style={{ width: `${(r.value / max) * 100}%` }} />
              </span>
              <span className="bd-hval">{number(r.value, 0)}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

function Kpi({
  name,
  real,
  plan,
  unit,
  hint,
}: {
  name: string;
  real?: Val;
  plan?: Val;
  unit: string;
  hint?: string;
}) {
  const r = real?.value ?? null;
  const p = plan?.value ?? null;
  const pct = r !== null && p ? Math.round((r / p) * 100) : null;
  return (
    <div className="bd-kpi" title={hint}>
      <span>{name}</span>
      <strong>{r === null ? '—' : number(r, 0)}</strong>
      <em>
        {unit}
        {p !== null && ` · previsto ${number(p, 0)}`}
      </em>
      {pct !== null && (
        <div className="bd-adh" title={`${pct}% de lo previsto hasta hoy`}>
          <span style={{ width: `${Math.min(100, pct)}%` }} />
          <b>{pct}%</b>
        </div>
      )}
    </div>
  );
}

function Timeline({ blocks, sel, onSel }: { blocks: Block[]; sel: string; onSel: (k: string) => void }) {
  if (!blocks.length) return null;
  const a = Math.min(...blocks.map((b) => t(b.from)));
  const b = Math.max(...blocks.map((x) => t(x.to))) + 7 * DAY;
  const W = 1000;
  const X = (d: number) => ((d - a) / Math.max(b - a, DAY)) * W;
  const now = t(todayIso());
  const lanes: number[] = [];
  const placed = blocks.map((k) => {
    const s = t(k.from);
    let lane = lanes.findIndex((end) => end < s - 2 * DAY);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = t(k.to);
    return { k, lane };
  });
  const H = 22 + lanes.length * 34;
  return (
    <svg
      className="bd-timeline"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label="Línea de tiempo de bloques"
    >
      <defs>
        <pattern
          id="bd-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="3" height="6" fill="rgba(255,255,255,.45)" />
        </pattern>
      </defs>
      {placed.map(({ k, lane }) => {
        const x = X(t(k.from));
        const w = Math.max(14, X(t(k.to) + DAY) - x);
        const on = sel === '' || sel === k.key;
        const fx = Math.max(x, X(now));
        return (
          <g
            key={k.key}
            onClick={() => onSel(sel === k.key ? '' : k.key)}
            style={{ cursor: 'pointer' }}
            opacity={on ? 1 : 0.35}
          >
            <rect x={x} y={4 + lane * 34} width={w} height="28" rx="6" fill={k.color} />
            {t(k.to) > now && (
              <rect
                x={fx}
                y={4 + lane * 34}
                width={Math.max(0, x + w - fx)}
                height="28"
                rx="6"
                fill="url(#bd-hatch)"
              />
            )}
            <text x={x + 6} y={22 + lane * 34} className="bd-tl">
              {w > 60 ? k.key : ''}
            </text>
            <title>{`${k.key} · ${dateLabel(k.from)} – ${dateLabel(k.to)}`}</title>
          </g>
        );
      })}
      {now >= a && now <= b && (
        <g>
          <line x1={X(now)} x2={X(now)} y1="0" y2={H - 14} className="bd-now" />
          <text x={X(now)} y={H - 2} textAnchor="middle" className="bd-axis">
            hoy
          </text>
        </g>
      )}
    </svg>
  );
}

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : number(v, 0));
const dayName = (d: string) =>
  new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(d + 'T12:00:00Z'))
    .replace('.', '');
const kgTxt = (v: number | null) => (v === null ? 's/kg' : `${number(v, 1)} kg`);

/** Cuadro simple: una fila por semana, agrupado por bloque. Un solo número por columna (lo realizado; si la semana aún no pasó, lo previsto en gris). */
function WeekTable({
  weeks,
  real,
  blocks,
  today,
  showPlan,
  onPick,
  highlight,
}: {
  weeks: Week[];
  real: Map<string, Week>;
  blocks: Block[];
  today: string;
  showPlan: boolean;
  onPick?: (week: string) => void;
  highlight?: string;
}) {
  const groups = blocks
    .map((b) => ({ b, ws: weeks.filter((w) => w.week.from >= b.from && w.week.from <= b.to) }))
    .filter((g) => g.ws.length);
  return (
    <div className="bd-table bd-weeks">
      <table>
        <thead>
          <tr>
            <th>Sem.</th>
            <th>Fechas</th>
            <th>Ses.</th>
            <th>Series</th>
            <th>NL</th>
            <th>Tonelaje (kg)</th>
            <th>SI</th>
            {showPlan && <th>NL prev.</th>}
            <th>Cumplimiento</th>
          </tr>
        </thead>
        {groups.map(({ b, ws }) => (
          <tbody key={b.key}>
            <tr className="bd-group">
              <td colSpan={showPlan ? 9 : 8}>
                <i style={{ background: b.color }} /> {b.key}
                <small>
                  {dateLabel(b.from)} – {dateLabel(b.to)} · {ws.length}{' '}
                  {ws.length === 1 ? 'semana' : 'semanas'}
                </small>
              </td>
            </tr>
            {ws.map((w, i) => {
              const r = real.get(w.week.from);
              const current = w.week.from <= today && w.week.to >= today;
              const past = w.week.from <= today && !!r && !current;
              const tt = past ? (r as Week).totals : w.totals;
              const pct =
                past && w.totals.nl.value ? Math.round(((tt.nl.value ?? 0) / w.totals.nl.value) * 100) : null;
              return (
                <tr
                  key={w.week.from}
                  className={`${past ? '' : 'bd-future'} ${highlight === w.week.from ? 'bd-selected' : ''} ${onPick ? 'bd-click' : ''}`}
                  onClick={() => onPick?.(w.week.from)}
                  title={onPick ? 'Ver el detalle de esta semana y su bloque' : undefined}
                >
                  <td>{i + 1}</td>
                  <td>
                    {dateLabel(w.week.from)} – {dateLabel(w.week.to)}
                  </td>
                  <td>{w.sessions}</td>
                  <td>{fmt(tt.sets.value)}</td>
                  <td>{fmt(tt.nl.value)}</td>
                  <td>{fmt(tt.tonnage.value)}</td>
                  <td>{fmt(tt.si.rts.total.value)}</td>
                  {showPlan && <td>{fmt(w.totals.nl.value)}</td>}
                  <td>
                    {current ? (
                      <span className="bd-pend">en curso</span>
                    ) : pct === null ? (
                      <span className="bd-pend">pendiente</span>
                    ) : (
                      <span className={pct >= 95 ? 'bd-ok' : pct >= 80 ? 'bd-mid' : 'bd-low'}>{pct}%</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** «3×5 @ 152,5 kg RPE 7 · 2×5 @ …»: agrupa series seguidas idénticas. */
function setsText(sets: { kg: number | null; reps: number | null; rpe: number | null }[]) {
  const out: string[] = [];
  let i = 0;
  while (i < sets.length) {
    const s = sets[i] as (typeof sets)[number];
    let n = 1;
    while (i + n < sets.length) {
      const x = sets[i + n] as (typeof sets)[number];
      if (x.kg !== s.kg || x.reps !== s.reps || x.rpe !== s.rpe) break;
      n++;
    }
    out.push(`${n}×${s.reps ?? '?'} · ${kgTxt(s.kg)}${s.rpe !== null ? ` · RPE ${number(s.rpe, 1)}` : ''}`);
    i += n;
  }
  return out;
}

function SessionList({ sessions, colorAt }: { sessions: Session[]; colorAt: (d: string) => string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="bd-table bd-sessions">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Sesión</th>
            <th>Ejercicios</th>
            <th>NL</th>
            <th>Tonelaje (kg)</th>
            <th>SI</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const on = open === s.sessionKey;
            const names = [...new Set(s.exercises.map((e) => e.exerciseName))];
            return [
              <tr
                key={s.sessionKey}
                onClick={() => setOpen(on ? null : s.sessionKey)}
                className={on ? 'on' : ''}
              >
                <td>
                  {dayName(s.date)} {dateLabel(s.date)}
                </td>
                <td>
                  <i style={{ background: colorAt(s.date) }} /> {s.blockKey ?? blockOf(s.sessionKey)} ·{' '}
                  {(/-(s\d+)$/.exec(s.sessionKey)?.[1] ?? '').toUpperCase()}
                </td>
                <td className="bd-ex">
                  {names.slice(0, 3).join(' · ')}
                  {names.length > 3 ? ` · +${names.length - 3}` : ''}
                </td>
                <td>{fmt(s.totals.nl.value)}</td>
                <td>{fmt(s.totals.tonnage.value)}</td>
                <td>{fmt(s.totals.si.rts.total.value)}</td>
              </tr>,
              on && (
                <tr key={s.sessionKey + '-d'} className="bd-detail">
                  <td colSpan={6}>
                    <ul>
                      {s.exercises.map((e) => (
                        <li key={e.exerciseName}>
                          <strong>{e.exerciseName}</strong>
                          <span>
                            {setsText(e.fatigueBetweenSets?.sets ?? []).join('  |  ') ||
                              'sin detalle de series'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

type Metric = 'nl' | 'si' | 'tonnage' | 'sets';
type Group = 'movimiento' | 'patron' | 'musculo';
const METRICS: { k: Metric; n: string; unit: string }[] = [
  { k: 'nl', n: 'NL', unit: 'repeticiones' },
  { k: 'si', n: 'SI', unit: 'SI (RTS aprox.)' },
  { k: 'tonnage', n: 'Tonelaje', unit: 'kg' },
  { k: 'sets', n: 'Series', unit: 'series' },
];
const tot = (m: Metric) => (x: Totals) =>
  m === 'si'
    ? x.si.rts.total.value
    : m === 'nl'
      ? x.nl.value
      : m === 'tonnage'
        ? x.tonnage.value
        : x.sets.value;

/** Un gráfico por movimiento (SQ/BP/DL), por patrón o por músculo; solo semanas hasta hoy. */
function GraphsTab({
  planWeeks,
  realWeeks,
  lifts,
  today,
  colorAt,
  nameAt,
  onPick,
  highlight,
}: {
  planWeeks: Week[];
  realWeeks: Week[];
  lifts: { l: Lift; name: string; plan: Week[]; real: Week[] }[];
  today: string;
  colorAt: (d: string) => string;
  nameAt: (d: string) => string;
  onPick?: (week: string) => void;
  highlight?: string;
}) {
  const [metric, setMetric] = useState<Metric>(
    () => METRICS.find((x) => x.k === readSearch().get('bdm'))?.k ?? 'nl',
  );
  const [group, setGroup] = useState<Group>(() => {
    const v = readSearch().get('bdg');
    return v === 'patron' || v === 'musculo' ? v : 'movimiento';
  });
  const m = METRICS.find((x) => x.k === metric) as (typeof METRICS)[number];
  const cut = (ws: Week[]) => ws.filter((w) => w.sessions > 0 && w.week.from <= today);
  const mk = (plan: Week[], real: Week[], f: (w: Week | undefined) => number | null): Pt[] => {
    const rm = new Map(real.map((w) => [w.week.from, w]));
    return cut(plan).map((w) => ({
      x: w.week.from,
      a: f(w) ?? 0,
      b: f(rm.get(w.week.from)) ?? 0,
      tip: nameAt(w.week.from),
      color: colorAt(w.week.from),
    }));
  };
  const hasReal = realWeeks.length > 0;
  let charts: { title: string; pts: Pt[] }[] = [];
  let note = '';
  if (group === 'movimiento')
    charts = lifts.map((l) => ({
      title: l.name,
      pts: mk(l.plan, l.real, (w) => (w ? tot(metric)(w.totals) : null)),
    }));
  else if (group === 'patron') {
    const names = [...new Set(planWeeks.flatMap((w) => w.patterns.rows.map((r) => r.pattern)))];
    const val = (w: Week | undefined, p: string) => {
      const r = w?.patterns.rows.find((x) => x.pattern === p);
      if (!r) return null;
      return metric === 'si'
        ? (r.si?.total ?? null)
        : metric === 'nl'
          ? r.nl
          : metric === 'tonnage'
            ? r.tonnage
            : r.sets;
    };
    charts = names
      .map((p) => ({ title: label(p), pts: mk(planWeeks, realWeeks, (w) => val(w, p)) }))
      .sort((x, y) => y.pts.reduce((s, q) => s + q.a, 0) - x.pts.reduce((s, q) => s + q.a, 0));
  } else {
    if (metric === 'si')
      note =
        'El SI no se reparte por músculo (un ejercicio trabaja varios músculos y se superponen). Mirá el SI por movimiento o por patrón.';
    else {
      const sum = new Map<string, number>();
      for (const w of planWeeks)
        for (const r of w.muscles?.rows ?? []) sum.set(r.muscle, (sum.get(r.muscle) ?? 0) + r.equivalentSets);
      const names = [...sum.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map((x) => x[0]);
      const val = (w: Week | undefined, mu: string) => {
        const r = w?.muscles?.rows.find((x) => x.muscle === mu);
        if (!r) return null;
        return metric === 'nl'
          ? (r.equivalentReps ?? null)
          : metric === 'tonnage'
            ? (r.equivalentTonnage ?? null)
            : r.equivalentSets;
      };
      charts = names.map((mu) => ({
        title: mu.replace(/_/g, ' '),
        pts: mk(planWeeks, realWeeks, (w) => val(w, mu)),
      }));
      note =
        'Series, repeticiones y tonelaje «equivalentes»: aporte directo ×1 e indirecto ×0,5. Los músculos se superponen: no se suman entre sí.';
    }
  }
  return (
    <>
      <div className="bd-controls">
        <div className="bd-seg" role="group" aria-label="Métrica">
          {METRICS.map((x) => (
            <button key={x.k} type="button" aria-pressed={metric === x.k} onClick={() => setMetric(x.k)}>
              {x.n}
            </button>
          ))}
        </div>
        <div className="bd-seg" role="group" aria-label="Agrupar por">
          {(
            [
              ['movimiento', 'Por movimiento (SQ · BP · DL)'],
              ['patron', 'Por patrón de movimiento'],
              ['musculo', 'Por grupo muscular'],
            ] as [Group, string][]
          ).map(([k, n]) => (
            <button key={k} type="button" aria-pressed={group === k} onClick={() => setGroup(k)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <p className="small bd-note">
        {m.n} semanal hasta hoy.{' '}
        {group === 'patron' && 'Cada ejercicio cuenta en un solo patrón (ej.: «Empuje horiz.» ≈ pectoral). '}
        {note}
      </p>
      <div className="bd-grid2 bd-bigs">
        {charts.map((c) => (
          <Compare
            key={c.title}
            title={c.title}
            unit={m.unit}
            pts={c.pts}
            paired={hasReal}
            onPick={onPick}
            highlight={highlight}
          />
        ))}
      </div>
    </>
  );
}

/* ---------- avance por movimiento a lo largo de todos los bloques ---------- */
interface Agg {
  nl: number;
  sets: number;
  tonnage: number;
  si: number;
  /** e1RM de la familia «comp» (competición). */
  e1: number | null;
  /** e1RM del ejercicio de prioridad 1 del movimiento (el que el coach marcó como principal). */
  e1p: number | null;
}
const monday = (d: string) => {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};
const COMP_NAME: Record<Lift, string> = { SQ: 'squat comp', BP: 'bench comp', DL: 'deadlift comp' };
const LIFT_FULL: Record<Lift, string> = { SQ: 'Sentadilla', BP: 'Banca', DL: 'Peso muerto' };
const LIFT_COLOR: Record<Lift, string> = { SQ: '#5ea3d8', BP: '#d9904a', DL: '#9bbf7a' };

/** Suma por semana los ejercicios del movimiento (y variante). El e1RM del total del movimiento es el de la competición; el de una variante, el suyo. */
function aggregate(sessions: Session[], lift: Lift, variant: string): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const s of sessions)
    for (const e of s.exercises) {
      if (e.lift !== lift || !e.metrics) continue;
      if (variant !== '__all__' && e.exerciseName !== variant) continue;
      const k = monday(s.date);
      const a = m.get(k) ?? { nl: 0, sets: 0, tonnage: 0, si: 0, e1: null, e1p: null };
      a.nl += e.metrics.nl.value ?? 0;
      a.sets += e.metrics.sets.value ?? 0;
      a.tonnage += e.metrics.tonnage.value ?? 0;
      a.si += e.metrics.si.rts.total.value ?? 0;
      const v = e.metrics.e1rm.curve.value;
      const counts = variant !== '__all__' || e.exerciseName.toLowerCase().startsWith(COMP_NAME[lift]);
      if (v !== null && counts) a.e1 = Math.max(a.e1 ?? 0, v);
      if (v !== null && e.priority === 1) a.e1p = Math.max(a.e1p ?? 0, v);
      m.set(k, a);
    }
  return m;
}

function MovementView({
  real,
  plan,
  blocks,
  today,
  refs,
  mov,
  setMov,
  onPick,
  highlight,
}: {
  real: Core;
  plan: Core;
  blocks: Block[];
  today: string;
  refs: Ref[];
  mov: Mov;
  setMov: (m: Mov) => void;
  onPick?: (week: string) => void;
  highlight?: string;
}) {
  // el movimiento sale del filtro global: cambiarlo acá lo cambia en todo el análisis
  const lift: Lift = mov === 'ALL' ? 'SQ' : mov;
  const [variant, setVariant] = useState('__all__');
  const inBlock = (d: string) => blocks.find((b) => d >= monday(b.from) && d <= b.to);
  const variants = useMemo(() => {
    const c = new Map<string, { n: number; prio: number | null }>();
    for (const s of plan.sessions)
      for (const e of s.exercises)
        if (e.lift === lift) {
          const x = c.get(e.exerciseName) ?? { n: 0, prio: null };
          x.n += 1;
          if (e.priority != null && (x.prio === null || e.priority < x.prio)) x.prio = e.priority;
          c.set(e.exerciseName, x);
        }
    // primero los que el coach marcó como principales (prioridad 1, 2, …), después por frecuencia
    return [...c.entries()].sort((a, b) => (a[1].prio ?? 9) - (b[1].prio ?? 9) || b[1].n - a[1].n);
  }, [plan, lift]);
  const variantNames = variants.map((x) => x[0]);
  const v = variant === '__all__' || variantNames.includes(variant) ? variant : '__all__';
  const aggR = useMemo(() => aggregate(real.sessions, lift, v), [real, lift, v]);
  const aggP = useMemo(() => aggregate(plan.sessions, lift, v), [plan, lift, v]);
  const weeks = [...aggP.keys()].filter((k) => k <= today).sort();
  const color = LIFT_COLOR[lift];
  const pt = (f: (a: Agg) => number) =>
    weeks.map((k) => ({
      x: k,
      a: f(aggP.get(k) as Agg),
      b: aggR.has(k) ? f(aggR.get(k) as Agg) : 0,
      tip: inBlock(k)?.key ?? '',
      color: inBlock(k)?.color ?? color,
    }));
  const e1Real = weeks.map((k) => ({ date: k, value: aggR.get(k)?.e1 ?? null }));
  const e1Plan = weeks.map((k) => ({ date: k, value: aggP.get(k)?.e1 ?? null }));
  const variantLines =
    v !== '__all__'
      ? []
      : variants
          .slice(0, 7)
          .map(([name, vi], i) => {
            const m = aggregate(real.sessions, lift, name);
            const ref = refs
              .filter((r) => r.exerciseName === name)
              .sort((x, y) => y.asOf.localeCompare(x.asOf))[0]?.kg;
            const points = weeks.map((k) => ({ date: k, value: m.get(k)?.e1 ?? null }));
            return {
              name: `${name}${vi.prio ? ` (${vi.prio}°)` : ''}`,
              color: i === 0 ? color : (PALETTE[(i + 1) % PALETTE.length] as string),
              points,
              pct: points.map((p) => ({
                date: p.date,
                value: p.value !== null && ref ? Math.round((p.value / ref) * 1000) / 10 : null,
              })),
            };
          })
          .filter((l) => l.points.some((p) => p.value !== null));
  const hasReal = weeks.some((k) => aggR.has(k));
  const rows = blocks
    .map((b) => {
      const ks = weeks.filter((k) => k >= monday(b.from) && k <= b.to);
      const sum = (f: (a: Agg) => number) =>
        ks.reduce((t, k) => t + (aggR.get(k) ? f(aggR.get(k) as Agg) : 0), 0);
      const e1s = ks.map((k) => aggR.get(k)?.e1 ?? null).filter((x): x is number => x !== null);
      return {
        b,
        weeks: ks.length,
        sets: sum((a) => a.sets),
        nl: sum((a) => a.nl),
        tonnage: sum((a) => a.tonnage),
        si: sum((a) => a.si),
        best: e1s.length ? Math.max(...e1s) : null,
        last: e1s.length ? (e1s[e1s.length - 1] as number) : null,
      };
    })
    .filter((r) => r.weeks > 0);
  const allE1 = e1Real.map((p) => p.value).filter((x): x is number => x !== null);
  const total = (f: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
  const first = allE1[0];
  const last = allE1[allE1.length - 1];
  return (
    <div className="bd-move">
      <div className="bd-controls">
        <div className="bd-seg bd-lifts" role="group" aria-label="Movimiento">
          {(['SQ', 'BP', 'DL'] as Lift[]).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lift === l}
              onClick={() => {
                setMov(l);
                setVariant('__all__');
              }}
              style={{ ['--c' as string]: LIFT_COLOR[l] }}
            >
              <i /> {LIFT_FULL[l]}
            </button>
          ))}
        </div>
        <label className="bd-variant">
          Variante
          <select value={v} onChange={(e) => setVariant(e.target.value)}>
            <option value="__all__">Todas las variantes (volumen) · e1RM por variante</option>
            {variants.map(([n, vi]) => (
              <option key={n} value={n}>
                {n}
                {vi.prio ? ` · prioridad ${vi.prio}°` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="small bd-note">
        {LIFT_FULL[lift]} a lo largo de <strong>todos los bloques</strong> (no depende del bloque elegido
        arriba), hasta hoy. {v === '__all__' ? 'Suma todas las variantes del movimiento.' : `Solo «${v}».`}
      </p>
      <div className="bd-kpis">
        <Kpi name="NL total" real={asVal(total((r) => r.nl))} unit="rep." />
        <Kpi name="Series" real={asVal(total((r) => r.sets))} unit="series" />
        <Kpi name="Tonelaje" real={asVal(total((r) => r.tonnage))} unit="kg" />
        <Kpi name="SI total" real={asVal(total((r) => r.si))} unit="RTS aprox." />
        <Kpi
          name="e1RM máximo"
          real={allE1.length ? asVal(Math.max(...allE1)) : undefined}
          unit="kg · curva RTS"
        />
        <Kpi
          name="Evolución e1RM"
          real={
            first !== undefined && last !== undefined
              ? asVal(Math.round((last - first) * 10) / 10)
              : undefined
          }
          unit={
            first !== undefined && last !== undefined && first
              ? `kg · ${number(((last - first) / first) * 100, 1)} % entre la primera y la última semana`
              : 'kg'
          }
        />
      </div>
      {v === '__all__' ? (
        <>
          <figure className="bd-chart bd-big bd-wide">
            <figcaption>
              <strong>e1RM por variante · {LIFT_FULL[lift]}</strong>
              <span>kg · curva RTS, mejor serie de la semana · una línea por variante</span>
            </figcaption>
            <OverviewChart
              title={`e1RM por variante ${LIFT_FULL[lift]}`}
              unit="kg"
              zoom
              period={weeks.length ? { from: weeks[0] as string, to: today } : undefined}
              bands={blocks.map((b) => ({ from: b.from, to: b.to, color: b.color, label: b.key }))}
              traces={variantLines.map((l) => ({ label: l.name, color: l.color, points: l.points }))}
              onPick={onPick}
              highlight={highlight}
            />
          </figure>
          {variantLines.some((l) => l.pct.some((p) => p.value !== null)) && (
            <figure className="bd-chart bd-big bd-wide">
              <figcaption>
                <strong>e1RM como % del 1RM de referencia de cada variante</strong>
                <span>comparable entre variantes · 100 % = su 1RM de referencia</span>
              </figcaption>
              <OverviewChart
                title="e1RM relativo"
                unit="%"
                zoom
                period={weeks.length ? { from: weeks[0] as string, to: today } : undefined}
                bands={blocks.map((b) => ({ from: b.from, to: b.to, color: b.color, label: b.key }))}
                traces={variantLines.map((l) => ({ label: l.name, color: l.color, points: l.pct }))}
                onPick={onPick}
                highlight={highlight}
              />
            </figure>
          )}
        </>
      ) : (
        <figure className="bd-chart bd-big bd-wide">
          <figcaption>
            <strong>e1RM por semana · {v}</strong>
            <span>kg · curva RTS, mejor serie de la semana</span>
          </figcaption>
          <OverviewChart
            title={`e1RM ${v}`}
            unit="kg"
            zoom
            period={weeks.length ? { from: weeks[0] as string, to: today } : undefined}
            bands={blocks.map((b) => ({ from: b.from, to: b.to, color: b.color, label: b.key }))}
            traces={[
              { label: 'Realizado', color, points: e1Real },
              { label: 'Previsto (RPE objetivo)', color: '#8d98a3', points: e1Plan, dashed: true },
            ]}
            onPick={onPick}
            highlight={highlight}
          />
        </figure>
      )}
      {v === '__all__' &&
        blocks.some(
          (b) => !weeks.some((k) => k >= monday(b.from) && k <= b.to && aggR.get(k)?.e1 != null),
        ) && (
          <p className="small bd-note">
            Sin e1RM de la competición en:{' '}
            {blocks
              .filter((b) => !weeks.some((k) => k >= monday(b.from) && k <= b.to && aggR.get(k)?.e1 != null))
              .map((b) => b.key)
              .join(', ')}{' '}
            (en esos bloques no se hizo {LIFT_FULL[lift].toLowerCase()} de competición). Elegí una variante
            para ver su e1RM.
          </p>
        )}
      <div className="bd-grid2 bd-bigs">
        <Compare
          title="NL"
          unit="rep."
          pts={pt((a) => a.nl)}
          paired={hasReal}
          onPick={onPick}
          highlight={highlight}
        />
        <Compare
          title="Tonelaje"
          unit="kg"
          pts={pt((a) => a.tonnage)}
          paired={hasReal}
          onPick={onPick}
          highlight={highlight}
        />
        <Compare
          title="SI total"
          unit="SI"
          pts={pt((a) => a.si)}
          paired={hasReal}
          onPick={onPick}
          highlight={highlight}
        />
        <Compare
          title="Series"
          unit="series"
          pts={pt((a) => a.sets)}
          paired={hasReal}
          onPick={onPick}
          highlight={highlight}
        />
      </div>
      <h4>{LIFT_FULL[lift]} · resumen por bloque</h4>
      <div className="bd-table bd-weeks">
        <table>
          <thead>
            <tr>
              <th>Bloque</th>
              <th>Fechas</th>
              <th>Sem.</th>
              <th>Series</th>
              <th>NL</th>
              <th>Tonelaje (kg)</th>
              <th>SI</th>
              <th>e1RM máx.</th>
              <th>Δ vs bloque anterior</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const prev = i > 0 ? rows[i - 1]!.best : null;
              const d = r.best !== null && prev !== null ? r.best - prev : null;
              return (
                <tr key={r.b.key}>
                  <td>
                    <i style={{ background: r.b.color }} /> {r.b.key}
                  </td>
                  <td>
                    {dateLabel(r.b.from)} – {dateLabel(r.b.to)}
                  </td>
                  <td>{r.weeks}</td>
                  <td>{fmt(r.sets)}</td>
                  <td>{fmt(r.nl)}</td>
                  <td>{fmt(r.tonnage)}</td>
                  <td>{fmt(r.si)}</td>
                  <td>{r.best === null ? '—' : number(r.best, 1)}</td>
                  <td className={d === null ? '' : d >= 0 ? 'bd-ok' : 'bd-low'}>
                    {d === null ? '—' : `${d >= 0 ? '▲' : '▼'} ${number(Math.abs(d), 1)} kg`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- detalle de un bloque y de una semana (por movimiento): de dónde venimos, qué cambió, qué se hizo ---------- */
interface LiftW {
  nl: number | null;
  sets: number | null;
  tonnage: number | null;
  si: number | null;
  /** e1RM de la familia «comp» (competición). */
  e1c: number | null;
  /** e1RM del ejercicio que el coach marcó como principal (prioridad 1) de ese movimiento. */
  e1p: number | null;
  rpe: number | null;
  planNl: number | null;
}
interface WStat {
  from: string;
  to: string;
  sessions: number;
  done: boolean;
  nl: number | null;
  sets: number | null;
  tonnage: number | null;
  si: number | null;
  planNl: number | null;
  fatigue: number | null;
  lifts: Record<Lift, LiftW>;
}
const LIFTS_ALL: Lift[] = ['SQ', 'BP', 'DL'];
const pctTxt = (a: number | null, b: number | null) =>
  a === null || b === null || b === 0
    ? '—'
    : `${a >= b ? '+' : '−'}${number(Math.abs(((a - b) / b) * 100), 0)} %`;
const diffTone = (d: number | null, goodWhenUp = true) =>
  d === null || Math.abs(d) < 1e-9 ? '' : d > 0 === goodWhenUp ? 'bd-ok' : 'bd-low';
const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const maxOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.max(...v) : null;
};
const num1 = (v: number | null) => (v === null ? '—' : number(v, 1));

function weekStats(real: Core, plan: Core, today: string): WStat[] {
  const rw = new Map(real.weeks.map((w) => [w.week.from, w]));
  const rpe = new Map<string, { s: number; n: number }>();
  for (const s of real.sessions)
    for (const e of s.exercises)
      for (const x of e.fatigueBetweenSets?.sets ?? []) {
        const tr = x.target?.rpe ?? null;
        if (x.rpe === null || tr === null || !e.lift) continue;
        const k = `${e.lift}|${monday(s.date)}`;
        const a = rpe.get(k) ?? { s: 0, n: 0 };
        a.s += x.rpe - tr;
        a.n += 1;
        rpe.set(k, a);
      }
  const aggR = Object.fromEntries(
    LIFTS_ALL.map((l) => [l, aggregate(real.sessions, l, '__all__')]),
  ) as Record<Lift, Map<string, Agg>>;
  const aggP = Object.fromEntries(
    LIFTS_ALL.map((l) => [l, aggregate(plan.sessions, l, '__all__')]),
  ) as Record<Lift, Map<string, Agg>>;
  return plan.weeks
    .filter((w) => w.sessions > 0)
    .map((w) => {
      const r = rw.get(w.week.from);
      const done = w.week.from <= today && !!r && r.sessions > 0;
      const lifts = Object.fromEntries(
        LIFTS_ALL.map((l) => {
          const a = done ? aggR[l].get(w.week.from) : undefined;
          const p = aggP[l].get(w.week.from);
          const q = rpe.get(`${l}|${w.week.from}`);
          return [
            l,
            {
              nl: a?.nl ?? null,
              sets: a?.sets ?? null,
              tonnage: a?.tonnage ?? null,
              si: a?.si ?? null,
              e1c: a?.e1 ?? null,
              e1p: a?.e1p ?? null,
              rpe: q ? q.s / q.n : null,
              planNl: p?.nl ?? null,
            },
          ];
        }),
      ) as Record<Lift, LiftW>;
      return {
        from: w.week.from,
        to: w.week.to,
        sessions: done ? (r as Week).sessions : w.sessions,
        done,
        nl: done ? (r as Week).totals.nl.value : null,
        sets: done ? (r as Week).totals.sets.value : null,
        tonnage: done ? (r as Week).totals.tonnage.value : null,
        si: done ? (r as Week).totals.si.rts.total.value : null,
        planNl: w.totals.nl.value,
        fatigue: r?.fatigue?.endFatigue?.mean ?? null,
        lifts,
      };
    });
}

interface LiftSum {
  weeks: number;
  nl: number;
  sets: number;
  tonnage: number;
  si: number;
  nlW: number | null;
  setsW: number | null;
  tonnageW: number | null;
  siW: number | null;
  rpe: number | null;
  e1c: number | null;
  e1p: number | null;
  adh: number | null;
}
interface BSum {
  weeks: number;
  sessions: number;
  sessW: number | null;
  fatigue: number | null;
  nl: number;
  sets: number;
  tonnage: number;
  si: number;
  adh: number | null;
  lifts: Record<Lift, LiftSum>;
}
/** Resumen de un conjunto de semanas por movimiento (promedios por semana, para comparar bloques de distinta duración). */
function blockSummary(ws: WStat[]): BSum {
  const d = ws.filter((w) => w.done);
  const lifts = Object.fromEntries(
    LIFTS_ALL.map((l) => {
      const x = d.map((w) => w.lifts[l]).filter((v) => v.nl !== null);
      const p = x.reduce((a, v) => a + (v.planNl ?? 0), 0);
      const r = x.reduce((a, v) => a + (v.nl ?? 0), 0);
      return [
        l,
        {
          weeks: x.length,
          nl: r,
          sets: x.reduce((a, v) => a + (v.sets ?? 0), 0),
          tonnage: x.reduce((a, v) => a + (v.tonnage ?? 0), 0),
          si: x.reduce((a, v) => a + (v.si ?? 0), 0),
          nlW: mean(x.map((v) => v.nl)),
          setsW: mean(x.map((v) => v.sets)),
          tonnageW: mean(x.map((v) => v.tonnage)),
          siW: mean(x.map((v) => v.si)),
          rpe: mean(x.map((v) => v.rpe)),
          e1c: maxOf(x.map((v) => v.e1c)),
          e1p: maxOf(x.map((v) => v.e1p)),
          adh: p ? (r / p) * 100 : null,
        },
      ];
    }),
  ) as Record<Lift, LiftSum>;
  const pn = d.reduce((a, w) => a + (w.planNl ?? 0), 0);
  const rn = d.reduce((a, w) => a + (w.nl ?? 0), 0);
  return {
    weeks: d.length,
    sessions: d.reduce((a, w) => a + w.sessions, 0),
    sessW: mean(d.map((w) => w.sessions)),
    fatigue: mean(d.map((w) => w.fatigue)),
    nl: rn,
    sets: d.reduce((a, w) => a + (w.sets ?? 0), 0),
    tonnage: d.reduce((a, w) => a + (w.tonnage ?? 0), 0),
    si: d.reduce((a, w) => a + (w.si ?? 0), 0),
    adh: pn ? (rn / pn) * 100 : null,
    lifts,
  };
}

interface Fact {
  text: string;
  weight: number;
}
/** Lectura automática y DESCRIPTIVA de una semana frente a otra, por movimiento: qué cambió (umbrales fijos) y posibles lecturas a validar. No prueba causas. */
function reading(cur: WStat, prev: WStat | null, lifts: Lift[]) {
  const facts: Fact[] = [];
  const notes: string[] = [];
  if (!prev || !cur.done || !prev.done)
    return { facts, notes: ['No hay una semana anterior ejecutada para comparar.'] };
  if (cur.sessions !== prev.sessions)
    facts.push({ text: `Sesiones: ${prev.sessions} → ${cur.sessions}`, weight: 40 });
  const dFat = cur.fatigue !== null && prev.fatigue !== null ? cur.fatigue - prev.fatigue : null;
  if (dFat !== null && Math.abs(dFat) >= 1)
    facts.push({
      text: `Fatiga al terminar la sesión: ${num1(prev.fatigue)} → ${num1(cur.fatigue)}`,
      weight: 30 + Math.abs(dFat) * 10,
    });
  for (const l of lifts) {
    const c = cur.lifts[l];
    const p = prev.lifts[l];
    if (c.nl === null || p.nl === null) continue;
    const name = LIFT_FULL[l];
    const rel = (what: string, a: number | null, b: number | null, unit = '') => {
      if (a === null || b === null || b === 0) return null;
      const pc = ((a - b) / b) * 100;
      if (Math.abs(pc) >= 15)
        facts.push({
          text: `${name} · ${what}: ${number(b, 0)}${unit} → ${number(a, 0)}${unit} (${pc > 0 ? '+' : '−'}${number(Math.abs(pc), 0)} %)`,
          weight: Math.abs(pc),
        });
      return pc;
    };
    const nl = rel('NL', c.nl, p.nl);
    rel('Series', c.sets, p.sets);
    rel('Tonelaje', c.tonnage, p.tonnage, ' kg');
    const si = rel('SI', c.si, p.si);
    const dRpe = c.rpe !== null && p.rpe !== null ? c.rpe - p.rpe : null;
    if (dRpe !== null && Math.abs(dRpe) >= 0.5)
      facts.push({
        text: `${name} · RPE real − objetivo: ${num1(p.rpe)} → ${num1(c.rpe)} (${dRpe > 0 ? 'más' : 'menos'} esfuerzo del previsto)`,
        weight: 30 + Math.abs(dRpe) * 10,
      });
    let drop = false;
    let up = false;
    for (const [lab, a, b] of [
      ['e1RM principal', c.e1p, p.e1p],
      ['e1RM competición', c.e1c, p.e1c],
    ] as const) {
      if (a === null || b === null) continue;
      const pc = ((a - b) / b) * 100;
      if (Math.abs(pc) >= 2) {
        facts.push({
          text: `${name} · ${lab}: ${number(b, 1)} → ${number(a, 1)} kg (${pc > 0 ? '+' : '−'}${number(Math.abs(pc), 1)} %)`,
          weight: 60 + Math.abs(pc),
        });
        if (pc < 0) drop = true;
        else up = true;
      }
    }
    const lessVol = (nl ?? 0) <= -15 || (si ?? 0) <= -15;
    const moreEffort = (dRpe !== null && dRpe >= 0.5) || (dFat !== null && dFat >= 1);
    if (drop && lessVol && !moreEffort)
      notes.push(
        `${name}: el e1RM bajó junto con menos volumen/estrés y sin más esfuerzo percibido: compatible con una descarga o afinamiento planificado.`,
      );
    if (drop && moreEffort)
      notes.push(
        `${name}: el e1RM bajó con más esfuerzo percibido o más fatiga: compatible con fatiga acumulada; revisá la semana anterior y el descanso.`,
      );
    if (drop && !lessVol && !moreEffort)
      notes.push(
        `${name}: el e1RM bajó sin cambios claros de volumen ni de esfuerzo: revisá si cambió el ejercicio o la variante que aporta el e1RM esa semana.`,
      );
    if (up && dRpe !== null && dRpe <= -0.5)
      notes.push(
        `${name}: el e1RM subió con menos esfuerzo del previsto: compatible con una buena adaptación.`,
      );
  }
  if (!facts.length)
    notes.push(
      'Sin cambios relevantes (umbrales: ±15 % en volumen y estrés, 0,5 de RPE, 1 punto de fatiga, 2 % en e1RM).',
    );
  else notes.push('Posible lectura (hipótesis a validar con el coach; no prueba una causa).');
  return { facts: facts.sort((a, b) => b.weight - a.weight).slice(0, 12), notes };
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Tabla por movimiento: bloque A (anterior) frente a bloque B. Cada medida separada por Sentadilla / Banca / Peso muerto. */
function LiftCompareTable({
  a,
  b,
  aName,
  bName,
  lifts,
}: {
  a: BSum | null;
  b: BSum;
  aName: string;
  bName: string;
  lifts: Lift[];
}) {
  const rows: {
    name: string;
    get: (s: LiftSum) => number | null;
    fmt: (v: number | null) => string;
    up: boolean;
    abs?: boolean;
  }[] = [
    { name: 'Series por semana', get: (s) => s.setsW, fmt: (v) => fmt(v), up: true },
    { name: 'NL por semana', get: (s) => s.nlW, fmt: (v) => fmt(v), up: true },
    { name: 'Tonelaje por semana (kg)', get: (s) => s.tonnageW, fmt: (v) => fmt(v), up: true },
    { name: 'SI por semana', get: (s) => s.siW, fmt: (v) => fmt(v), up: true },
    { name: 'RPE real − objetivo', get: (s) => s.rpe, fmt: num1, up: false, abs: true },
    { name: 'e1RM principal máx. (kg)', get: (s) => s.e1p, fmt: num1, up: true, abs: true },
    { name: 'e1RM competición máx. (kg)', get: (s) => s.e1c, fmt: num1, up: true, abs: true },
    { name: 'Cumplimiento del NL previsto (%)', get: (s) => s.adh, fmt: (v) => fmt(v), up: true, abs: true },
  ];
  return (
    <div className="bd-table bd-weeks">
      <table>
        <thead>
          <tr>
            <th>Medida</th>
            <th>{aName}</th>
            <th>{bName}</th>
            <th>Cambio</th>
          </tr>
        </thead>
        <tbody>
          {lifts.map((l) => (
            <Fragment key={l}>
              <tr className="bd-lifthead" style={{ borderLeft: `5px solid ${LIFT_COLOR[l]}` }}>
                <td colSpan={4}>{LIFT_FULL[l]}</td>
              </tr>
              {rows.map((r) => {
                const x = a ? r.get(a.lifts[l]) : null;
                const y = r.get(b.lifts[l]);
                const d = x !== null && y !== null ? y - x : null;
                return (
                  <tr key={l + r.name}>
                    <td>{r.name}</td>
                    <td>{r.fmt(x)}</td>
                    <td>{r.fmt(y)}</td>
                    <td className={diffTone(d, r.up)}>
                      {d === null
                        ? '—'
                        : r.abs
                          ? `${d > 0 ? '▲' : '▼'} ${number(Math.abs(d), 1)}`
                          : `${d > 0 ? '▲' : '▼'} ${pctTxt(y, x)}`}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
          <tr className="bd-lifthead">
            <td colSpan={4}>General (no depende del movimiento)</td>
          </tr>
          {(
            [
              ['Sesiones por semana', a?.sessW ?? null, b.sessW, true],
              ['Fatiga al terminar la sesión (1–10)', a?.fatigue ?? null, b.fatigue, false],
            ] as [string, number | null, number | null, boolean][]
          ).map(([name, x, y, up]) => {
            const d = x !== null && y !== null ? y - x : null;
            return (
              <tr key={name}>
                <td>{name}</td>
                <td>{num1(x)}</td>
                <td>{num1(y)}</td>
                <td className={diffTone(d, up)}>
                  {d === null ? '—' : `${d > 0 ? '▲' : '▼'} ${number(Math.abs(d), 1)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const exName = (e: Session['exercises'][number]) => e.exerciseName;
/** Ejercicios de una semana: por ejercicio, prioridad del coach, series, NL, tonelaje, SI, e1RM (solo movimientos), RPE y serie más pesada. */
function weekExercises(sessions: Session[], mov: Mov) {
  const m = new Map<
    string,
    {
      lift: string | null;
      prio: number | null;
      sessions: number;
      sets: number;
      nl: number;
      ton: number;
      si: number;
      e1: number | null;
      rpe: number[];
      top: { kg: number; reps: number | null; rpe: number | null } | null;
    }
  >();
  for (const s of sessions)
    for (const e of s.exercises) {
      if (mov !== 'ALL' && e.lift !== mov) continue;
      const a = m.get(exName(e)) ?? {
        lift: e.lift,
        prio: e.priority ?? null,
        sessions: 0,
        sets: 0,
        nl: 0,
        ton: 0,
        si: 0,
        e1: null,
        rpe: [],
        top: null,
      };
      a.sessions += 1;
      a.sets += e.metrics?.sets.value ?? 0;
      a.nl += e.metrics?.nl.value ?? 0;
      a.ton += e.metrics?.tonnage.value ?? 0;
      a.si += e.metrics?.si.rts.total.value ?? 0;
      const v = e.metrics?.e1rm.curve.value ?? null;
      if (v !== null) a.e1 = Math.max(a.e1 ?? 0, v);
      if (e.priority != null && (a.prio === null || e.priority < a.prio)) a.prio = e.priority;
      for (const x of e.fatigueBetweenSets?.sets ?? []) {
        if (x.rpe !== null && x.target?.rpe != null) a.rpe.push(x.rpe - x.target.rpe);
        if (x.kg !== null && (a.top === null || x.kg > a.top.kg))
          a.top = { kg: x.kg, reps: x.reps, rpe: x.rpe };
      }
      m.set(exName(e), a);
    }
  return [...m.entries()]
    .map(([name, a]) => ({ name, ...a, rpeMean: mean(a.rpe) }))
    .sort((x, y) => (x.prio ?? 9) - (y.prio ?? 9) || y.sets - x.sets);
}
/** Sesiones filtradas por movimiento, con sus totales recalculados solo con los ejercicios de ese movimiento. */
function sessionsFor(sessions: Session[], mov: Mov): Session[] {
  if (mov === 'ALL') return sessions;
  const out: Session[] = [];
  for (const s of sessions) {
    const ex = s.exercises.filter((e) => e.lift === mov);
    if (!ex.length) continue;
    const sum = (f: (e: Session['exercises'][number]) => number | null) =>
      ex.reduce((t, e) => t + (f(e) ?? 0), 0);
    out.push({
      ...s,
      exercises: ex,
      totals: {
        ...s.totals,
        nl: asVal(sum((e) => e.metrics?.nl.value ?? null)),
        sets: asVal(sum((e) => e.metrics?.sets.value ?? null)),
        tonnage: asVal(sum((e) => e.metrics?.tonnage.value ?? null)),
        si: { rts: { ...s.totals.si.rts, total: asVal(sum((e) => e.metrics?.si.rts.total.value ?? null)) } },
      },
    });
  }
  return out;
}

function BlockDetail({
  real,
  plan,
  blocks,
  block,
  week,
  today,
  mov,
  colorAt,
  onWeek,
  onBlock,
}: {
  real: Core;
  plan: Core;
  blocks: Block[];
  block: Block;
  week: string;
  today: string;
  mov: Mov;
  colorAt: (d: string) => string;
  onWeek: (w: string) => void;
  onBlock: (k: string) => void;
}) {
  const [copied, setCopied] = useState('');
  const shownLifts: Lift[] = mov === 'ALL' ? LIFTS_ALL : [mov];
  const all = useMemo(() => weekStats(real, plan, today), [real, plan, today]);
  const inB = (b: Block) => all.filter((w) => w.from >= monday(b.from) && w.from <= b.to);
  const ws = inB(block);
  const idx = blocks.findIndex((b) => b.key === block.key);
  const prevBlock = [...blocks.slice(0, idx)].reverse().find((b) => inB(b).some((w) => w.done)) ?? null;
  const nextBlock = blocks[idx + 1] ?? null;
  const sum = blockSummary(ws);
  const psum = prevBlock ? blockSummary(inB(prevBlock)) : null;
  const sel = ws.find((w) => w.from === week) ?? null;
  const selIdx = sel ? ws.indexOf(sel) : -1;
  const prevWeek =
    selIdx > 0
      ? (ws[selIdx - 1] as WStat)
      : selIdx === 0 && prevBlock
        ? (inB(prevBlock)
            .filter((w) => w.done)
            .slice(-1)[0] ?? null)
        : null;
  const rd = sel ? reading(sel, prevWeek, shownLifts) : null;
  const wk = sel ? (sel.done ? real : plan).sessions.filter((s) => monday(s.date) === sel.from) : [];
  const shown = sessionsFor(wk, mov);
  const exs = weekExercises(wk, mov);
  const realWeek = sel ? real.weeks.find((w) => w.week.from === sel.from) : undefined;
  const weekAvg = (l: Lift, f: (v: LiftW) => number | null) =>
    mean(ws.filter((w) => w.done).map((w) => f(w.lifts[l])));
  const summaryText = () => {
    const L: string[] = [];
    L.push(
      `# ${block.key} · ${dateLabel(block.from)} – ${dateLabel(block.to)}${mov === 'ALL' ? '' : ' · ' + LIFT_FULL[mov]}`,
    );
    L.push(`Semanas ejecutadas: ${sum.weeks} · Sesiones: ${sum.sessions}`);
    for (const l of shownLifts) {
      const s = sum.lifts[l];
      L.push(
        `- ${LIFT_FULL[l]}: series ${fmt(s.sets)} · NL ${fmt(s.nl)} · tonelaje ${fmt(s.tonnage)} kg · SI ${fmt(s.si)} · e1RM principal máx ${num1(s.e1p)} · e1RM competición máx ${num1(s.e1c)} · cumplimiento NL ${s.adh === null ? '—' : number(s.adh, 0) + ' %'}`,
      );
    }
    if (prevBlock && psum) {
      L.push('', `## De dónde venimos (vs ${prevBlock.key})`);
      for (const l of shownLifts) {
        const x = psum.lifts[l];
        const y = sum.lifts[l];
        L.push(
          `### ${LIFT_FULL[l]}`,
          `- NL/sem: ${fmt(x.nlW)} → ${fmt(y.nlW)} (${pctTxt(y.nlW, x.nlW)})`,
          `- Tonelaje/sem: ${fmt(x.tonnageW)} → ${fmt(y.tonnageW)} (${pctTxt(y.tonnageW, x.tonnageW)})`,
          `- SI/sem: ${fmt(x.siW)} → ${fmt(y.siW)} (${pctTxt(y.siW, x.siW)})`,
          `- e1RM principal máx: ${num1(x.e1p)} → ${num1(y.e1p)}`,
          `- e1RM competición máx: ${num1(x.e1c)} → ${num1(y.e1c)}`,
          `- RPE real−obj: ${num1(x.rpe)} → ${num1(y.rpe)}`,
        );
      }
    }
    L.push('', '## Semana a semana (por movimiento)');
    for (const l of shownLifts) {
      L.push(
        `### ${LIFT_FULL[l]}`,
        'Sem | Fechas | Series | NL | Tonelaje | SI | RPE real−obj | e1RM principal | e1RM competición',
      );
      ws.forEach((w, i) => {
        const v = w.lifts[l];
        L.push(
          [
            i + 1,
            `${w.from}..${w.to}`,
            fmt(v.sets),
            fmt(v.nl),
            fmt(v.tonnage),
            fmt(v.si),
            num1(v.rpe),
            num1(v.e1p),
            num1(v.e1c),
          ].join(' | '),
        );
      });
    }
    if (sel && rd) {
      L.push('', `## Semana ${selIdx + 1} (${sel.from}..${sel.to}) vs la anterior`);
      for (const f of rd.facts) L.push(`- ${f.text}`);
      for (const n of rd.notes) L.push(`- ${n}`);
    }
    L.push(
      '',
      '_Lectura descriptiva generada por reglas fijas. Si la ejecución es simulada, también lo son estos números._',
    );
    return L.join('\n');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summaryText());
      setCopied('Copiado');
    } catch {
      setCopied('No se pudo copiar: usá «Descargar»');
    }
    setTimeout(() => setCopied(''), 2500);
  };
  const csv = () => {
    const rows = [
      [
        'semana',
        'desde',
        'hasta',
        'movimiento',
        'series',
        'nl',
        'tonelaje_kg',
        'si_rts',
        'nl_previsto',
        'rpe_real_menos_objetivo',
        'e1rm_principal',
        'e1rm_competicion',
      ],
    ];
    ws.forEach((w, i) => {
      for (const l of shownLifts) {
        const v = w.lifts[l];
        rows.push([
          String(i + 1),
          w.from,
          w.to,
          l,
          String(v.sets ?? ''),
          String(v.nl ?? ''),
          String(v.tonnage ?? ''),
          String(v.si ?? ''),
          String(v.planNl ?? ''),
          String(v.rpe ?? ''),
          String(v.e1p ?? ''),
          String(v.e1c ?? ''),
        ]);
      }
    });
    download(`${block.key}-semanas.csv`, rows.map((r) => r.join(',')).join('\n'), 'text/csv');
  };
  const nlPts: Pt[] = ws.map((w) => ({
    x: w.from,
    a: shownLifts.reduce((t, l) => t + (w.lifts[l].planNl ?? 0), 0),
    b: shownLifts.reduce((t, l) => t + (w.lifts[l].nl ?? 0), 0),
    tip: block.key,
    color: block.color,
  }));
  const period = ws.length
    ? { from: ws[0]!.from, to: ws[ws.length - 1]!.to < today ? ws[ws.length - 1]!.to : today }
    : undefined;
  return (
    <div className="bd-detail-block">
      <div className="bd-dhead">
        <div>
          <h4 style={{ borderLeft: `6px solid ${block.color}`, paddingLeft: 10 }}>
            {block.key}{' '}
            <small>
              {dateLabel(block.from)} – {dateLabel(block.to)} · {ws.length} semanas · {sum.weeks} ejecutadas
              {mov !== 'ALL' ? ` · ${LIFT_FULL[mov]}` : ''}
            </small>
          </h4>
          <p className="small bd-note">
            Hacé clic en una semana (tabla o cualquier gráfico) para ver su microciclo. Todo se separa por
            movimiento.
          </p>
        </div>
        <div className="bd-dactions">
          <button type="button" disabled={!prevBlock} onClick={() => prevBlock && onBlock(prevBlock.key)}>
            ← {prevBlock?.key ?? 'anterior'}
          </button>
          <button type="button" disabled={!nextBlock} onClick={() => nextBlock && onBlock(nextBlock.key)}>
            {nextBlock?.key ?? 'siguiente'} →
          </button>
          <button type="button" onClick={copy}>
            {copied || 'Copiar resumen'}
          </button>
          <button type="button" onClick={csv}>
            Descargar CSV
          </button>
        </div>
      </div>
      <div className="bd-lifts-kpis">
        {shownLifts.map((l) => {
          const s = sum.lifts[l];
          return (
            <div key={l} className="bd-liftcard" style={{ borderTop: `4px solid ${LIFT_COLOR[l]}` }}>
              <h5>{LIFT_FULL[l]}</h5>
              <dl>
                <div>
                  <dt>Series</dt>
                  <dd>{fmt(s.sets)}</dd>
                </div>
                <div>
                  <dt>NL</dt>
                  <dd>{fmt(s.nl)}</dd>
                </div>
                <div>
                  <dt>Tonelaje</dt>
                  <dd>{fmt(s.tonnage)} kg</dd>
                </div>
                <div>
                  <dt>SI</dt>
                  <dd>{fmt(s.si)}</dd>
                </div>
                <div>
                  <dt>e1RM principal</dt>
                  <dd>{num1(s.e1p)}</dd>
                </div>
                <div>
                  <dt>e1RM competición</dt>
                  <dd>{num1(s.e1c)}</dd>
                </div>
                <div>
                  <dt>Cumplimiento</dt>
                  <dd>{s.adh === null ? '—' : `${number(s.adh, 0)} %`}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      <h4>De dónde venimos{prevBlock ? ` · ${prevBlock.key} → ${block.key}` : ''} · por movimiento</h4>
      {psum || sum.weeks ? (
        <LiftCompareTable
          a={psum}
          b={sum}
          aName={prevBlock?.key ?? 'sin bloque anterior'}
          bName={block.key}
          lifts={shownLifts}
        />
      ) : (
        <p className="small">Todavía no hay semanas ejecutadas en este bloque.</p>
      )}

      <div className="bd-grid2 bd-bigs">
        <Compare
          title={`NL por semana${mov === 'ALL' ? '' : ' · ' + LIFT_FULL[mov]}`}
          unit="rep."
          pts={nlPts}
          paired
          onPick={onWeek}
          highlight={week}
        />
        <figure className="bd-chart bd-big">
          <figcaption>
            <strong>e1RM principal por semana</strong>
            <span>kg · ejercicio de prioridad 1 de cada movimiento</span>
          </figcaption>
          <OverviewChart
            title="e1RM principal"
            unit="kg"
            zoom
            period={period}
            traces={shownLifts.map((l) => ({
              label: LIFT_FULL[l],
              color: LIFT_COLOR[l],
              points: ws.map((w) => ({ date: w.from, value: w.lifts[l].e1p })),
            }))}
            onPick={onWeek}
            highlight={week}
          />
        </figure>
      </div>

      {shownLifts.map((l) => (
        <Fragment key={l}>
          <h4 style={{ borderLeft: `6px solid ${LIFT_COLOR[l]}`, paddingLeft: 10 }}>
            Semana a semana · {LIFT_FULL[l]}
          </h4>
          <div className="bd-table bd-weeks">
            <table>
              <thead>
                <tr>
                  <th>Sem.</th>
                  <th>Fechas</th>
                  <th>Series</th>
                  <th>NL</th>
                  <th>Tonelaje</th>
                  <th>SI</th>
                  <th title="Promedio de RPE real menos RPE objetivo">RPE real−obj</th>
                  <th>e1RM principal</th>
                  <th>e1RM comp.</th>
                  <th>NL prev.</th>
                  <th>Cumpl.</th>
                </tr>
              </thead>
              <tbody>
                {ws.map((w, i) => {
                  const v = w.lifts[l];
                  return (
                    <tr
                      key={w.from}
                      className={`bd-click ${w.from === week ? 'bd-selected' : ''} ${w.done ? '' : 'bd-future'}`}
                      onClick={() => onWeek(w.from)}
                    >
                      <td>{i + 1}</td>
                      <td>
                        {dateLabel(w.from)} – {dateLabel(w.to)}
                      </td>
                      <td>{fmt(v.sets)}</td>
                      <td>{fmt(v.nl)}</td>
                      <td>{fmt(v.tonnage)}</td>
                      <td>{fmt(v.si)}</td>
                      <td>{num1(v.rpe)}</td>
                      <td>{num1(v.e1p)}</td>
                      <td>{num1(v.e1c)}</td>
                      <td>{fmt(v.planNl)}</td>
                      <td>
                        {w.done && v.planNl && v.nl !== null
                          ? `${number((v.nl / v.planNl) * 100, 0)} %`
                          : w.done
                            ? '—'
                            : 'pendiente'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Fragment>
      ))}

      {sel ? (
        <section className="bd-week-panel" style={{ borderTop: `4px solid ${colorAt(sel.from)}` }}>
          <div className="bd-dhead">
            <h4>
              Microciclo · semana {selIdx + 1} · {dateLabel(sel.from)} – {dateLabel(sel.to)}
              {!sel.done && <small> · todavía no ejecutada (se muestra lo previsto)</small>}
            </h4>
            <div className="bd-dactions">
              <button
                type="button"
                disabled={selIdx <= 0}
                onClick={() => selIdx > 0 && onWeek((ws[selIdx - 1] as WStat).from)}
              >
                ← semana anterior
              </button>
              <button
                type="button"
                disabled={selIdx >= ws.length - 1}
                onClick={() => selIdx < ws.length - 1 && onWeek((ws[selIdx + 1] as WStat).from)}
              >
                semana siguiente →
              </button>
            </div>
          </div>
          <p className="small bd-note">
            {sel.sessions} sesiones · fatiga al terminar la sesión {num1(sel.fatigue)} ·{' '}
            {sel.done ? 'ejecutada' : 'prevista'}
          </p>
          {shownLifts.map((l) => {
            const c = sel.lifts[l];
            const p = prevWeek?.lifts[l];
            const rowsW: [string, number | null, number | null, number | null, boolean, boolean][] = [
              ['Series', c.sets, p?.sets ?? null, weekAvg(l, (v) => v.sets), true, false],
              ['NL', c.nl, p?.nl ?? null, weekAvg(l, (v) => v.nl), true, false],
              ['Tonelaje (kg)', c.tonnage, p?.tonnage ?? null, weekAvg(l, (v) => v.tonnage), true, false],
              ['SI', c.si, p?.si ?? null, weekAvg(l, (v) => v.si), true, false],
              ['RPE real − objetivo', c.rpe, p?.rpe ?? null, weekAvg(l, (v) => v.rpe), false, true],
              ['e1RM principal (kg)', c.e1p, p?.e1p ?? null, weekAvg(l, (v) => v.e1p), true, true],
              ['e1RM competición (kg)', c.e1c, p?.e1c ?? null, weekAvg(l, (v) => v.e1c), true, true],
            ];
            return (
              <div key={l} className="bd-table bd-weeks" style={{ marginBottom: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ borderLeft: `5px solid ${LIFT_COLOR[l]}` }}>{LIFT_FULL[l]}</th>
                      <th>Esta semana</th>
                      <th>Semana anterior</th>
                      <th>Cambio</th>
                      <th>Promedio del bloque</th>
                      <th>vs promedio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsW.map(([name, a, b, m, up, abs]) => {
                      const d = a !== null && b !== null ? a - b : null;
                      const dm = a !== null && m !== null ? a - m : null;
                      const f = (v: number | null) => (v === null ? '—' : abs ? number(v, 1) : number(v, 0));
                      const chg = (x: number | null, y: number | null, dd: number | null) =>
                        dd === null
                          ? '—'
                          : abs
                            ? `${dd > 0 ? '▲' : '▼'} ${number(Math.abs(dd), 1)}`
                            : `${dd > 0 ? '▲' : '▼'} ${pctTxt(x, y)}`;
                      return (
                        <tr key={name}>
                          <td>{name}</td>
                          <td>{f(a)}</td>
                          <td>{f(b)}</td>
                          <td className={diffTone(d, up)}>{chg(a, b, d)}</td>
                          <td>{f(m)}</td>
                          <td className={diffTone(dm, up)}>{chg(a, m, dm)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
          <h5>Ejercicios del microciclo · ordenados por la prioridad que le diste en la planilla</h5>
          <div className="bd-table bd-weeks">
            <table>
              <thead>
                <tr>
                  <th>Ejercicio</th>
                  <th>Prio</th>
                  <th>Movimiento</th>
                  <th>Ses.</th>
                  <th>Series</th>
                  <th>NL</th>
                  <th>Tonelaje</th>
                  <th>SI</th>
                  <th>e1RM</th>
                  <th>RPE real−obj</th>
                  <th>Serie más pesada</th>
                </tr>
              </thead>
              <tbody>
                {exs.map((e) => (
                  <tr key={e.name}>
                    <td>{e.name}</td>
                    <td>{e.prio ? `${e.prio}°` : '—'}</td>
                    <td>{e.lift ? LIFT_FULL[e.lift as Lift] : 'Accesorio'}</td>
                    <td>{e.sessions}</td>
                    <td>{fmt(e.sets)}</td>
                    <td>{fmt(e.nl)}</td>
                    <td>{fmt(e.ton)}</td>
                    <td>{fmt(e.si)}</td>
                    <td>{e.lift ? num1(e.e1) : 'no aplica'}</td>
                    <td>{num1(e.rpeMean)}</td>
                    <td>
                      {e.top
                        ? `${number(e.top.kg, 1)} kg × ${e.top.reps ?? '?'}${e.top.rpe !== null ? ` @${number(e.top.rpe, 1)}` : ''}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {realWeek && realWeek.patterns.rows.length > 0 && (
            <HBars
              title="Series por patrón de movimiento en la semana"
              unit="series"
              rows={realWeek.patterns.rows
                .slice()
                .sort((a, b) => b.sets - a.sets)
                .map((p) => ({ name: label(p.pattern), value: p.sets, sub: `NL ${p.nl}` }))}
            />
          )}
          {rd && (
            <div className="bd-reading">
              <h5>Lectura de la semana {prevWeek ? `(vs ${dateLabel(prevWeek.from)})` : ''}</h5>
              {rd.facts.length > 0 && (
                <ul>
                  {rd.facts.map((f) => (
                    <li key={f.text}>{f.text}</li>
                  ))}
                </ul>
              )}
              {rd.notes.map((n) => (
                <p key={n} className="small">
                  {n}
                </p>
              ))}
            </div>
          )}
          <h5>Sesiones del microciclo · tocá una para ver sus series</h5>
          <SessionList
            sessions={shown.slice().sort((a, b) => a.date.localeCompare(b.date))}
            colorAt={colorAt}
          />
        </section>
      ) : (
        <p className="small bd-note">
          Elegí una semana (tabla o gráficos) para ver su microciclo: comparación por movimiento, ejercicios,
          lectura y sesiones.
        </p>
      )}
    </div>
  );
}

/** Comparativa general: todos los bloques lado a lado por movimiento (con mejor/peor resaltados), gráfico por bloque y comparación A vs B. */
function BlockCompare({
  real,
  plan,
  blocks,
  today,
  mov,
}: {
  real: Core;
  plan: Core;
  blocks: Block[];
  today: string;
  mov: Mov;
}) {
  const shownLifts: Lift[] = mov === 'ALL' ? LIFTS_ALL : [mov];
  const all = useMemo(() => weekStats(real, plan, today), [real, plan, today]);
  const sums = useMemo(
    () =>
      blocks
        .map((b) => ({ b, s: blockSummary(all.filter((w) => w.from >= monday(b.from) && w.from <= b.to)) }))
        .filter((x) => x.s.weeks > 0),
    [blocks, all],
  );
  const [metric, setMetric] = useState<'nlW' | 'setsW' | 'tonnageW' | 'siW' | 'e1p' | 'e1c' | 'adh'>('nlW');
  const [A, setA] = useState('');
  const [B, setB] = useState('');
  const ka = sums.find((x) => x.b.key === A)?.b.key ?? sums[Math.max(0, sums.length - 2)]?.b.key ?? '';
  const kb = sums.find((x) => x.b.key === B)?.b.key ?? sums[sums.length - 1]?.b.key ?? '';
  const sa = sums.find((x) => x.b.key === ka);
  const sb = sums.find((x) => x.b.key === kb);
  const cols: { k: keyof LiftSum; n: string; fmt: (v: number | null) => string; up: boolean }[] = [
    { k: 'setsW', n: 'Series/sem', fmt: (v) => fmt(v), up: true },
    { k: 'nlW', n: 'NL/sem', fmt: (v) => fmt(v), up: true },
    { k: 'tonnageW', n: 'Tonelaje/sem (kg)', fmt: (v) => fmt(v), up: true },
    { k: 'siW', n: 'SI/sem', fmt: (v) => fmt(v), up: true },
    { k: 'rpe', n: 'RPE real−obj', fmt: num1, up: false },
    { k: 'e1p', n: 'e1RM principal', fmt: num1, up: true },
    { k: 'e1c', n: 'e1RM comp.', fmt: num1, up: true },
    { k: 'adh', n: 'Cumpl. NL %', fmt: (v) => fmt(v), up: true },
  ];
  const METRIC_LABEL: Record<typeof metric, string> = {
    nlW: 'NL por semana',
    setsW: 'Series por semana',
    tonnageW: 'Tonelaje por semana (kg)',
    siW: 'SI por semana',
    e1p: 'e1RM principal máx. (kg)',
    e1c: 'e1RM competición máx. (kg)',
    adh: 'Cumplimiento del NL (%)',
  };
  const W = Math.max(640, sums.length * shownLifts.length * 26 + 120);
  const vals = sums.flatMap((x) => shownLifts.map((l) => x.s.lifts[l][metric] ?? 0));
  const max = Math.max(1, ...vals);
  const slot = (W - 70) / Math.max(1, sums.length);
  const bw = Math.min(34, (slot - 12) / shownLifts.length);
  if (!sums.length)
    return <p className="small">Todavía no hay bloques con semanas ejecutadas para comparar.</p>;
  return (
    <div className="bd-compare">
      <h4>Comparativa general de bloques · por movimiento</h4>
      <p className="small bd-note">
        Verde = mejor valor de la columna entre los bloques, rojo = el peor (promedios por semana, para que
        cuente igual un bloque corto que uno largo). Un bloque se ordena cronológicamente.
      </p>
      {shownLifts.map((l) => {
        const rows = sums.map((x) => ({ ...x, v: x.s.lifts[l] }));
        const cls = (k: keyof LiftSum, up: boolean) => {
          const xs = rows.map((r) => r.v[k] as number | null);
          const nn = xs.filter((v): v is number => v !== null);
          if (nn.length < 3) return xs.map(() => '');
          const hi = Math.max(...nn);
          const lo = Math.min(...nn);
          return xs.map((v) =>
            v === null || hi === lo
              ? ''
              : v === (up ? hi : lo)
                ? 'bd-best'
                : v === (up ? lo : hi)
                  ? 'bd-worst'
                  : '',
          );
        };
        const heat = cols.map((c) => cls(c.k, c.up));
        return (
          <div key={l} className="bd-table bd-weeks" style={{ marginBottom: 14 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ borderLeft: `5px solid ${LIFT_COLOR[l]}` }}>{LIFT_FULL[l]}</th>
                  <th>Fechas</th>
                  <th>Sem.</th>
                  {cols.map((c) => (
                    <th key={c.k}>{c.n}</th>
                  ))}
                  <th>Δ e1RM principal vs anterior</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const prev = i > 0 ? rows[i - 1]!.v.e1p : null;
                  const d = r.v.e1p !== null && prev !== null ? r.v.e1p - prev : null;
                  return (
                    <tr key={r.b.key}>
                      <td>
                        <i style={{ background: r.b.color }} /> {r.b.key}
                      </td>
                      <td>
                        {dateLabel(r.b.from)} – {dateLabel(r.b.to)}
                      </td>
                      <td>{r.v.weeks}</td>
                      {cols.map((c, j) => (
                        <td key={c.k} className={heat[j]![i]}>
                          {c.fmt(r.v[c.k] as number | null)}
                        </td>
                      ))}
                      <td className={diffTone(d, true)}>
                        {d === null ? '—' : `${d >= 0 ? '▲' : '▼'} ${number(Math.abs(d), 1)} kg`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      <figure className="bd-chart bd-big bd-wide">
        <figcaption>
          <strong>{METRIC_LABEL[metric]} · por bloque</strong>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as typeof metric)}
            aria-label="Medida"
          >
            {(Object.keys(METRIC_LABEL) as (typeof metric)[]).map((k) => (
              <option key={k} value={k}>
                {METRIC_LABEL[k]}
              </option>
            ))}
          </select>
          <span className="bd-key">
            {shownLifts.map((l) => (
              <span key={l}>
                <i style={{ background: LIFT_COLOR[l] }} /> {LIFT_FULL[l]}
              </span>
            ))}
          </span>
        </figcaption>
        <svg viewBox={`0 0 ${W} 300`} width="100%" role="img" aria-label="Comparativa por bloque">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1="56" x2={W - 4} y1={236 - f * 200} y2={236 - f * 200} className="bd-grid" />
              <text x="50" y={240 - f * 200} textAnchor="end">
                {number(max * f, 0)}
              </text>
            </g>
          ))}
          {sums.map((x, i) => (
            <g key={x.b.key}>
              {shownLifts.map((l, j) => {
                const v = x.s.lifts[l][metric];
                const h = ((v ?? 0) / max) * 200;
                const bx = 62 + i * slot + j * bw;
                return (
                  <rect key={l} x={bx} y={236 - h} width={bw - 2} height={h} fill={LIFT_COLOR[l]} rx="3">
                    <title>{`${x.b.key} · ${LIFT_FULL[l]}: ${v === null ? '—' : number(v, 1)}`}</title>
                  </rect>
                );
              })}
              <text
                x={62 + i * slot + (shownLifts.length * bw) / 2}
                y="258"
                textAnchor="middle"
                className="bd-axis"
                style={{ fill: x.b.color }}
              >
                {x.b.key.length > 12 ? x.b.key.slice(0, 11) + '…' : x.b.key}
              </text>
            </g>
          ))}
        </svg>
      </figure>

      <h4>Comparar dos bloques</h4>
      <div className="bd-controls">
        <label className="bd-variant">
          Bloque A
          <select value={ka} onChange={(e) => setA(e.target.value)}>
            {sums.map((x) => (
              <option key={x.b.key} value={x.b.key}>
                {x.b.key}
              </option>
            ))}
          </select>
        </label>
        <label className="bd-variant">
          Bloque B
          <select value={kb} onChange={(e) => setB(e.target.value)}>
            {sums.map((x) => (
              <option key={x.b.key} value={x.b.key}>
                {x.b.key}
              </option>
            ))}
          </select>
        </label>
      </div>
      {sa && sb && (
        <LiftCompareTable a={sa.s} b={sb.s} aName={sa.b.key} bName={sb.b.key} lifts={shownLifts} />
      )}
    </div>
  );
}

export function BlockDashboard({ id, classic }: { id: string; classic?: ReactNode }) {
  const [real, setReal] = useState<Core | null>(null);
  const [plan, setPlan] = useState<Core | null>(null);
  const [e1, setE1] = useState<Record<Lift, Week[]>>({ SQ: [], BP: [], DL: [] });
  const [e1p, setE1p] = useState<Record<Lift, Week[]>>({ SQ: [], BP: [], DL: [] });
  const [refs, setRefs] = useState<Ref[]>([]);
  const [instance, setInstance] = useState('');
  const [mov, setMov] = useMov();
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState('');
  const [selWeek, setSelWeek] = useState(() => readSearch().get('bdw') ?? '');
  const [tab, setTab] = useState<Tab>(() => {
    const v = readSearch().get('bd');
    return (
      [
        'semanas',
        'movimiento',
        'detalle',
        'comparativa',
        'sesiones',
        'distribucion',
        'fatiga',
        'graficos',
        'ejercicios',
      ] as string[]
    ).includes(v ?? '')
      ? (v as Tab)
      : 'semanas';
  });
  const [showPlan, setShowPlan] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let live = true;
    setReal(null);
    setPlan(null);
    setError(null);
    setSel(readSearch().get('bdb') ?? '');
    const q = (basis: string, extra: Record<string, string> = {}) =>
      'core' + query({ ...WIDE, view: 'all', basis, ...extra });
    Promise.all([
      get<Core>(id, q('realizado')),
      get<Core>(id, q('previsto')),
      get<Core>(id, q('realizado', { lift: 'SQ' })),
      get<Core>(id, q('realizado', { lift: 'BP' })),
      get<Core>(id, q('realizado', { lift: 'DL' })),
      get<Ref[]>(id, 'references').catch(() => [] as Ref[]),
      fetch('/api/instance')
        .then((r) => r.json() as Promise<{ label?: string }>)
        .catch(() => ({ label: '' })),
      get<Core>(id, q('previsto', { lift: 'SQ' })),
      get<Core>(id, q('previsto', { lift: 'BP' })),
      get<Core>(id, q('previsto', { lift: 'DL' })),
    ])
      .then((r) => {
        if (!live) return;
        setReal(r[0]);
        setPlan(r[1]);
        setE1({ SQ: r[2].weeks, BP: r[3].weeks, DL: r[4].weeks });
        setRefs(r[5]);
        setInstance(r[6].label ?? '');
        setE1p({ SQ: r[7].weeks, BP: r[8].weeks, DL: r[9].weeks });
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [id]);

  const blocks = useMemo<Block[]>(() => {
    if (!plan) return [];
    const m = new Map<string, { from: string; to: string }>();
    for (const s of plan.sessions) {
      const k = s.blockKey ?? blockOf(s.sessionKey);
      const cur = m.get(k);
      if (!cur) m.set(k, { from: s.date, to: s.date });
      else {
        if (s.date < cur.from) cur.from = s.date;
        if (s.date > cur.to) cur.to = s.date;
      }
    }
    return [...m.entries()]
      .sort((x, y) => x[1].from.localeCompare(y[1].from))
      .map(([key, r], i) => ({ key, ...r, color: PALETTE[i % PALETTE.length] as string }));
  }, [plan]);
  const scope = blocks.find((b) => b.key === sel);
  useEffect(() => {
    updateSearch({ bd: tab, bdb: sel || null, bdw: selWeek || null }, true);
  }, [tab, sel, selWeek]);

  if (error)
    return (
      <section className="bd">
        <p className="small">No se pudo cargar el resumen: {error}</p>
      </section>
    );
  if (!real || !plan)
    return (
      <section className="bd">
        <p className="small">Cargando resultados…</p>
      </section>
    );
  if (!plan.sessions.length)
    return (
      <section className="bd">
        <p className="small">Todavía no hay plan cargado para este atleta.</p>
      </section>
    );

  const inScope = (w: Week) => !scope || (w.week.to >= scope.from && w.week.from <= scope.to);
  const colorAt = (d: string) => blocks.find((b) => d >= b.from && d <= b.to)?.color ?? '#8d98a3';
  const nameAt = (d: string) => blocks.find((b) => d >= b.from && d <= b.to)?.key ?? '';
  const today = todayIso();
  const pick = (week: string) => {
    const wk = monday(week);
    const b = blocks.find((x) => wk >= monday(x.from) && wk <= x.to);
    if (!b) return;
    setSel(b.key);
    setSelWeek(wk);
    setTab('detalle');
  };
  const detailBlock =
    scope ??
    blocks.find((b) => today >= monday(b.from) && today <= b.to) ??
    [...blocks].reverse().find((b) => b.from <= today) ??
    blocks[0];
  const hasReal = real.sessions.length > 0;
  // El filtro de movimiento aplica a TODO: las semanas salen del core filtrado por ese movimiento.
  const lensPlan = mov === 'ALL' ? plan.weeks : e1p[mov];
  const lensReal = mov === 'ALL' ? real.weeks : e1[mov];
  const pWeeks = lensPlan.filter((w) => w.sessions > 0 && inScope(w));
  const rByFrom = new Map(lensReal.map((w) => [w.week.from, w]));
  const realIn = lensReal.filter((w) => inScope(w) && w.week.from <= today);
  const planToDate = pWeeks.filter((w) => w.week.from <= today);
  const sumP = (f: (x: Totals) => number | null) => planToDate.reduce((s, w) => s + (f(w.totals) ?? 0), 0);
  const sumOf = (ws: Week[], f: (x: Totals) => number | null) =>
    asVal(ws.reduce((s, w) => s + (f(w.totals) ?? 0), 0));
  const kpiWeeks = hasReal ? realIn : planToDate;
  const T = {
    nl: sumOf(kpiWeeks, (x) => x.nl.value),
    sets: sumOf(kpiWeeks, (x) => x.sets.value),
    tonnage: sumOf(kpiWeeks, (x) => x.tonnage.value),
    si: {
      rts: {
        total: sumOf(kpiWeeks, (x) => x.si.rts.total.value),
        central: sumOf(kpiWeeks, (x) => x.si.rts.central.value),
        peripheral: sumOf(kpiWeeks, (x) => x.si.rts.peripheral.value),
      },
    },
  };
  const rowsW = hasReal ? realIn : pWeeks;
  const muscAcc = new Map<
    string,
    { muscle: string; directSets: number; indirectSets: number; equivalentSets: number }
  >();
  const patAcc = new Map<string, { pattern: string; sets: number; nl: number }>();
  for (const w of rowsW) {
    for (const r of w.muscles?.rows ?? []) {
      const a = muscAcc.get(r.muscle) ?? {
        muscle: r.muscle,
        directSets: 0,
        indirectSets: 0,
        equivalentSets: 0,
      };
      a.directSets += r.directSets;
      a.indirectSets += r.indirectSets;
      a.equivalentSets += r.equivalentSets;
      muscAcc.set(r.muscle, a);
    }
    for (const r of w.patterns.rows) {
      const a = patAcc.get(r.pattern) ?? { pattern: r.pattern, sets: 0, nl: 0 };
      a.sets += r.sets;
      a.nl += r.nl;
      patAcc.set(r.pattern, a);
    }
  }
  const musc = [...muscAcc.values()].sort((a, b) => b.equivalentSets - a.equivalentSets).slice(0, 12);
  const pats = [...patAcc.values()].sort((a, b) => b.sets - a.sets);
  const sessions = sessionsFor(
    (hasReal ? real.sessions : plan.sessions).filter(
      (s) => !scope || (s.date >= scope.from && s.date <= scope.to),
    ),
    mov,
  )
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 150);
  const lifts: { l: Lift; name: string; color: string }[] = [
    { l: 'SQ', name: 'Sentadilla', color: PALETTE[0] as string },
    { l: 'BP', name: 'Banca', color: PALETTE[1] as string },
    { l: 'DL', name: 'Peso muerto', color: PALETTE[3] as string },
  ];
  const rm = (n: string) =>
    refs
      .filter((r) => r.exerciseName.toLowerCase() === `${n} comp`)
      .sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
  const simulated = /simulad/i.test(instance);
  const planOf = (n: number): Val | undefined => (hasReal ? asVal(n) : undefined);

  return (
    <section className="bd">
      <div className="bd-head">
        <div>
          <h3>Resultado de los bloques</h3>
          <p className="small bd-note">
            {hasReal
              ? 'Realizado frente a previsto, hasta hoy.'
              : 'Solo hay plan: se muestra la dosis PREVISTA.'}{' '}
            Las fechas del plan son aproximadas donde el Excel no las traía.
          </p>
        </div>
        <div className="bd-rms">
          {(['SQ', 'BP', 'DL'] as Lift[]).map((l) => {
            const r = rm({ SQ: 'squat', BP: 'bench', DL: 'deadlift' }[l]);
            return (
              <div
                key={l}
                title={
                  r ? `Fuente: ${r.source.replace(/_/g, ' ')} · desde ${dateLabel(r.asOf)}` : 'Sin referencia'
                }
              >
                <span>{l} 1RM</span>
                <strong>{r ? number(r.kg, 1) : '—'}</strong>
              </div>
            );
          })}
        </div>
        <button type="button" className="bd-fold" onClick={() => setOpen(!open)}>
          {open ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {simulated && (
        <p className="bd-sim">
          Ejecución SIMULADA: el plan sale del Excel del coach, pero lo «realizado» está generado por reglas a
          partir de los 1RM informados. No es lo que levantó cada atleta.
        </p>
      )}
      {open && (
        <>
          <Timeline blocks={blocks} sel={sel} onSel={setSel} />
          <div className="bd-selected-block">
            <span>Bloque</span>
            {scope ? (
              <>
                <b style={{ borderColor: scope.color }}>
                  <i style={{ background: scope.color }} /> {scope.key}
                </b>
                <button type="button" onClick={() => setSel('')}>
                  Ver todos los bloques
                </button>
              </>
            ) : (
              <em>Todos · tocá un bloque de la línea de tiempo para filtrar</em>
            )}
          </div>
          <MovementFilter value={mov} onChange={setMov} />
          <div className="bd-kpis">
            <Kpi
              name="NL"
              real={T?.nl}
              plan={planOf(sumP((x) => x.nl.value))}
              unit="rep."
              hint="Number of Lifts: suma de repeticiones"
            />
            <Kpi name="Series" real={T?.sets} plan={planOf(sumP((x) => x.sets.value))} unit="series" />
            <Kpi name="Tonelaje" real={T?.tonnage} plan={planOf(sumP((x) => x.tonnage.value))} unit="kg" />
            <Kpi
              name="SI total"
              real={T?.si.rts.total}
              plan={planOf(sumP((x) => x.si.rts.total.value))}
              unit="RTS aprox."
              hint="Stress Index RTS (aproximado)"
            />
            <Kpi name="SI central" real={T?.si.rts.central} unit="" />
            <Kpi name="SI periférico" real={T?.si.rts.peripheral} unit="" />
          </div>
          <div className="bd-tabs" role="tablist">
            {(
              [
                ['semanas', 'Semana a semana'],
                ['movimiento', 'Por movimiento'],
                ['detalle', 'Detalle del bloque'],
                ['comparativa', 'Comparativa'],
                ['sesiones', 'Sesiones'],
                ['distribucion', 'Músculos y patrones'],
                ['fatiga', 'Fatiga y 1RM'],
                ['graficos', 'Gráficos'],
                ...(classic ? ([['ejercicios', 'Por ejercicio y patrón']] as [Tab, string][]) : []),
              ] as [Tab, string][]
            ).map(([key, n]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
              >
                {n}
              </button>
            ))}
          </div>
          {tab === 'semanas' && (
            <>
              <label className="bd-check">
                <input type="checkbox" checked={showPlan} onChange={(e) => setShowPlan(e.target.checked)} />{' '}
                Mostrar también el NL previsto
              </label>
              <WeekTable
                weeks={pWeeks}
                real={rByFrom}
                blocks={blocks}
                today={today}
                showPlan={showPlan}
                onPick={pick}
                highlight={selWeek}
              />
            </>
          )}
          {tab === 'movimiento' && (
            <MovementView
              real={real}
              plan={plan}
              blocks={blocks}
              today={today}
              refs={refs}
              mov={mov}
              setMov={setMov}
              onPick={pick}
              highlight={selWeek}
            />
          )}
          {tab === 'detalle' && detailBlock && (
            <BlockDetail
              real={real}
              plan={plan}
              blocks={blocks}
              block={detailBlock}
              week={selWeek}
              today={today}
              mov={mov}
              colorAt={colorAt}
              onWeek={(w) => {
                setSelWeek(monday(w));
                setSel(detailBlock.key);
              }}
              onBlock={(k) => {
                setSel(k);
                setSelWeek('');
              }}
            />
          )}
          {tab === 'comparativa' && (
            <BlockCompare real={real} plan={plan} blocks={blocks} today={today} mov={mov} />
          )}
          {tab === 'graficos' && (
            <GraphsTab
              planWeeks={lensPlan.filter(inScope)}
              realWeeks={lensReal.filter(inScope)}
              lifts={lifts
                .filter((l) => mov === 'ALL' || l.l === mov)
                .map((l) => ({
                  l: l.l,
                  name: l.name,
                  plan: e1p[l.l].filter(inScope),
                  real: e1[l.l].filter(inScope),
                }))}
              today={today}
              colorAt={colorAt}
              nameAt={nameAt}
              onPick={pick}
              highlight={selWeek}
            />
          )}
          {tab === 'distribucion' && (
            <div className="bd-grid2">
              <HBars
                title="Volumen por grupo muscular"
                unit="series equivalentes"
                rows={musc.map((m) => ({
                  name: m.muscle.replace(/_/g, ' '),
                  value: m.equivalentSets,
                  sub: `${m.directSets} directas · ${m.indirectSets} indirectas`,
                }))}
              />
              <HBars
                title="Series por patrón de movimiento"
                unit="series"
                rows={pats.map((p) => ({ name: label(p.pattern), value: p.sets, sub: `NL ${p.nl}` }))}
              />
            </div>
          )}
          {tab === 'fatiga' && (
            <div className="bd-grid2">
              <Lines
                title="Fatiga al terminar la sesión (media semanal)"
                unit="1–10"
                series={[
                  {
                    name: 'fatiga',
                    color: PALETTE[3] as string,
                    pts: lensReal
                      .filter(inScope)
                      .map((w) => ({ x: w.week.from, v: w.fatigue?.endFatigue?.mean ?? null })),
                  },
                ]}
              />
              {lifts
                .filter((l) => mov === 'ALL' || l.l === mov)
                .map((l) => {
                  const agg = aggregate(real.sessions, l.l, '__all__');
                  const wk = lensReal.filter(inScope);
                  return (
                    <Lines
                      key={l.l}
                      title={`e1RM · ${l.name}`}
                      unit="kg"
                      zoom
                      series={[
                        {
                          name: 'Principal (prioridad 1)',
                          color: l.color,
                          pts: wk.map((w) => ({ x: w.week.from, v: agg.get(w.week.from)?.e1p ?? null })),
                        },
                        {
                          name: 'Competición',
                          color: '#8d98a3',
                          pts: wk.map((w) => ({ x: w.week.from, v: agg.get(w.week.from)?.e1 ?? null })),
                        },
                      ]}
                    />
                  );
                })}
            </div>
          )}
          {tab === 'ejercicios' && classic && <div className="bd-embed">{classic}</div>}
          {tab === 'sesiones' && (
            <>
              <p className="small">Tocá una sesión para ver sus series (kg, reps y RPE).</p>
              <SessionList sessions={sessions} colorAt={colorAt} />
            </>
          )}
        </>
      )}
    </section>
  );
}
