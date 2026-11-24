import { useEffect } from 'react';
import { dateLabel, number } from '../workspace/ui';
import { periodLabel } from './derive';
import type { AnalysisMetric, PeriodRow, Scale } from './types';

/** Detalle de un período (semana o sesión): todas las magnitudes, previsto y real lado a lado, y el estado de los datos. */
export function PeriodDrawer({
  period,
  metrics,
  scale,
  onClose,
}: {
  period: PeriodRow;
  metrics: AnalysisMetric[];
  scale: Scale;
  onClose: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const c = period.compliance;
  return (
    <aside className="an-drawer" role="dialog" aria-label="Detalle del período">
      <header>
        <div>
          <h3>{periodLabel(period, scale)}</h3>
          <p>
            Bloque {period.blockKey} · {dateLabel(period.from)}
            {period.to !== period.from ? ` a ${dateLabel(period.to)}` : ''}
            {period.future ? ' · todavía no empezó' : ''}
          </p>
        </div>
        <button type="button" onClick={onClose}>
          Cerrar
        </button>
      </header>
      <table className="an-table">
        <thead>
          <tr>
            <th>Magnitud</th>
            <th>Real</th>
            <th>Previsto</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.id}>
              <th scope="row">
                {m.label}
                <small>{m.unit}</small>
              </th>
              <td className="num">
                {period.actual?.[m.id] == null ? '—' : number(period.actual[m.id], m.decimals)}
              </td>
              <td className="num">
                {!m.hasPlan || period.planned?.[m.id] == null
                  ? '—'
                  : number(period.planned[m.id], m.decimals)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="an-facts">
        <div>
          <dt>Series previstas al corte</dt>
          <dd className="num">{c.planned}</dd>
        </div>
        <div>
          <dt>Hechas</dt>
          <dd className="num">{c.done}</dd>
        </div>
        <div>
          <dt>Omitidas</dt>
          <dd className="num">{c.skipped}</dd>
        </div>
        <div>
          <dt>Sin registro</dt>
          <dd className="num">{c.unknown}</dd>
        </div>
        <div>
          <dt>Pares RPE real / objetivo</dt>
          <dd className="num">{period.rpeDev.pairs}</dd>
        </div>
      </dl>
      {(period.quality.siMissing > 0 || period.quality.pctMissing > 0) && (
        <p className="an-note">
          {period.quality.siMissing > 0 &&
            `${period.quality.siMissing} series sin RPE real: el SI de este período queda sin dato. `}
          {period.quality.pctMissing > 0 &&
            `${period.quality.pctMissing} series sin referencia fechada: no entran en la intensidad.`}
        </p>
      )}
    </aside>
  );
}
