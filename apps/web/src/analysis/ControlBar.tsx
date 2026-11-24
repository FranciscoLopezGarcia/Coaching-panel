import { MovementFilter, type Mov } from '../workspace/MovementFilter';
import type { AnalysisResult, Scale, Source } from './types';
import type { AnalysisState } from './state';

const SOURCE_LABEL: Record<Source, string> = { real: 'Real', plan: 'Previsto', ambos: 'Ambos' };
const SCALE_LABEL: Record<Scale, string> = { week: 'Semana', session: 'Sesión' };

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="an-ctl" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="an-seg">
        {(Object.keys(options) as T[]).map((k) => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>
            {options[k]}
          </button>
        ))}
      </div>
    </div>
  );
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** CSV de los períodos tal como los entrega el servidor (plan y real en columnas separadas). */
function periodsCsv(d: AnalysisResult): string {
  const ids = d.metrics.map((m) => m.id);
  const head = [
    'periodo',
    'bloque',
    'semana',
    'desde',
    'hasta',
    ...ids.map((i) => `real_${i}`),
    ...ids.map((i) => `previsto_${i}`),
  ];
  const cell = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  const lines = d.periods.map((p) =>
    [
      p.key,
      p.blockKey,
      p.weekNo,
      p.from,
      p.to,
      ...ids.map((i) => cell(p.actual?.[i])),
      ...ids.map((i) => cell(p.planned?.[i])),
    ].join(','),
  );
  return [head.join(','), ...lines].join('\n');
}

export function ControlBar({
  data,
  asOf,
  mov,
  onMov,
  state,
}: {
  data: AnalysisResult | null;
  asOf: string;
  mov: Mov;
  onMov: (m: Mov) => void;
  state: AnalysisState;
}) {
  return (
    <div className="an-bar" role="region" aria-label="Controles de análisis">
      <MovementFilter value={mov} onChange={onMov} />
      <Seg label="Fuente" value={state.source} options={SOURCE_LABEL} onChange={state.setSource} />
      <Seg label="Escala" value={state.scale} options={SCALE_LABEL} onChange={state.setScale} />
      {data?.blocks && (
        <label className="an-ctl">
          <span>Bloque actual</span>
          <select value={state.block} onChange={(e) => state.setBlock(e.target.value)}>
            <option value="">Automático</option>
            {data.blocks.availableBlocks.map((b) => (
              <option key={b.blockKey} value={b.blockKey}>
                {b.blockKey}
              </option>
            ))}
          </select>
        </label>
      )}
      {data && (
        <div className="an-ctl an-export">
          <span>Exportar</span>
          <div className="an-seg">
            <button
              type="button"
              onClick={() => download(`analisis-${asOf}.csv`, periodsCsv(data), 'text/csv')}
            >
              CSV
            </button>
            <button
              type="button"
              onClick={() =>
                download(`analisis-${asOf}.json`, JSON.stringify(data, null, 2), 'application/json')
              }
            >
              JSON
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
