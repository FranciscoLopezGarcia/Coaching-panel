import { useMemo, useState } from 'react';
import { OverviewChart, type Annotation } from '../workspace/OverviewChart';
import { SERIES_COLORS, tracesFor } from './derive';
import { PeriodTable } from './FamilyCard';
import type { AnalysisState } from './state';
import type { AnalysisMetric, AnalysisResult, Linked, PeriodRow } from './types';

type CompareMode = 'paneles' | 'eje' | 'tabla';

/** Dos magnitudes comparten eje solo si tienen la misma unidad y la misma familia de escala. */
const sameAxis = (ms: AnalysisMetric[]) =>
  ms.length > 1 && ms.every((m) => m.unit === ms[0]?.unit && m.modelFamily === ms[0]?.modelFamily);

/**
 * Comparativa en conjunto de las magnitudes elegidas. Por defecto, un panel por magnitud con el mismo eje de tiempo y un cursor
 * compartido (cada una con su propia escala: no se inventan equivalencias entre unidades). Descriptivo: sin correlaciones ni causas.
 */
export function CompareView({
  data,
  periods,
  state,
  linked,
  bands,
  marks,
  onOpen,
  onClose,
}: {
  data: AnalysisResult;
  periods: PeriodRow[];
  state: AnalysisState;
  linked: Linked;
  bands: { from: string; to: string; color: string; label: string }[];
  marks: Annotation[];
  onOpen: (p: PeriodRow) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<CompareMode>('paneles');
  const metrics = useMemo(
    () => data.metrics.filter((m) => state.sel.includes(m.id)),
    [data.metrics, state.sel],
  );
  const axis = sameAxis(metrics);
  const needsLift = metrics.some((m) => m.id === 'e1rm') && data.lift === 'ALL';
  return (
    <div className="an-compare" role="dialog" aria-label="Comparativa en conjunto">
      <header>
        <h3>Comparativa en conjunto</h3>
        <div className="an-seg" role="group" aria-label="Modo">
          <button type="button" aria-pressed={mode === 'paneles'} onClick={() => setMode('paneles')}>
            Paneles sincronizados
          </button>
          <button
            type="button"
            aria-pressed={mode === 'eje'}
            disabled={!axis}
            title={axis ? '' : 'Solo magnitudes con la misma unidad y la misma familia de escala'}
            onClick={() => setMode('eje')}
          >
            Mismo eje
          </button>
          <button type="button" aria-pressed={mode === 'tabla'} onClick={() => setMode('tabla')}>
            Tabla conjunta
          </button>
        </div>
        <button type="button" className="an-close" onClick={onClose}>
          Cerrar
        </button>
      </header>
      {needsLift && (
        <p className="an-note">El e1RM necesita un solo movimiento: elegí SQ, BP o DL en los controles.</p>
      )}
      {metrics.length < 2 && (
        <p className="an-note">Elegí al menos dos magnitudes (con los casilleros) para compararlas.</p>
      )}
      {mode === 'paneles' && (
        <div className="an-panels">
          {metrics.map((m, i) => (
            <div key={m.id} className="an-panel">
              <h4>
                {m.label} <small>{m.unit}</small>
              </h4>
              <OverviewChart
                title={m.label}
                unit={m.unit}
                traces={tracesFor(
                  periods,
                  m,
                  state.source,
                  SERIES_COLORS[i % SERIES_COLORS.length] as string,
                )}
                bands={bands}
                annotations={marks}
                zoom
                height={190}
                width={560}
                linkedDate={linked.date}
                onHoverDate={linked.set}
              />
            </div>
          ))}
        </div>
      )}
      {mode === 'eje' && axis && (
        <OverviewChart
          title={metrics.map((m) => m.label).join(' · ')}
          unit={metrics[0]?.unit ?? ''}
          traces={metrics.flatMap((m, i) =>
            tracesFor(periods, m, state.source, SERIES_COLORS[i % SERIES_COLORS.length] as string),
          )}
          bands={bands}
          annotations={marks}
          zoom
          height={300}
          width={1040}
          linkedDate={linked.date}
          onHoverDate={linked.set}
        />
      )}
      {mode === 'tabla' && (
        <PeriodTable
          periods={periods}
          metrics={metrics}
          state={state}
          linked={linked}
          onOpen={onOpen}
          highlight={[]}
        />
      )}
    </div>
  );
}

export function CompareTray({
  data,
  state,
  open,
  onOpen,
}: {
  data: AnalysisResult;
  state: AnalysisState;
  open: boolean;
  onOpen: () => void;
}) {
  const chosen = data.metrics.filter((m) => state.sel.includes(m.id));
  if (!chosen.length) return null;
  return (
    <div className="an-tray" role="region" aria-label="Magnitudes elegidas para comparar">
      <b>{chosen.length} elegidas</b>
      <ul>
        {chosen.map((m) => (
          <li key={m.id}>
            {m.label}
            <button
              type="button"
              aria-label={`Quitar ${m.label}`}
              onClick={() => state.toggle([m.id], false)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={state.clear}>
        Limpiar
      </button>
      <button
        type="button"
        className="primary"
        disabled={chosen.length < 2}
        aria-pressed={open}
        onClick={onOpen}
      >
        {open ? 'Ocultar comparativa' : 'Comparar'}
      </button>
    </div>
  );
}
