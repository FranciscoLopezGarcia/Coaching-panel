import { useEffect, useState } from 'react';
import { request } from '../api/client';
import { Message, Modal } from './ui';

/** Editar el perfil del atleta (nombre y ejercicios de competencia). Lo demás (parámetros, accesos) está en sus pestañas. */
export function EditAthleteDialog({
  id,
  name,
  competition,
  onClose,
  onSaved,
}: {
  id: string;
  name: string;
  competition: Partial<Record<'SQ' | 'BP' | 'DL', string>>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [n, setN] = useState(name);
  const [c, setC] = useState({
    SQ: competition.SQ ?? '',
    BP: competition.BP ?? '',
    DL: competition.DL ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Editar perfil del atleta" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await request(`/api/athletes/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: JSON.stringify({
                name: n.trim(),
                competitionExercises: Object.fromEntries(
                  Object.entries(c)
                    .map(([k, v]) => [k, v.trim()])
                    .filter(([, v]) => v),
                ),
              }),
            });
            onSaved();
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Nombre
          <input required maxLength={80} value={n} onChange={(e) => setN(e.target.value)} />
        </label>
        <p className="small muted">
          Ejercicios de competencia: el nombre exacto con el que están cargados en su plan (así el sistema
          reconoce cuál es la sentadilla, la banca y el peso muerto de competencia).
        </p>
        {(['SQ', 'BP', 'DL'] as const).map((k) => (
          <label key={k}>
            {k === 'SQ' ? 'Sentadilla' : k === 'BP' ? 'Banca' : 'Peso muerto'}
            <input value={c[k]} maxLength={80} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
          </label>
        ))}
        {error && <Message error>{error}</Message>}
        <div className="sticky-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy || !n.trim()}>
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Eliminar al atleta y todo lo suyo. Hay que escribir su nombre exacto. */
export function DeleteAthleteDialog({
  id,
  name,
  onClose,
  onDeleted,
}: {
  id: string;
  name: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Eliminar atleta" onClose={onClose}>
      <Message error>
        Se borra a <b>{name}</b> con TODO lo suyo: plan, bloques, entrenos registrados, evaluaciones, notas y
        su acceso al portal. No se puede deshacer.
      </Message>
      <label>
        Para confirmar, escribí el nombre exacto: <b>{name}</b>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </label>
      {error && <Message error>{error}</Message>}
      <div className="sticky-actions">
        <button type="button" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="danger"
          disabled={busy || typed.trim() !== name}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await request(
                `/api/athletes/${encodeURIComponent(id)}?confirm=${encodeURIComponent(typed.trim())}`,
                {
                  method: 'DELETE',
                  body: '{}',
                },
              );
              onDeleted();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? 'Eliminando…' : 'Eliminar para siempre'}
        </button>
      </div>
    </Modal>
  );
}

interface Removal {
  name: string;
  sessions: number;
  sets: number;
  executedSets: number;
}
/** Eliminar un bloque. Muestra qué se pierde; si tiene entrenos registrados hay que tildar que también se borran. */
export function DeleteBlockDialog({
  id,
  blockKey,
  onClose,
  onDeleted,
}: {
  id: string;
  blockKey: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [pv, setPv] = useState<Removal | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    request<Removal>(
      `/api/athletes/${encodeURIComponent(id)}/blocks/${encodeURIComponent(blockKey)}/removal-preview`,
    )
      .then(setPv)
      .catch((e: Error) => setError(e.message));
  }, [id, blockKey]);
  const needs = (pv?.executedSets ?? 0) > 0;
  return (
    <Modal title="Eliminar bloque" onClose={onClose}>
      {!pv && !error && <p className="muted">Calculando qué se borra…</p>}
      {pv && (
        <>
          <Message error>
            Se elimina el bloque <b>{pv.name}</b>: {pv.sessions} {pv.sessions === 1 ? 'sesión' : 'sesiones'} y{' '}
            {pv.sets} series. Queda una versión del plan que lo registra.
          </Message>
          {needs && (
            <label className="check">
              <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
              <span>
                Este bloque tiene{' '}
                <b>
                  {pv.executedSets} {pv.executedSets === 1 ? 'serie ya registrada' : 'series ya registradas'}
                </b>{' '}
                por el atleta. Entiendo que también se borran, para siempre.
              </span>
            </label>
          )}
        </>
      )}
      {error && <Message error>{error}</Message>}
      <div className="sticky-actions">
        <button type="button" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="danger"
          disabled={busy || !pv || (needs && !ok)}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await request(
                `/api/athletes/${encodeURIComponent(id)}/blocks/${encodeURIComponent(blockKey)}?withExecution=${needs ? '1' : '0'}`,
                { method: 'DELETE', body: '{}' },
              );
              onDeleted();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? 'Eliminando…' : 'Eliminar bloque'}
        </button>
      </div>
    </Modal>
  );
}
