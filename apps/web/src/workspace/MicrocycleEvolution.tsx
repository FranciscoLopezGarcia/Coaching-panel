import type { Weekly } from './api';
import { OverviewChart, type Trace } from './OverviewChart';

/**
 * Evolución microciclo a microciclo de UN movimiento (ejercicio + variante) dentro del período elegido:
 * e1RM, SI (total / central / periférico), tonelaje, NL, series e intensidad media relativa.
 * Solo presenta lo que entrega GET /weekly; no recalcula. Línea punteada = lo previsto en el plan.
 */
const C = { main: '#3d74e0', alt: '#e0873d', third: '#4aa56b' };

type Pick = (r: Weekly) => number | null;
const actual =
  (id: string): Pick =>
  (r) =>
    r.actual[id]?.value ?? null;

const line = (
  rows: Weekly[],
  label: string,
  color: string,
  pick: Pick,
  extra: Partial<Trace> = {},
): Trace => ({
  label,
  color,
  points: rows.filter((r) => !r.week.future).map((r) => ({ date: r.week.from, value: pick(r) })),
  ...extra,
});

export function MicrocycleEvolution({
  rows,
  period,
  movement,
}: {
  rows: Weekly[];
  period: { from: string; to: string };
  movement: string;
}) {
  const hasPlan = rows.some((r) => r.planned);
  const planned = (label: string, pick: Pick): Trace[] =>
    hasPlan ? [line(rows, label, C.main, pick, { dashed: true })] : [];
  const panels: { title: string; unit: string; traces: Trace[]; zoom?: boolean }[] = [
    {
      title: 'e1RM',
      unit: 'kg',
      zoom: true,
      traces: [
        line(rows, 'Curva RPE', C.main, actual('e1rm_table_rpe')),
        line(rows, '6 fórmulas PRG', C.alt, actual('e1rm_prg_formulas')),
      ],
    },
    {
      title: 'SI · RTS aprox.',
      unit: 'SI',
      traces: [
        line(rows, 'Total', C.main, actual('si_rts_total')),
        line(rows, 'Central', C.alt, actual('si_rts_central')),
        line(rows, 'Periférico', C.third, actual('si_rts_peripheral')),
        ...planned('Total previsto', (r) => r.planned?.siTotal ?? null),
      ],
    },
    {
      title: 'Tonelaje',
      unit: 'kg',
      traces: [
        line(rows, 'Realizado', C.main, actual('tonnage')),
        ...planned('Previsto', (r) => r.planned?.tonnage ?? null),
      ],
    },
    {
      title: 'NL · repeticiones',
      unit: 'rep.',
      traces: [
        line(rows, 'Realizado', C.main, actual('nl')),
        ...planned('Previsto', (r) => r.planned?.nl ?? null),
      ],
    },
    {
      title: 'Intensidad media relativa',
      unit: '% de la referencia',
      zoom: true,
      traces: [
        line(rows, 'Promedio simple', C.main, actual('intensity_rel')),
        line(rows, 'Ponderada por reps', C.alt, actual('intensity_rel_reps')),
        ...planned('Previsto', (r) => r.planned?.intensity ?? null),
      ],
    },
    {
      title: 'Series',
      unit: 'series',
      traces: [
        line(rows, 'Realizado', C.main, actual('sets')),
        ...planned('Previsto', (r) => r.planned?.sets ?? null),
      ],
    },
  ];
  return (
    <article className="chart-panel microcycle-evolution">
      <div className="row between">
        <h3>Evolución microciclo a microciclo</h3>
        <span className="small muted">{movement}</span>
      </div>
      <p className="small muted">
        Una marca por semana del período. Cada gráfico es de este movimiento; la línea punteada es lo
        previsto.
      </p>
      <div className="micro-grid">
        {panels.map((p) => (
          <OverviewChart
            key={p.title}
            title={p.title}
            unit={p.unit}
            traces={p.traces}
            period={period}
            zoom={p.zoom}
          />
        ))}
      </div>
    </article>
  );
}
