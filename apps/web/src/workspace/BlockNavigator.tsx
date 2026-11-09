import type { SessionRow } from '@coaching/contracts';
import { dateLabel, today } from './ui';
import type { Meso } from './api';

type Sel = (v: Record<string, string | null>) => void;
const done = (s: SessionRow) => {
  const work = s.sets.filter((x) => !x.retired && !x.isWarmup);
  return { n: work.length, ok: work.filter((x) => x.actual?.status === 'done').length };
};

/**
 * Navegador de bloques: todos los bloques en una tira (con su estado) y saltar al anterior/siguiente. Las sesiones de cada semana se ven
 * como tarjetas debajo. No cambia datos: solo mueve la selección del contexto.
 */
export function BlockNavigator({
  sessions,
  mesos,
  block,
  week,
  onSelect,
}: {
  sessions: SessionRow[];
  mesos: Meso[];
  block: string;
  week: number;
  onSelect: Sel;
}) {
  const t = today();
  const blocks = [...new Set(sessions.map((s) => s.blockKey))]
    .map((key) => {
      const ss = sessions.filter((s) => s.blockKey === key);
      const dates = ss.map((s) => s.date).sort();
      const m = mesos.find((x) => x.blockKey === key);
      const tot = ss.reduce((a, s) => ({ n: a.n + done(s).n, ok: a.ok + done(s).ok }), { n: 0, ok: 0 });
      return {
        key,
        name: m?.name ?? key,
        macroId: m?.macroId ?? null,
        from: dates[0] ?? '',
        to: dates[dates.length - 1] ?? '',
        sessions: ss.length,
        ...tot,
      };
    })
    .sort((a, b) => a.from.localeCompare(b.from));
  const idx = blocks.findIndex((b) => b.key === block);
  const status = (b: (typeof blocks)[number]) =>
    b.to < t ? (b.ok ? 'past' : 'pending-past') : b.from <= t ? 'current' : 'future';
  const go = (b: (typeof blocks)[number] | undefined) =>
    b && onSelect({ macro: b.macroId, block: b.key, week: null, session: null });
  return (
    <section className="block-nav" aria-label="Navegador de bloques">
      <div className="block-nav-head">
        <strong>Bloques</strong>
        <div className="block-nav-actions">
          <button type="button" disabled={idx <= 0} onClick={() => go(blocks[idx - 1])}>
            ← Bloque anterior
          </button>
          <button
            type="button"
            disabled={idx < 0 || idx >= blocks.length - 1}
            onClick={() => go(blocks[idx + 1])}
          >
            Bloque siguiente →
          </button>
        </div>
      </div>
      <div className="block-strip" role="tablist">
        {blocks.map((b) => (
          <button
            key={b.key}
            type="button"
            role="tab"
            aria-selected={b.key === block}
            className={`block-chip ${status(b)}`}
            onClick={() => go(b)}
            title={`${b.sessions} sesiones · ${b.ok}/${b.n} series ejecutadas`}
          >
            <b>{b.name}</b>
            <small>
              {dateLabel(b.from)} – {dateLabel(b.to)}
            </small>
            <em>
              {status(b) === 'current'
                ? 'en curso'
                : status(b) === 'future'
                  ? 'por venir'
                  : b.n
                    ? `${Math.round((b.ok / b.n) * 100)} % ejecutado`
                    : ''}
            </em>
          </button>
        ))}
      </div>
      {week > 0 && <p className="small muted">Semana seleccionada: S{week}.</p>}
    </section>
  );
}
