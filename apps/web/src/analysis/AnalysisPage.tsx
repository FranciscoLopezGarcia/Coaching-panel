import { useMemo, useState } from 'react';
import { useLoad } from '../hooks';
import { get, query } from '../workspace/api';
import { type Mov, useMov } from '../workspace/MovementFilter';
import { usePlanMarks } from '../workspace/planMarks';
import { BlocksCard } from './BlocksCard';
import { ComplianceBlock, ZonesBlock } from './BlockExtras';
import { CompareTray, CompareView } from './CompareView';
import { ControlBar } from './ControlBar';
import { DistributionCard } from './DistributionCard';
import { FamilyCard } from './FamilyCard';
import { FAMILIES } from './families';
import { PeriodDrawer } from './PeriodDrawer';
import { StrengthCard } from './StrengthCard';
import { useAnalysisState } from './state';
import type { AnalysisResult, Lift, Linked, PeriodRow } from './types';
import './analysis.css';
import './charts.css';

const BLOCK_COLORS = ['var(--c-gray)', 'var(--c-steel)', 'var(--c-bone)', 'var(--c-steel-dk)'];

/**
 * Analizar: una sola pantalla, una sola llamada. Cada magnitud vive en UNA tarjeta con su gráfico y su tabla vinculados; las
 * magnitudes se eligen con casilleros y se comparan en conjunto. El navegador solo presenta lo que entrega el servidor.
 */
export function AnalysisPage({
  id,
  cutoff,
  from,
  to,
}: {
  id: string;
  cutoff: string;
  from: string;
  to: string;
}) {
  const [mov, setMov] = useMov();
  const state = useAnalysisState();
  const marks = usePlanMarks();
  const [date, setDate] = useState<string | null>(null);
  const [open, setOpen] = useState<PeriodRow | null>(null);
  const linked: Linked = { date, set: setDate };

  const data = useLoad(
    () =>
      get<AnalysisResult>(
        id,
        'analysis' +
          query({
            asOf: cutoff,
            from,
            to,
            lift: mov,
            granularity: state.scale,
            block: state.block || undefined,
            source: state.source === 'plan' ? 'planned' : 'actual',
          }),
      ),
    [id, cutoff, from, to, mov, state.scale, state.block, state.source],
  );
  const d = data.data;
  const bands = useMemo(
    () =>
      (d?.blocks?.window.blocks ?? []).map((b, i) => ({
        from: b.start,
        to: b.end,
        color: BLOCK_COLORS[i % 4] as string,
        label: `B${i} · ${b.blockKey}`,
      })),
    [d],
  );
  const lift: 'ALL' | Lift = mov as Mov;

  return (
    <section className="an-page" aria-label="Análisis">
      <ControlBar data={d} asOf={cutoff} mov={mov} onMov={setMov} state={state} />
      {data.error && <p className="an-empty">No se pudo cargar el análisis: {data.error}</p>}
      {!d && !data.error && <p className="an-empty">Cargando análisis…</p>}
      {d && (
        <div className="an-layout">
          <nav className="an-rail" aria-label="Índice">
            <ol>
              {FAMILIES.map((f) => (
                <li key={f.id}>
                  <input
                    type="checkbox"
                    checked={f.metrics.every((m) => state.sel.includes(m))}
                    onChange={() => state.toggle(f.metrics)}
                    aria-label={`Elegir toda la familia ${f.title}`}
                  />
                  <a href={`#${f.id}`} onClick={(e) => scrollTo(e, f.id)}>
                    {f.title}
                  </a>
                </li>
              ))}
              <li>
                <input
                  type="checkbox"
                  checked={state.sel.includes('e1rm')}
                  onChange={() => state.toggle(['e1rm'])}
                  aria-label="Elegir e1RM"
                />
                <a href="#fuerza" onClick={(e) => scrollTo(e, 'fuerza')}>
                  Fuerza
                </a>
              </li>
              <li>
                <span />
                <a href="#distribucion" onClick={(e) => scrollTo(e, 'distribucion')}>
                  Distribución
                </a>
              </li>
              <li>
                <span />
                <a href="#bloques" onClick={(e) => scrollTo(e, 'bloques')}>
                  Bloques y respuesta
                </a>
              </li>
            </ol>
            <button
              type="button"
              className="an-rail-all"
              onClick={() => state.toggle([...FAMILIES.flatMap((f) => f.metrics), 'e1rm'])}
            >
              Elegir todo
            </button>
          </nav>
          <div className="an-main">
            {FAMILIES.map((f) => (
              <FamilyCard
                key={f.id}
                family={f}
                data={d}
                periods={d.periods}
                state={state}
                linked={linked}
                onOpen={setOpen}
                bands={bands}
                blockExtra={
                  f.id === 'carga' ? (
                    <ZonesBlock data={d} />
                  ) : f.id === 'cumplimiento' ? (
                    <ComplianceBlock data={d} />
                  ) : null
                }
              />
            ))}
            <StrengthCard
              data={d}
              mov={lift}
              state={state}
              marks={marks}
              metric={d.metrics.find((m) => m.id === 'e1rm')}
              asOf={cutoff}
              from={from}
              to={to}
            />
            <DistributionCard data={d} source={state.source} />
            <BlocksCard data={d} mov={lift} />
          </div>
        </div>
      )}
      {d && state.compare && state.sel.length > 0 && (
        <CompareView
          data={d}
          periods={d.periods}
          state={state}
          linked={linked}
          bands={bands}
          marks={marks}
          onOpen={setOpen}
          onClose={() => state.setCompare(false)}
        />
      )}
      {d && (
        <CompareTray
          data={d}
          state={state}
          open={state.compare}
          onOpen={() => state.setCompare(!state.compare)}
        />
      )}
      {d && open && (
        <PeriodDrawer period={open} metrics={d.metrics} scale={state.scale} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}

function scrollTo(e: React.MouseEvent, id: string) {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ block: 'start' });
}
