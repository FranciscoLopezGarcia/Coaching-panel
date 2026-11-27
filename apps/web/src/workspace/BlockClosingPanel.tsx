import type { BlockFeedbackRow, LiftClosing } from '@coaching/contracts';
import { request } from '../api/client';
import { useLoad } from '../hooks';
import { dateLabel } from './ui';

type Item = BlockFeedbackRow & { blockName: string };
const LIFTS = [
  ['SQ', 'Sentadilla'],
  ['BP', 'Banca'],
  ['DL', 'Peso muerto'],
] as const;
const FEEL = { peor: 'Peor', igual: 'Igual', mejor: 'Mejor' };
const LOAD = { liviana: 'Liviana', justa: 'Justa', pesada: 'Pesada' };
const score = (v: number | null) => (v === null ? '—' : `${v}/10`);

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LiftColumn({ name, x }: { name: string; x: LiftClosing }) {
  return (
    <div className="closing-lift">
      <h4>{name}</h4>
      <dl>
        <Fact label="Sensación" value={x.feel ? FEEL[x.feel] : '—'} />
        <Fact label="Fatiga" value={score(x.fatigue)} />
        <Fact label="Técnica" value={score(x.technique)} />
        <Fact label="Molestias" value={score(x.discomfort)} />
      </dl>
      {x.discomfortWhere && <p>Dónde: {x.discomfortWhere}</p>}
      {x.note && <p>{x.note}</p>}
    </div>
  );
}

/** Cierre de bloque que dejó el atleta. Sin `blockKey` muestra el último que envió. Solo lectura. */
export function BlockClosingPanel({ id, blockKey }: { id: string; blockKey?: string }) {
  const state = useLoad(
    () => request<{ items: Item[] }>(`/api/athletes/${encodeURIComponent(id)}/block-feedback`),
    [id, blockKey],
  );
  if (state.error) return <p className="small muted">No se pudo leer el cierre de bloque: {state.error}</p>;
  if (!state.data) return null;
  const item = blockKey ? state.data.items.find((x) => x.blockKey === blockKey) : state.data.items[0];
  if (!item)
    return blockKey ? (
      <p className="small muted">El atleta todavía no dejó el cierre de este bloque.</p>
    ) : null;
  const { general: g, lifts, notes } = item.answers;
  const written: [string, string][] = [
    ['Lo mejor', notes.best],
    ['Lo que más costó', notes.hardest],
    ['Para el próximo', notes.next],
    ['Algo más', notes.other],
  ];
  return (
    <section className="closing-panel">
      <header>
        <h3>Cierre de {item.blockName}</h3>
        <span className="small muted">Lo envió el atleta el {dateLabel(item.updatedAt.slice(0, 10))}</span>
      </header>
      <dl className="closing-general">
        <Fact label="Fatiga" value={score(g.fatigue)} />
        <Fact label="Estrés" value={score(g.stress)} />
        <Fact label="Sueño" value={score(g.sleep)} />
        <Fact label="Ganas" value={score(g.motivation)} />
        <Fact label="Conformidad" value={score(g.satisfaction)} />
        <Fact label="Carga" value={g.load ? LOAD[g.load] : '—'} />
      </dl>
      <div className="closing-lifts">
        {LIFTS.map(([l, name]) => {
          const x = lifts[l];
          return x ? <LiftColumn key={l} name={name} x={x} /> : null;
        })}
      </div>
      {written
        .filter(([, text]) => text)
        .map(([label, text]) => (
          <p key={label} className="closing-note">
            <b>{label}:</b> {text}
          </p>
        ))}
    </section>
  );
}
