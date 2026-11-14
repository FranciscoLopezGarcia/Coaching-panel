import { roleName } from './PriorityFilter';
import { useEffect, useMemo, useState } from 'react';
import { get, query } from './api';
import { dateLabel, number, today } from './ui';
import './blockanalysis.css';
import {
  ComplianceChart,
  DeltaTag,
  DIR_COLOR,
  E1rmChart,
  MetricChart,
  MetricGrid,
  ZonesChart,
  arrowOf,
  dirOf,
} from './BlockCharts';

/**
 * Analizador integral de bloques: ventana B0→B3 (B0 = referencia), deltas SOLO contra el bloque anterior, e1RM por variante y señal A/B.
 * Presenta lo que entrega GET /block-analysis; no recalcula ni emite recomendaciones. Las flechas son descriptivas (neutras).
 */
type Lift = 'SQ' | 'BP' | 'DL';
type Source = 'planned' | 'actual';
type View = 'movimiento' | 'prioridad' | 'variante';
interface Delta {
  abs: number | null;
  pct: number | null;
  unit: string;
  status: 'ok' | 'nuevo' | 'sin_denominador' | 'no_comparable' | 'incompatible_metric_family';
}
interface BlockCard {
  blockKey: string;
  index: number;
  start: string;
  end: string;
  weeks: number;
  closed: boolean;
}
interface Row {
  metricId: string;
  unit: string;
  values: (number | null)[];
  deltas: Delta[];
  modelFamily: string | null;
}
interface Change {
  variantKey: string;
  toBlock: string;
  event: string;
  detail: string | null;
}
interface Quality {
  blockKey: string;
  planned: number;
  done: number;
  skipped: number;
  unknown: number;
  coverage: number | null;
  adherence: number | null;
}
interface Card {
  blockKey: string;
  lift: Lift;
  variantKey: string;
  exerciseName: string;
  role: string | null;
  priority: number | null;
  protocol: string | null;
  setsPerWeek: number;
  nlPerWeek: number;
  intensityPct: number | null;
  sessionsPerWeek: number;
}
interface VariantPerf {
  lift: Lift;
  variantKey: string;
  exerciseName: string;
  blockKey: string;
  weekly: { week: number; e1rm: number; n: number; lastDate: string; rpeMin: number; rpeMax: number }[];
  bestKg: number | null;
  bestWeek: number | null;
  bestDate: string | null;
  tiedDates: string[];
  status: 'not_observed' | 'observed_but_sparse' | 'best_observed_open' | 'best_observed_delimited';
}
interface Side {
  state: string;
  nativeStatus: string;
  evidence: string[];
  missing: string[];
}
interface Signal {
  lift: Lift;
  a: Side;
  b: Side;
  agreement: 'coinciden' | 'difieren' | 'no_comparable';
}
interface ComplianceTotals {
  sessionsPlanned: number;
  sessionsWithWork: number;
  sessionsComplete: number;
  setsPlanned: number;
  setsDone: number;
  setsSkipped: number;
  setsUnknown: number;
  setsDoneShare: number | null;
  setsDoneOfRecorded: number | null;
}
interface Compliance {
  blockKey: string;
  weeks: (ComplianceTotals & { weekNo: number })[];
  total: ComplianceTotals;
  load: { pairs: number; meanPct: number | null };
  reps: { pairs: number; meanPct: number | null };
  rpe: { pairs: number; meanDiff: number | null };
}
interface Analysis {
  asOf: string;
  window: { blocks: BlockCard[]; partial: boolean; currentBlockKey: string };
  availableBlocks: { blockKey: string; start: string; end: string }[];
  rows: Row[];
  changes: Change[];
  quality: Quality[];
  zones?: {
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
        shareReps: number | null;
      }[];
    }[];
    note: string;
  };
  compliance?: Compliance[];
  cards: Card[];
  variants: VariantPerf[];
  expression: Signal[];
  source: Source;
}

