import { useMemo, useState } from 'react';
import type { LibraryEntryData } from '@coaching/contracts';
import { request } from '../api/client';
import { Async } from '../components/Async';
import { useLoad } from '../hooks';
import { GROUPS } from './MuscleSettings';
import { Message, Modal } from './ui';

const LABEL = new Map(GROUPS);
const LIFT_NAME: Record<string, string> = { SQ: 'Sentadilla', BP: 'Banca', DL: 'Peso muerto' };
const ROLE: Record<string, string> = { primaria: 'Básico', secundaria: 'Variante', accesorio: 'Accesorio' };
const summary = (e: LibraryEntryData, kind: 'directo' | 'indirecto') =>
  (e.muscles ?? [])
    .filter((m) => m.kind === kind)
    .map((m) => LABEL.get(m.group) ?? m.group)
    .join(', ') || '—';

/** Biblioteca (fija + propia) para autocompletar al programar. Si no carga, se programa igual con texto libre. */
export function useLibrary(): LibraryEntryData[] {
  const l = useLoad(() => request<LibraryEntryData[]>('/api/exercise-library'), []);
  return useMemo(() => l.data ?? [], [l.data]);
}

/** Biblioteca de ejercicios: la fija del sistema (músculos y patrón salen de las mismas reglas del análisis) + los propios del coach. */
export function LibraryPanel() {
  const lib = useLoad(() => request<LibraryEntryData[]>('/api/exercise-library'), []);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  return (
    <section className="card library-panel" id="biblioteca">
      <div className="row between">
        <h2>Biblioteca de ejercicios</h2>
        <button className="primary" onClick={() => setAdding(true)}>
          + Ejercicio propio
        </button>
      </div>
      <p className="small muted">
        Los ejercicios propios aportan sus músculos al análisis de todos tus atletas (el mapa propio de un
        atleta, si lo hay, gana). Los fijos no se pueden editar.
      </p>
      <label>
        Buscar
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="nombre del ejercicio" />
      </label>
      {msg && <Message error={msg.error}>{msg.text}</Message>}
      <Async state={lib}>
        {(all) => {
          const rows = all.filter((e) => e.name.toLowerCase().includes(q.trim().toLowerCase()));
          return (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ejercicio</th>
                    <th>Origen</th>
                    <th>Movimiento</th>
                    <th>Rol sugerido</th>
                    <th>Directo</th>
                    <th>Indirecto</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.name}>
                      <td>{e.name}</td>
                      <td>{e.origin === 'propia' ? 'Propio' : 'Fijo'}</td>
                      <td>{e.lift ? LIFT_NAME[e.lift] : '—'}</td>
                      <td>{e.origin === 'fija' ? ROLE[e.role] : '—'}</td>
                      <td>{summary(e, 'directo')}</td>
                      <td>{summary(e, 'indirecto')}</td>
                      <td>
                        {e.id && (
                          <button
                            onClick={async () => {
                              if (!window.confirm(`¿Borrar «${e.name}» de tu biblioteca?`)) return;
                              try {
                                await request(`/api/exercise-library/${e.id}`, {
                                  method: 'DELETE',
                                  body: '{}',
                                });
                                lib.reload();
                              } catch (err) {
                                setMsg({ text: (err as Error).message, error: true });
                              }
                            }}
                          >
                            Borrar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={7} className="muted">
                        Sin resultados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        }}
      </Async>
      {adding && (
        <AddExercise
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            lib.reload();
            setMsg({ text: 'Ejercicio agregado a tu biblioteca.' });
          }}
        />
      )}
    </section>
  );
}

function AddExercise({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [lift, setLift] = useState('');
  const [equipment, setEquipment] = useState('');
  const [direct, setDirect] = useState<string[]>([]);
  const [indirect, setIndirect] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (list: string[], set: (v: string[]) => void, g: string) =>
    set(list.includes(g) ? list.filter((x) => x !== g) : [...list, g]);
  return (
    <Modal title="Ejercicio propio" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await request('/api/exercise-library', {
              method: 'POST',
              body: JSON.stringify({
                name: name.trim(),
                lift: lift || null,
                equipment: equipment.trim(),
                muscles: { direct, indirect: indirect.filter((g) => !direct.includes(g)) },
              }),
            });
            onSaved();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Nombre
          <input
            required
            minLength={2}
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Movimiento de competencia (si es una variante)
          <select value={lift} onChange={(e) => setLift(e.target.value)}>
            <option value="">Ninguno (accesorio)</option>
            <option value="SQ">Sentadilla</option>
            <option value="BP">Banca</option>
            <option value="DL">Peso muerto</option>
          </select>
        </label>
        <label>
          Equipo
          <input maxLength={40} value={equipment} onChange={(e) => setEquipment(e.target.value)} />
        </label>
        <fieldset>
          <legend>Músculos directos (cuentan 1 serie)</legend>
          {GROUPS.map(([g, n]) => (
            <label key={g} className="check">
              <input
                type="checkbox"
                checked={direct.includes(g)}
                onChange={() => toggle(direct, setDirect, g)}
              />{' '}
              {n}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Músculos indirectos (cuentan 0,5)</legend>
          {GROUPS.map(([g, n]) => (
            <label key={g} className="check">
              <input
                type="checkbox"
                checked={indirect.includes(g)}
                disabled={direct.includes(g)}
                onChange={() => toggle(indirect, setIndirect, g)}
              />{' '}
              {n}
            </label>
          ))}
        </fieldset>
        <p className="small muted">
          Si no marcás músculos, el análisis usa las reglas por nombre; si el nombre no coincide con ninguna,
          el ejercicio queda sin mapear (no se adivina).
        </p>
        {error && <Message error>{error}</Message>}
        <div className="sticky-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy || name.trim().length < 2}>
            {busy ? 'Guardando…' : 'Agregar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
