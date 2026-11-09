import { useMemo, useState } from 'react';
import type { SessionRow } from '@coaching/contracts';
import { Message, Modal, shift, dateLabel } from './ui';
import { parseQuickSession } from './quickSession';
import { buildSets, specsByExercise, splitWeekText, weekToText } from './sessionText';
import { applyAll, previewAll, type Reviewed, type RunItem } from './programRun';

const monday = (d: string) => {
  const x = new Date(d + 'T12:00:00Z');
  return shift(d, -((x.getUTCDay() + 6) % 7));
};

/**
 * Copiar el microciclo completo a varias semanas y retocarlo: la semana se abre como texto («# Día 1»), se edita y se crean las semanas
 * elegidas, con la opción de subir el RPE semana a semana (como «Duplicar semana +1 RPE» de PRG).
 */
export function WeekCopyDialog({
  id,
  sessions,
  all,
  block,
  week,
  onClose,
  onSaved,
}: {
  id: string;
  sessions: SessionRow[];
  all: SessionRow[];
  block: string;
  week: number;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [text, setText] = useState(() => weekToText(sessions));
  const [from, setFrom] = useState(week + 1);
  const [to, setTo] = useState(week + 1);
  const [delta, setDelta] = useState('0');
  const [replace, setReplace] = useState(false);
  const [reviewed, setReviewed] = useState<Reviewed[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const srcMonday = monday(sessions[0]?.date ?? new Date().toISOString().slice(0, 10));
  const [startDate, setStartDate] = useState(shift(srcMonday, 7));
  const parsed = useMemo(() => {
    const sp = splitWeekText(text);
    const days = sp.days.map((d) => {
      const r = parseQuickSession(d.text);
      return { ...d, result: r, specs: specsByExercise(r.segments) };
    });
    const errors = [
      ...sp.errors,
      ...days.flatMap((d) =>
        d.result.errors.map((e) => ({
          line: d.startLine + e.line - 1,
          message: `Día ${d.dayNo}: ${e.message}`,
        })),
      ),
    ];
    return { days, errors };
  }, [text]);
  const weeksList = useMemo(() => {
    const out: number[] = [];
    for (let n = Math.max(1, from); n <= Math.min(to, from + 25); n++) if (n !== week) out.push(n);
    return out;
  }, [from, to, week]);
  const existing = (n: number) => all.filter((s) => s.blockKey === block && s.weekNo === n);
  const build = (): RunItem[] => {
    const items: RunItem[] = [];
    weeksList.forEach((n, k) => {
      const ex = existing(n);
      if (ex.length && !replace) return;
      if (ex.length && replace) {
        const ids = ex.flatMap((s) => s.sets.filter((x) => !x.retired).map((x) => x.plannedSetId));
        if (ids.length)
          items.push({
            label: `Quitar la semana ${n} actual`,
            op: { type: 'remove_sets', selection: { setIds: ids } } as RunItem['op'],
          });
      }
      const start = shift(monday(startDate), 7 * (n - from));
      const sets: Record<string, unknown>[] = [];
      for (const d of parsed.days) {
        const ctx = {
          sessionKey: 'session-' + crypto.randomUUID(),
          date: shift(start, d.dayNo - 1),
          blockKey: block,
          weekNo: n,
          dayNo: d.dayNo,
        };
        d.specs.forEach((g, i) => {
          const step = Number(delta) * (k + 1);
          const adj = {
            ...g,
            sets: g.sets.map((s) => ({
              ...s,
              rpe:
                s.rpe === null || !step
                  ? s.rpe
                  : Math.min(10, Math.max(1, Math.round((s.rpe + step) * 2) / 2)),
            })),
          };
          sets.push(...buildSets(ctx, adj, i));
        });
      }
      for (let i = 0; i < sets.length; i += 450)
        items.push({
          label: `Crear semana ${n}`,
          op: { type: 'add_sets', sets: sets.slice(i, i + 450) } as RunItem['op'],
        });
    });
    return items;
  };
  const review = async () => {
    setBusy(true);
    setError('');
    setReviewed(null);
    try {
      const items = build();
      if (!items.length)
        throw new Error('No hay semanas para crear (las elegidas ya existen: activá «Reemplazar»).');
      setReviewed(await previewAll(id, items, 'Copia de microciclo'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    if (!reviewed?.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const n = await applyAll(id, reviewed, 'Copia de microciclo');
      onSaved(
        `${n} operaciones aplicadas: semanas ${weeksList.join(', ')}. La evaluación debe actualizarse.`,
      );
      onClose();
    } catch (e) {
      setError(`${(e as Error).message} Pudieron aplicarse algunas semanas: revisá el bloque.`);
      setReviewed(null);
    } finally {
      setBusy(false);
    }
  };
  const totalSets = parsed.days.reduce((a, d) => a + d.result.lines.reduce((b, l) => b + l.sets, 0), 0);
  return (
    <Modal title={`Duplicar la semana ${week}`} onClose={onClose}>
      <p className="small muted">
        Editá el microciclo como texto (un «# Día n» por sesión) y elegí a qué semanas copiarlo. Si querés,
        subí el RPE semana a semana.
      </p>
      <div className="form-grid compact">
        <label>
          Asignarla a la semana n.º
          <input
            type="number"
            min={1}
            max={60}
            value={from}
            onChange={(e) => {
              const n = Number(e.target.value) || 1;
              setFrom(n);
              setTo((t) => Math.max(t, n));
              setStartDate(shift(srcMonday, 7 * (n - week)));
              setReviewed(null);
            }}
          />
        </label>
        <label>
          Empieza el (lunes)
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value || startDate);
              setReviewed(null);
            }}
          />
        </label>
        <label>
          Repetirla hasta la semana n.º
          <input
            type="number"
            min={from}
            max={60}
            value={to}
            onChange={(e) => {
              setTo(Number(e.target.value) || from);
              setReviewed(null);
            }}
          />
        </label>
        <label>
          Progresión del RPE
          <select
            value={delta}
            onChange={(e) => {
              setDelta(e.target.value);
              setReviewed(null);
            }}
          >
            <option value="0">Sin cambio</option>
            <option value="0.5">+0,5 RPE por semana</option>
            <option value="1">+1 RPE por semana</option>
            <option value="-0.5">−0,5 RPE por semana</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => {
              setReplace(e.target.checked);
              setReviewed(null);
            }}
          />{' '}
          Reemplazar semanas que ya existen
        </label>
      </div>
      <textarea
        className="quick-text"
        rows={14}
        spellCheck={false}
        value={text}
        disabled={busy}
        onChange={(e) => {
          setText(e.target.value);
          setReviewed(null);
        }}
        aria-label="Semana en texto"
      />
      {parsed.errors.length > 0 && (
        <ul className="quick-errors" role="alert">
          {parsed.errors.map((e) => (
            <li key={e.line + e.message}>
              <b>Línea {e.line}:</b> {e.message}
            </li>
          ))}
        </ul>
      )}
      <div className="preview">
        <h3>
          Se{' '}
          {weeksList.filter((n) => replace || !existing(n).length).length === 1
            ? 'creará 1 semana'
            : `crearán ${weeksList.filter((n) => replace || !existing(n).length).length} semanas`}{' '}
          · {parsed.days.length} días · {totalSets} series por semana
        </h3>
        <ul>
          {weeksList.map((n) => (
            <li key={n}>
              Semana {n} · desde {dateLabel(shift(monday(startDate), 7 * (n - from)))}
              {existing(n).length ? (replace ? ' · reemplaza la existente' : ' · ya existe: se omite') : ''}
            </li>
          ))}
        </ul>
        {error && <Message error>{error}</Message>}
        {reviewed
          ?.flatMap((r) => r.result.warnings ?? [])
          .map((x) => (
            <Message key={x}>{x}</Message>
          ))}
        {reviewed && (
          <button type="button" className="primary" disabled={busy} onClick={() => void create()}>
            {busy
              ? 'Creando…'
              : (() => {
                  const k = weeksList.filter((n) => replace || !existing(n).length).length;
                  return k === 1 ? 'Crear 1 semana' : `Crear ${k} semanas`;
                })()}
          </button>
        )}
      </div>
      <div className="sticky-actions">
        <span className="small muted">{reviewed ? 'Revisión lista' : 'Sin revisar'}</span>
        <button
          className="primary"
          type="button"
          disabled={busy || parsed.errors.length > 0 || !parsed.days.length}
          onClick={() => void review()}
        >
          {busy ? 'Revisando…' : 'Revisar'}
        </button>
      </div>
    </Modal>
  );
}