const LABEL: Record<string, string> = {
  nl_per_week: 'NL (repeticiones)',
  sets_per_week: 'Series',
  tonnage_per_week: 'Tonelaje',
  frequency_per_week: 'Frecuencia',
  intensity_pct_sets: 'Intensidad (media por serie)',
  intensity_pct_reps: 'Intensidad (ponderada por reps)',
  rpe_mean: 'RPE medio',
  si_total_per_week: 'SI total',
  adherence_sets: 'Adherencia (series)',
};
const EVENT: Record<string, string> = {
  new_variant: 'Nueva',
  removed_variant: 'Retirada',
  resumed_variant: 'Reintroducida',
  role_change: 'Cambio de rol',
  priority_change: 'Cambio de prioridad',
  slot_change: 'Cambio de posición',
};
const BEST: Record<string, string> = {
  not_observed: 'No observada',
  observed_but_sparse: 'Pocos registros',
  best_observed_open: 'Mejor observado · en curso / no delimitado',
  best_observed_delimited: 'Mejor observado · delimitado',
};
const SIDE: Record<string, string> = {
  favorable: 'Favorable',
  no_favorable: 'No favorable',
  indeterminado_por_faltantes: 'Indeterminado (faltan datos)',
  sin_benchmarks: 'Sin benchmarks',
};
const AGREE = { coinciden: 'Coinciden', difieren: 'Difieren', no_comparable: 'No comparable' };

export function fmtDelta(d: Delta): string {
  if (d.status === 'no_comparable' || d.status === 'incompatible_metric_family') return 'No comparable';
  if (d.abs === null) return '—';
  const arrow = d.abs > 0 ? '↗' : d.abs < 0 ? '↘' : '→';
  const sign = d.abs > 0 ? '+' : '';
  const unit = d.unit === '%1RM' || d.unit === '%' ? ' pp' : '';
  const pct = d.pct === null ? '' : ` (${d.pct > 0 ? '+' : ''}${number(d.pct, 1)}%)`;
  return `${arrow} ${sign}${number(d.abs, 1)}${unit}${pct}${d.status === 'nuevo' ? ' · nuevo' : ''}`;
}

