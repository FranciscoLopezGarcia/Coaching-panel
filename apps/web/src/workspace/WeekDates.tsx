import { useState } from 'react';
import type { SessionRow } from '@coaching/contracts';
import { send } from './api';
import { Message, shift } from './ui';
import { applyAll, previewAll, type RunItem } from './programRun';

type Micro = { blockKey: string; weekNo: number; startDate: string; endDate: string };
const isoDay = (d: string) => ((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1;
const diff = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/**
 * Cambiar las fechas de una semana: se elige la nueva fecha de la primera sesión y se corren todas sus sesiones los mismos días
 * (opcionalmente también las semanas siguientes del bloque). Actualiza además las fechas del microciclo.
 */
export function WeekDates({
  id,
  all,
  micros,
  block,
  week,
  onDone,
}: {
  id: string;
  all: SessionRow[];
  micros: Micro[];
  block: string;
  week: number;
  onDone: (msg: string) => void;
}) {
  const mine = all.filter((s) => s.blockKey === block && s.weekNo === week);
  const first = mine.map((s) => s.date).sort()[0];
  const [date, setDate] = useState(first ?? '');
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!first) return null;
  const delta = date ? diff(first, date) : 0;
  const apply = async () => {
    if (!delta || busy) return;
    setBusy(true);
    setError('');
    try {
      const affected = all.filter(
        (s) => s.blockKey === block && (following ? s.weekNo >= week : s.weekNo === week),
      );
      const items: RunItem[] = affected.map((s) => ({
        label: `Mover ${s.sessionKey}`,
        op: {
          type: 'move_session',
          sessionKey: s.sessionKey,
          plannedDate: shift(s.date, delta),
          dayNo: isoDay(shift(s.date, delta)),
        } as RunItem['op'],
      }));
      const reviewed = await previewAll(id, items, 'Cambio de fechas de la semana');
      await applyAll(id, reviewed, 'Cambio de fechas de la semana');
      for (const m of micros.filter(
        (x) => x.blockKey === block && (following ? x.weekNo >= week : x.weekNo === week),
      ))
        await send(
          id,
          'microcycles',
          {
            blockKey: m.blockKey,
            weekNo: m.weekNo,
            startDate: shift(m.startDate, delta),
            endDate: shift(m.endDate, delta),
          },
          'PUT',
        );
      onDone(`Fechas movidas ${delta > 0 ? '+' : ''}${delta} días (${affected.length} sesiones).`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="wk-dates" onClick={(e) => e.stopPropagation()}>
      <label>
        Primera sesión
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
      </label>
      <label className="check">
        <input type="checkbox" checked={following} onChange={(e) => setFollowing(e.target.checked)} /> y las
        siguientes
      </label>
      <button type="button" disabled={!delta || busy} onClick={() => void apply()}>
        {busy ? 'Moviendo…' : delta ? `Mover ${delta > 0 ? '+' : ''}${delta} d` : 'Mover'}
      </button>
      {error && <Message error>{error}</Message>}
    </span>
  );
}
