import { useEffect, useMemo, useState } from 'react';
import type { SessionRow } from '@coaching/contracts';
import { Message, Modal } from './ui';
import { QuickEntry } from './QuickEntry';
import { applyMeta, parseQuickSession, type ExMeta, type QuickSegment } from './quickSession';
import { isoWeekday, planSessionEdit, setsToText, weekOfDate, type EditPlan } from './sessionText';
import { applyAll, previewAll, toProgramOp, type Reviewed } from './programRun';
import { dateLabel } from './ui';
import { get, send } from './api';
import { VIEW_LABEL } from './AthleteAccess';
import { ProgressionPanel } from './ProgressionPanel';

/**
 * Editar una sesión ESCRIBIÉNDOLA otra vez, como si se estuviera prescribiendo: se abre con el texto de lo vigente, se edita y se
 * revisa qué cambia exactamente antes de publicar. Lo que no cambia no se toca.
 */
export function SessionTextEditor({
  id,
  session,
  all,
  onClose,
  onSaved,
}: {
  id: string;
  session: SessionRow;
  all: SessionRow[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const initial = setsToText(session.sets);
  const [text, setText] = useState(initial);
  const initialMeta = useMemo<ExMeta>(() => {
    const m: ExMeta = {};
    for (const s of session.sets.filter((x) => !x.retired)) {
      const cur = m[s.exerciseName] ?? { pause: '', view: '', prog: '' };
      m[s.exerciseName] = {
        pause: cur.pause || (s.protocol?.pauseSec != null ? String(s.protocol.pauseSec) : ''),
        view: cur.view || s.protocol?.athleteView || '',
        prog: cur.prog || s.protocol?.athleteProgression || '',
      };
    }
    return m;
  }, [session.sets]);
  const [segs, setSegs] = useState<QuickSegment[]>(() =>
    applyMeta(parseQuickSession(initial).segments, initialMeta),
  );
  const [ok, setOk] = useState(true);
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [reviewed, setReviewed] = useState<Reviewed[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState(session.date);
  const [weekNo, setWeekNo] = useState(session.weekNo);
  const [viewMode, setViewMode] = useState('');
  const [viewModes, setViewModes] = useState<string[]>([]);
  const [defMode, setDefMode] = useState('completo');
  useEffect(() => {
    get<{ modes: string[]; settings: Record<string, string> }>(id, 'view-settings')
      .then((v) => {
        setViewModes(v.modes);
        setDefMode(v.settings['*'] ?? 'completo');
        setViewMode(v.settings[session.sessionKey] ?? '');
      })
      .catch(() => undefined);
  }, [id, session.sessionKey]);
  const moved = date !== session.date || weekNo !== session.weekNo;
  const dirty = text.trim() !== initial.trim() || moved;
  const review = async () => {
    setBusy(true);
    setError('');
    setReviewed(null);
    try {
      const p = planSessionEdit(session, segs);
      if (moved) {
        p.ops.unshift({
          kind: 'move',
          label: 'Mover sesión',
          date,
          weekNo,
          dayNo: isoWeekday(date),
          sessionKey: session.sessionKey,
        });
        p.changes.unshift(`Sesión: ${session.date} (semana ${session.weekNo}) → ${date} (semana ${weekNo})`);
      }
      setPlan(p);
      if (!p.ops.length) return;
      setReviewed(
        await previewAll(
          id,
          p.ops.map((o) => ({ label: o.label, op: toProgramOp(o) })),
          'Edición de sesión (texto)',
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!reviewed?.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const n = await applyAll(id, reviewed, 'Edición de sesión (texto)');
      onSaved(
        `Sesión actualizada (${n} ${n === 1 ? 'cambio' : 'cambios'}). La evaluación debe actualizarse.`,
      );
      onClose();
    } catch (e) {
      setError(`${(e as Error).message} Revisá el estado de la sesión: pudieron aplicarse algunos cambios.`);
      setReviewed(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Editar sesión · ${dateLabel(session.date)} · Día ${session.dayNo}`} onClose={onClose}>
      <p className="small muted">
        Editá como si la estuvieras prescribiendo. Mismo ejercicio y mismas series: se cambian solo los
        valores. Distinto número de series: se reemplaza ese ejercicio.
      </p>
      <div className="form-grid compact">
        <label>
          Fecha de la sesión
          <input
            type="date"
            value={date}
            disabled={busy}
            onChange={(e) => {
              const d = e.target.value;
              setDate(d);
              setReviewed(null);
              setPlan(null);
              const w = d ? weekOfDate(all, session.blockKey, d) : null;
              if (w) setWeekNo(w);
            }}
          />
        </label>
        <label>
          Semana n.º
          <input
            type="number"
            min={1}
            max={60}
            value={weekNo}
            disabled={busy}
            onChange={(e) => {
              setWeekNo(Math.max(1, Number(e.target.value) || 1));
              setReviewed(null);
              setPlan(null);
            }}
          />
        </label>
        <label>
          El atleta ve en este entreno
          <select
            value={viewMode}
            onChange={async (e) => {
              setViewMode(e.target.value);
              await send(
                id,
                'view-settings',
                { sessionKey: session.sessionKey, mode: e.target.value || null },
                'PUT',
              );
            }}
          >
            <option value="">Lo habitual ({VIEW_LABEL[defMode] ?? defMode})</option>
            {viewModes.map((m) => (
              <option key={m} value={m}>
                {VIEW_LABEL[m] ?? m}
              </option>
            ))}
          </select>
        </label>
        <p className="small muted">
          Al cambiar la fecha, la semana se ajusta sola; podés corregirla. La vista del atleta se guarda al
          elegirla.
        </p>
      </div>
      <QuickEntry
        text={text}
        disabled={busy}
        initialMeta={initialMeta}
        defaultViewLabel={VIEW_LABEL[defMode] ?? defMode}
        onMeta={() => {
          setReviewed(null);
          setPlan(null);
        }}
        onText={(t) => {
          setText(t);
          setReviewed(null);
          setPlan(null);
        }}
        onSegments={(s, good) => {
          setOk(good);
          if (good) setSegs(s);
        }}
      />
      <ProgressionPanel id={id} sessionKey={session.sessionKey} />
      {error && <Message error>{error}</Message>}
      {plan && !plan.ops.length && <Message>No hay cambios respecto de lo vigente.</Message>}
      {plan && plan.ops.length > 0 && (
        <div className="preview">
          <h3>Qué cambia</h3>
          <ul>
            {plan.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {plan.unchanged > 0 && (
            <p className="small muted">{plan.unchanged} ejercicio(s) sin cambios: no se tocan.</p>
          )}
          {plan.warnings.map((x) => (
            <Message key={x}>{x}</Message>
          ))}
          {reviewed
            ?.flatMap((r) => r.result.warnings ?? [])
            .map((x) => (
              <Message key={x}>{x}</Message>
            ))}
          {reviewed && (
            <button type="button" className="primary" disabled={busy} onClick={() => void publish()}>
              {busy ? 'Publicando…' : 'Publicar cambios'}
            </button>
          )}
        </div>
      )}
      <div className="sticky-actions">
        <span className="small muted">{dirty ? 'Cambios sin publicar' : 'Sin cambios'}</span>
        <button
          className="primary"
          type="button"
          disabled={busy || !ok || !dirty}
          onClick={() => void review()}
        >
          {busy ? 'Revisando…' : 'Revisar cambios'}
        </button>
      </div>
    </Modal>
  );
}