/** Mini-gráfico S1..Sn: semanas sin registro = hueco (no cero ni interpolación). Máximo en verde. */
export function Spark({ v, weeks }: { v: VariantPerf; weeks: number }) {
  const n = Math.max(weeks, ...v.weekly.map((p) => p.week), 1);
  const vals = v.weekly.map((p) => p.e1rm);
  if (!vals.length) return <div className="ba-spark-empty">No observada</div>;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (w: number) => 8 + ((w - 1) / Math.max(1, n - 1)) * 144;
  const y = (e: number) => (hi === lo ? 24 : 40 - ((e - lo) / (hi - lo)) * 32);
  const byWeek = new Map(v.weekly.map((p) => [p.week, p]));
  const segs: string[][] = [];
  let cur: string[] = [];
  for (let w = 1; w <= n; w++) {
    const p = byWeek.get(w);
    if (p) cur.push(`${x(w)},${y(p.e1rm)}`);
    else if (cur.length) {
      segs.push(cur);
      cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  return (
    <svg
      viewBox="0 0 160 52"
      className="ba-spark"
      role="img"
      aria-label={`e1RM semanal: ${v.weekly.map((p) => `S${p.week} ${number(p.e1rm, 1)} kg`).join(', ')}`}
    >
      {segs.map((s, i) =>
        s.length > 1 ? <polyline key={i} points={s.join(' ')} className="ba-line" /> : null,
      )}
      {v.weekly.map((p) => (
        <circle
          key={p.week}
          cx={x(p.week)}
          cy={y(p.e1rm)}
          r={p.week === v.bestWeek ? 4 : 2.5}
          className={p.week === v.bestWeek ? 'ba-dot best' : 'ba-dot'}
        >
          <title>{`S${p.week}: ${number(p.e1rm, 1)} kg · n=${p.n} · RPE ${p.rpeMin}–${p.rpeMax} · ${dateLabel(p.lastDate)}`}</title>
        </circle>
      ))}
      {Array.from({ length: n }, (_, i) => (
        <text key={i} x={x(i + 1)} y={50} className="ba-tick">
          {i + 1}
        </text>
      ))}
    </svg>
  );
}

function csv(a: Analysis): string {
  const head = [
    'metrica',
    'unidad',
    ...a.window.blocks.map((b) => b.blockKey),
    ...a.window.blocks.slice(1).map((b) => `delta→${b.blockKey}`),
  ];
  const lines = a.rows.map((r) =>
    [
      LABEL[r.metricId] ?? r.metricId,
      r.unit,
      ...r.values.map((v) => (v === null ? '' : String(v))),
      ...r.deltas.map((d) =>
        d.abs === null ? d.status : `${d.abs}${d.pct === null ? '' : ` (${d.pct.toFixed(2)}%)`}`,
      ),
    ]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const el = document.createElement('a');
  el.href = url;
  el.download = name;
  el.click();
  URL.revokeObjectURL(url);
}

export function BlockAnalysisPanel({ id, cutoff }: { id: string; cutoff?: string }) {
  const [source, setSource] = useState<Source>('actual');
  const [lift, setLift] = useState<Lift | 'ALL'>('ALL');
  const [view, setView] = useState<View>('movimiento');
  const [block, setBlock] = useState('');
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [metric, setMetric] = useState('nl_per_week');
  const asOf = cutoff ?? today();

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    get<Analysis>(id, 'block-analysis' + query({ asOf, source, lift, block: block || undefined }))
      .then((r) => live && setData(r))
      .catch((e: unknown) => {
        if (!live) return;
        setData(null);
        setError(e instanceof Error ? e.message : 'No se pudo cargar el análisis');
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [id, asOf, source, lift, block]);

  const blocks = data?.window.blocks ?? [];
  const lifts: Lift[] = lift === 'ALL' ? ['SQ', 'BP', 'DL'] : [lift];
  const changeOf = useMemo(() => {
    const m = new Map<string, Change[]>();
    for (const c of data?.changes ?? [])
      m.set(`${c.toBlock}|${c.variantKey}`, [...(m.get(`${c.toBlock}|${c.variantKey}`) ?? []), c]);
    return m;
  }, [data]);

  if (loading && !data)
    return (
      <section className="ba">
        <p className="muted">Cargando análisis de bloques…</p>
      </section>
    );
  if (error || !data)
    return (
      <section className="ba">
        <h3>Analizador de bloques</h3>
        <p className="muted">{error ?? 'Sin datos de bloques para analizar.'}</p>
      </section>
    );

  const groupKey = (c: Card): string =>
    view === 'movimiento'
      ? c.lift
      : view === 'prioridad'
        ? c.priority
          ? `Prioridad ${c.priority}`
          : 'Sin rol'
        : c.variantKey;
  const groups = [...new Set(data.cards.map(groupKey))].sort();
  const draft = (b: BlockCard) => source === 'actual' && !b.closed && b.start > data.asOf;

  return (
    <section className="ba" aria-busy={loading}>
      <header className="ba-head">
        <div>
          <h3>Analizador de bloques</h3>
          <p className="muted small">
            Corte {dateLabel(data.asOf)} · {source === 'actual' ? 'Real' : 'Plan'} · cada variación es contra
            el bloque anterior; B0 es solo referencia.
            {data.window.partial && ' Ventana parcial: hay menos de 4 bloques.'}
          </p>
        </div>
        <div className="ba-controls">
          <div className="ba-seg" role="group" aria-label="Fuente">
            {(['planned', 'actual'] as Source[]).map((s) => (
              <button key={s} aria-pressed={source === s} onClick={() => setSource(s)}>
                {s === 'planned' ? 'Plan' : 'Real'}
              </button>
            ))}
          </div>
          <div className="ba-seg" role="group" aria-label="Movimiento">
            {(['ALL', 'SQ', 'BP', 'DL'] as const).map((l) => (
              <button key={l} aria-pressed={lift === l} onClick={() => setLift(l)}>
                {l === 'ALL' ? 'Todas' : l}
              </button>
            ))}
          </div>
          <select
            aria-label="Bloque actual"
            value={data.window.currentBlockKey}
            onChange={(e) => setBlock(e.target.value)}
          >
            {data.availableBlocks.map((b) => (
              <option key={b.blockKey} value={b.blockKey}>
                {b.blockKey} · {dateLabel(b.start)}
              </option>
            ))}
          </select>
          <button
            className="ba-btn"
            onClick={() => download(`bloques-${data.asOf}.csv`, csv(data), 'text/csv')}
          >
            CSV
          </button>
          <button
            className="ba-btn"
            onClick={() =>
              download(`bloques-${data.asOf}.json`, JSON.stringify(data, null, 2), 'application/json')
            }
          >
            JSON
          </button>
        </div>
      </header>

      <section className="ba-visual" aria-label="Vista gráfica">
        <div className="dir-legend">
          <span>Color = dirección del cambio contra el bloque anterior, no un juicio:</span>
          <span style={{ color: DIR_COLOR.up }}>{arrowOf('up')} subió</span>
          <span style={{ color: DIR_COLOR.down }}>{arrowOf('down')} bajó</span>
          <span style={{ color: DIR_COLOR.flat }}>{arrowOf('flat')} sin cambio / no comparable</span>
          <span style={{ color: '#4fb985' }}>● máximo e1RM observado</span>
          <span className="muted">Pasá el mouse por cualquier gráfico para ver el detalle.</span>
        </div>
        <MetricGrid rows={data.rows} labels={LABEL} blocks={blocks} selected={metric} onSelect={setMetric} />
        {data.rows.find((r) => r.metricId === metric) && (
          <MetricChart
            row={data.rows.find((r) => r.metricId === metric)!}
            label={LABEL[metric] ?? metric}
            blocks={blocks}
          />
        )}
        {data.zones && <ZonesChart zones={data.zones} blocks={blocks} />}
        {data.compliance && data.compliance.length > 0 && (
          <ComplianceChart data={data.compliance} blocks={blocks} />
        )}
        {lifts.map((l) => (
          <E1rmChart key={l} lift={l} variants={data.variants} blocks={blocks} />
        ))}
      </section>

      <h4 className="ba-tabletitle">Tabla de bloques</h4>
      <div className="ba-grid ba-chain" style={{ ['--cols' as string]: blocks.length }}>
        <div />
        {blocks.map((b, i) => {
          const q = data.quality[i];
          return (
            <div key={b.blockKey} className="ba-colhead">
              <strong>
                B{i} · {b.blockKey}
              </strong>
              <span className="muted small">
                {dateLabel(b.start)}–{dateLabel(b.end)} · {b.weeks} sem ·{' '}
                {b.closed ? 'cerrado' : 'en curso / futuro'}
              </span>
              {source === 'actual' && q && (
                <span
                  className={`ba-chip ${q.coverage !== null && q.coverage < 1 ? 'warn' : ''}`}
                  title="Series con resultado conocido / previstas hasta el corte"
                >
                  Cobertura {q.coverage === null ? '—' : `${number(100 * q.coverage, 0)}%`} · {q.unknown} sin
                  registro
                </span>
              )}
              {draft(b) && <span className="ba-chip">Pendiente de ejecución</span>}
            </div>
          );
        })}
        {data.rows.map((r) => (
          <div key={r.metricId} className="ba-rowwrap">
            <div
              className="ba-metric"
              title={r.modelFamily ? `Familia de modelo: ${r.modelFamily}` : undefined}
            >
              {LABEL[r.metricId] ?? r.metricId}
              <span className="muted small"> {r.unit}</span>
            </div>
            {r.values.map((v, i) => {
              const dl = i > 0 ? (r.deltas[i - 1] as Delta | undefined) : undefined;
              const dd = dl && (dl.status === 'ok' || dl.status === 'nuevo') ? dirOf(dl.abs) : 'flat';
              const tint = dl?.pct == null ? 0.25 : Math.min(1, Math.abs(dl.pct) / 20);
              return (
                <div key={i} className={`ba-cell d-${dd}`} style={{ ['--tint' as string]: tint }}>
                  <span className="ba-val">
                    {v === null ? 'No observada' : number(v, r.metricId === 'tonnage_per_week' ? 0 : 1)}
                  </span>
                  {i > 0 && r.deltas[i - 1] && <DeltaTag d={r.deltas[i - 1]} />}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {blocks.some((b) => !b.closed) && (
        <p className="muted small">
          La última columna está en curso: sus promedios por semana usan solo lo transcurrido y puede tener
          semanas incompletas. Comparala con cautela frente a los bloques cerrados.
        </p>
      )}
      {data.zones && (
        <div className="ba-zones">
          <h4>Distribución por zonas de intensidad (%1RM)</h4>
          <p className="muted small">
            Cortes del coach: {data.zones.cuts.join(' · ')} %1RM (se cambian en Configuración → Parámetros).{' '}
            {data.zones.note}
          </p>
          <div className="ba-grid ba-chain" style={{ ['--cols' as string]: blocks.length }}>
            <div />
            {blocks.map((b, i) => (
              <div key={b.blockKey} className="ba-colhead">
                <strong>
                  B{i} · {b.blockKey}
                </strong>
              </div>
            ))}
            {data.zones.byBlock[0]?.zones.map((z, zi) => (
              <div key={z.zone} className="ba-rowwrap">
                <div className="ba-metric">
                  {z.label}
                  <span className="muted small"> {z.range} %1RM · % de series</span>
                </div>
                {data.zones!.byBlock.map((bz) => {
                  const zz = bz.zones[zi]!;
                  return (
                    <div key={bz.blockKey} className="ba-cell">
                      <span className="ba-val">
                        {zz.shareSets === null ? 'Sin referencia' : `${number(100 * zz.shareSets, 0)}%`}
                      </span>
                      <span className="muted small">
                        {zz.sets} series · {zz.reps} reps
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="ba-rowwrap">
              <div className="ba-metric">
                Series sin referencia <span className="muted small">no entran a ninguna zona</span>
              </div>
              {data.zones.byBlock.map((bz) => (
                <div key={bz.blockKey} className="ba-cell">
                  <span className="ba-val">{bz.withoutRef}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {data.compliance && data.compliance.length > 0 && (
        <div className="ba-compliance">
          <h4>Cumplimiento: lo previsto contra lo hecho</h4>
          <p className="muted small">
            Plan y ejecución lado a lado, solo hasta el corte y sin calentamientos. «Sin registro» (previstas
            sin dato) no es lo mismo que «omitidas». Carga, reps y RPE comparan solo las series que tienen
            previsto y real. Es descriptivo: no dice si cumplir más o menos es mejor.
          </p>
          <div className="ba-grid ba-chain" style={{ ['--cols' as string]: blocks.length }}>
            <div />
            {blocks.map((b, i) => (
              <div key={b.blockKey} className="ba-colhead">
                <strong>
                  B{i} · {b.blockKey}
                </strong>
              </div>
            ))}
            {(
              [
                [
                  'Sesiones con trabajo',
                  (c: Compliance) => `${c.total.sessionsWithWork}/${c.total.sessionsPlanned}`,
                  (c: Compliance) => `${c.total.sessionsComplete} completas`,
                ],
                [
                  'Series hechas',
                  (c: Compliance) => `${c.total.setsDone}/${c.total.setsPlanned}`,
                  (c: Compliance) =>
                    c.total.setsDoneShare === null
                      ? 'sin series previstas'
                      : `${number(100 * c.total.setsDoneShare, 0)}% de lo previsto`,
                ],
                [
                  'Omitidas · sin registro',
                  (c: Compliance) => `${c.total.setsSkipped} · ${c.total.setsUnknown}`,
                  (c: Compliance) =>
                    c.total.setsDoneOfRecorded === null
                      ? 'sin registros'
                      : `${number(100 * c.total.setsDoneOfRecorded, 0)}% de las registradas se hicieron`,
                ],
                [
                  'Carga real / prevista',
                  (c: Compliance) => (c.load.meanPct === null ? '—' : `${number(c.load.meanPct, 0)}%`),
                  (c: Compliance) => `${c.load.pairs} series con ambos datos`,
                ],
                [
                  'Reps reales / previstas',
                  (c: Compliance) => (c.reps.meanPct === null ? '—' : `${number(c.reps.meanPct, 0)}%`),
                  (c: Compliance) => `${c.reps.pairs} series`,
                ],
                [
                  'RPE real − objetivo',
                  (c: Compliance) =>
                    c.rpe.meanDiff === null
                      ? '—'
                      : `${c.rpe.meanDiff > 0 ? '+' : ''}${number(c.rpe.meanDiff, 1)}`,
                  (c: Compliance) => `${c.rpe.pairs} series con ambos RPE`,
                ],
              ] as [string, (c: Compliance) => string, (c: Compliance) => string][]
            ).map(([label, main, sub]) => (
              <div key={label} className="ba-rowwrap">
                <div className="ba-metric">{label}</div>
                {data.compliance!.map((c) => (
                  <div key={c.blockKey} className="ba-cell">
                    <span className="ba-val">{main(c)}</span>
                    <span className="muted small">{sub(c)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <details>
            <summary>Cumplimiento por semana</summary>
            {data.compliance.map((c) => (
              <div key={c.blockKey} className="table-wrap">
                <table>
                  <caption>{c.blockKey}</caption>
                  <thead>
                    <tr>
                      <th>Semana</th>
                      <th>Sesiones con trabajo</th>
                      <th>Series hechas / previstas</th>
                      <th>Omitidas</th>
                      <th>Sin registro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.weeks.map((w) => (
                      <tr key={w.weekNo}>
                        <td>S{w.weekNo}</td>
                        <td>
                          {w.sessionsWithWork}/{w.sessionsPlanned}
                        </td>
                        <td>
                          {w.setsDone}/{w.setsPlanned}
                          {w.setsDoneShare === null ? '' : ` (${number(100 * w.setsDoneShare, 0)}%)`}
                        </td>
                        <td>{w.setsSkipped}</td>
                        <td>{w.setsUnknown}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </details>
        </div>
      )}

      <h4>Estructura por bloque</h4>
      <div className="ba-seg" role="group" aria-label="Vista">
        {(['movimiento', 'prioridad', 'variante'] as View[]).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
            {v[0]?.toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
      {groups.length === 0 && <p className="muted">No hay ejercicios programados en esta ventana.</p>}
      {groups.map((g) => (
        <div key={g} className="ba-group">
          <div className="ba-grouptitle">{g}</div>
          <div
            className="ba-grid"
            style={{
              ['--cols' as string]: blocks.length,
              gridTemplateColumns: `repeat(${blocks.length}, minmax(0,1fr))`,
            }}
          >
            {blocks.map((b) => {
              const cs = data.cards.filter((c) => c.blockKey === b.blockKey && groupKey(c) === g);
              return (
                <div key={b.blockKey} className="ba-col">
                  {cs.length === 0 && <div className="ba-card ghost">No programada</div>}
                  {cs.map((c) => (
                    <div key={c.variantKey} className="ba-card">
                      <div className="ba-cardtop">
                        <strong>{c.exerciseName}</strong>
                        {(changeOf.get(`${b.blockKey}|${c.variantKey}`) ?? []).map((ch) => (
                          <span key={ch.event} className="ba-chip" title={ch.detail ?? undefined}>
                            {EVENT[ch.event] ?? ch.event}
                          </span>
                        ))}
                      </div>
                      <div className="muted small">
                        {c.lift} · {roleName(c.role)} · prioridad {c.priority ?? '—'}
                        {c.protocol ? ` · ${c.protocol}` : ''}
                      </div>
                      <div className="ba-nums small">
                        {number(c.setsPerWeek, 1)} series/sem · NL {number(c.nlPerWeek, 1)}/sem ·{' '}
                        {number(c.sessionsPerWeek, 1)} ses/sem
                        {c.intensityPct !== null && ` · ${number(c.intensityPct, 1)}%`}
                      </div>
                    </div>
                  ))}
                  {/* Retiradas en este bloque (estaban en el anterior y ya no) */}
                  {(data.changes ?? [])
                    .filter(
                      (ch) =>
                        ch.toBlock === b.blockKey &&
                        ch.event === 'removed_variant' &&
                        (view !== 'variante' || ch.variantKey === g),
                    )
                    .map((ch) => (
                      <div key={ch.variantKey} className="ba-card ghost">
                        {ch.variantKey} <span className="ba-chip">Retirada</span>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <h4>e1RM por variante (máximo semanal observado)</h4>
      <p className="muted small">
        Método e1RM · tabla RPE con RPE real. Semana sin registro = hueco. El verde marca el mayor e1RM
        observado de la curva, no un PR ni un pico fisiológico.
        {blocks.some(draft) && ' El bloque futuro no tiene curva realizada.'}
      </p>
      {lifts.map((l) => {
        const names = [...new Set(data.variants.filter((v) => v.lift === l).map((v) => v.variantKey))];
        if (!names.length) return null;
        const shown = more ? names : names.slice(0, 3);
        return (
          <div key={l} className="ba-group">
            <div className="ba-grouptitle">{l}</div>
            {shown.map((vk) => (
              <div key={vk} className="ba-variant">
                <div className="ba-vname">
                  {data.variants.find((v) => v.variantKey === vk)?.exerciseName ?? vk}
                </div>
                <div
                  className="ba-grid"
                  style={{ gridTemplateColumns: `repeat(${blocks.length}, minmax(0,1fr))` }}
                >
                  {blocks.map((b) => {
                    const v = data.variants.find((x) => x.variantKey === vk && x.blockKey === b.blockKey);
                    return (
                      <div key={b.blockKey} className="ba-card">
                        {!v || v.bestKg === null ? (
                          <span className="muted">
                            {draft(b) ? 'Pendiente de ejecución' : 'No observada'}
                          </span>
                        ) : (
                          <>
                            <div className="ba-best" title="Mayor e1RM observado">
                              {number(v.bestKg, 1)} <small>kg</small>
                            </div>
                            <div className="small">
                              Mayor e1RM observado · S{v.bestWeek} · {dateLabel(v.bestDate)}
                              {v.tiedDates.length > 1 && ` (empate ${v.tiedDates.length}×)`}
                            </div>
                            <Spark v={v} weeks={b.weeks} />
                            <div className="muted small">{BEST[v.status]}</div>
                            <details>
                              <summary className="small">Valores</summary>
                              <table className="ba-mini">
                                <tbody>
                                  {v.weekly.map((p) => (
                                    <tr key={p.week}>
                                      <td>S{p.week}</td>
                                      <td>{number(p.e1rm, 1)} kg</td>
                                      <td>n={p.n}</td>
                                      <td>
                                        RPE {p.rpeMin}–{p.rpeMax}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </details>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {names.length > 3 && (
              <button className="ba-btn" onClick={() => setMore(!more)}>
                {more ? 'Ver menos' : `Ver ${names.length - 3} variantes más`}
              </button>
            )}
          </div>
        );
      })}

      {data.expression.length > 0 && (
        <>
          <h4>Señal de expresión · B principal, A contraste</h4>
          <div className="ba-ab">
            {data.expression.map((s) => (
              <div key={s.lift} className="ba-card">
                <strong>{s.lift}</strong>
                <div>
                  B:{' '}
                  <span
                    className={`ba-chip ${s.b.state === 'favorable' ? 'ok' : s.b.state === 'no_favorable' ? '' : 'warn'}`}
                  >
                    {SIDE[s.b.state] ?? s.b.state}
                  </span>
                </div>
                <div>
                  A: <span className="ba-chip">{SIDE[s.a.state] ?? s.a.state}</span>
                </div>
                <div>
                  <span className={`ba-chip ${s.agreement === 'coinciden' ? '' : 'warn'}`}>
                    {AGREE[s.agreement]}
                  </span>
                </div>
                <details>
                  <summary className="small">Criterios</summary>
                  <p className="small muted">B ({s.b.nativeStatus})</p>
                  <ul className="small">
                    {s.b.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                  <p className="small muted">A ({s.a.nativeStatus})</p>
                  <ul className="small">
                    {s.a.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </details>
              </div>
            ))}
          </div>
          <p className="muted small">
            La señal B es operativa, no una validación de superioridad sobre A. Ninguna equivale a «preparado
            para un máximo».
          </p>
        </>
      )}
    </section>
  );
}
