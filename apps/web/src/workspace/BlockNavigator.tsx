import type { SessionRow } from '@coaching/contracts';
import { dateLabel, today } from './ui';
import type { Meso } from './api';
import { DeleteBlockDialog } from './AthleteAdmin';
import { BlockExportDialog } from './BlockExportDialog';

type Sel = (v: Record<string, string | null>) => void;
const done = (s: SessionRow) => {
  const work = s.sets.filter((x) => !x.retired && !x.isWarmup);
  return { n: work.length, ok: work.filter((x) => x.actual?.status === 'done').length };
};

/** Semanas de un bloque con su fecha de inicio y cuánto se hizo, para elegir qué exportar. */
const weeksOf = (ss: SessionRow[]) =>
  [...new Set(ss.map((s) => s.weekNo))]
    .sort((a, b) => a - b)
    .map((n) => {
      const mine = ss.filter((s) => s.weekNo === n);
      const tot = mine.reduce((a, s) => ({ n: a.n + done(s).n, ok: a.ok + done(s).ok }), { n: 0, ok: 0 });
      return {
        n,
        detail: `desde ${dateLabel(mine.map((s) => s.date).sort()[0])} · ${tot.ok}/${tot.n} series`,
      };
    });

/**
 * Navegador de bloques: todos los bloques en una tira (con su estado) y saltar al anterior/siguiente. Las sesiones de cada semana se ven
 * como tarjetas debajo. No cambia datos: solo mueve la selección del contexto.
 */
export function BlockNavigator({
  id,
  onDeleted,
  dialog,
  onCloseDialog,
  sessions,
  mesos,
  block,
  onSelect,
}: {
  id: string;
  onDeleted: () => void;
  /** Exportar y eliminar se piden desde el menú «Más» de Programar. */
  dialog: '' | 'export' | 'delete';
  onCloseDialog: () => void;
  sessions: SessionRow[];
  mesos: Meso[];
  block: string;
  onSelect: Sel;
}) {
  const t = today();
  // Todos los bloques: los que tienen sesiones Y los mesos creados que todavía no tienen ninguna (antes se escondían).
  const keys = [...new Set([...sessions.map((s) => s.blockKey), ...mesos.map((m) => m.blockKey)])];
  const blocks = keys
    .map((key) => {
      const ss = sessions.filter((s) => s.blockKey === key);
      const dates = ss.map((s) => s.date).sort();
      const m = mesos.find((x) => x.blockKey === key);
      const tot = ss.reduce((a, s) => ({ n: a.n + done(s).n, ok: a.ok + done(s).ok }), { n: 0, ok: 0 });
      return {
        key,
        name: m?.name ?? key,
        macroId: m?.macroId ?? null,
        from: dates[0] ?? m?.startDate ?? '',
        to: dates[dates.length - 1] ?? m?.endDate ?? m?.startDate ?? '',
        sessions: ss.length,
        ...tot,
      };
    })
    // los que no tienen ninguna fecha van al final, en vez de al principio
    .sort((a, b) => (a.from || '9999').localeCompare(b.from || '9999'));
  const status = (b: (typeof blocks)[number]) =>
    !b.sessions ? 'future' : b.to < t ? (b.ok ? 'past' : 'pending-past') : b.from <= t ? 'current' : 'future';
  const go = (b: (typeof blocks)[number] | undefined) =>
    b && onSelect({ macro: b.macroId, block: b.key, week: null, session: null });
  return (
    <section className="block-nav" aria-label="Navegador de bloques">
      {dialog === 'export' && (
        <BlockExportDialog
          id={id}
          blocks={blocks.map((b) => ({
            key: b.key,
            name: b.name,
            detail: b.sessions
              ? `${dateLabel(b.from)} – ${dateLabel(b.to)} · ${b.sessions} ${b.sessions === 1 ? 'sesión' : 'sesiones'} · ${b.ok}/${b.n} series hechas`
              : 'sin sesiones todavía',
            weeks: weeksOf(sessions.filter((s) => s.blockKey === b.key)),
          }))}
          current={block}
          onClose={onCloseDialog}
        />
      )}
      {dialog === 'delete' && block && (
        <DeleteBlockDialog
          id={id}
          blockKey={block}
          onClose={onCloseDialog}
          onDeleted={() => {
            onCloseDialog();
            onDeleted();
          }}
        />
      )}
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
            <small>{b.from ? `${dateLabel(b.from)} – ${dateLabel(b.to)}` : 'Sin fechas'}</small>
            <em>
              {!b.sessions
                ? 'sin sesiones todavía'
                : status(b) === 'current'
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
    </section>
  );
}
