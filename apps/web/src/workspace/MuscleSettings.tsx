import { useState } from 'react';
import type { AthleteDetail, ParamsInput } from '@coaching/contracts';
import { api } from '../api/client';
import { useLoad } from '../hooks';
import { get, type MuscleData } from './api';
import { shift, today } from './ui';

/** Grupos que acepta el motor (ids) con su nombre. El coach elige, no se infiere. */
export const GROUPS: [string, string][] = [
  ['cuadriceps', 'Cuádriceps'],
  ['gluteos', 'Glúteos'],
  ['isquiotibiales', 'Isquios'],
  ['pantorrillas', 'Gemelos'],
  ['aductores', 'Aductores'],
  ['abductores', 'Abductores'],
  ['espalda_baja', 'Espalda baja'],
  ['dorsales', 'Dorsales'],
  ['espalda_alta', 'Espalda alta'],
  ['trapecio', 'Trapecio'],
  ['pectoral', 'Pecho'],
  ['hombros', 'Hombros'],
  ['biceps', 'Bíceps'],
  ['triceps', 'Tríceps'],
  ['antebrazos', 'Antebrazos'],
  ['core', 'Core'],
  ['oblicuos', 'Oblicuos'],
];
/** Guarda SOLO los campos indicados, partiendo de los parámetros actuales del servidor (evita pisar cambios hechos desde otro panel). */
const saveMerged = async (id: string, patch: Partial<ParamsInput>) => {
  const fresh = (await api.athlete(id)).params as ParamsInput;
  await api.saveParams(id, { ...fresh, ...patch });
};
const keyOf = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Cómo se cuentan los músculos de este atleta: nivel de detalle y, si hace falta, un mapa propio por ejercicio
 * (p. ej. «mi peso muerto convencional carga más isquios que mi sentadilla safety»). Lo que no se cambia usa la convención del proyecto.
 */
export function MuscleSettings({
  id,
  athlete,
  onChanged,
}: {
  id: string;
  athlete: AthleteDetail;
  onChanged: () => void;
}) {
  const params = athlete.params as ParamsInput;
  const [view, setView] = useState<'fino' | 'medio' | 'grueso'>(params.muscleView ?? 'fino');
  const [map, setMap] = useState<NonNullable<ParamsInput['muscleMap']>>(params.muscleMap ?? {});
  const [name, setName] = useState('');
  const [direct, setDirect] = useState<string[]>([]);
  const [indirect, setIndirect] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const names = useLoad(async () => {
    const r = await get<MuscleData>(
      id,
      'weekly-muscles?from=' + shift(today(), -120) + '&to=' + today() + '&view=fino',
    );
    return [...new Set([...r.rows.flatMap((x) => x.exercises), ...r.unmappedExercises])].sort();
  }, [id]);
  const toggle = (list: string[], set: (l: string[]) => void, g: string) =>
    set(list.includes(g) ? list.filter((x) => x !== g) : [...list, g]);
  const save = async (nextView = view, nextMap = map) => {
    setError('');
    try {
      await saveMerged(id, { muscleView: nextView, muscleMap: nextMap });
      setMsg('Guardado. Se aplica en el análisis muscular al recargar.');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const label = (g: string) => GROUPS.find((x) => x[0] === g)?.[1] ?? g;
  return (
    <section className="muscle-settings">
      <h3>Músculos</h3>
      <p className="small muted">
        Define cuánto detalle se muestra y cómo se reparte cada ejercicio. Directo cuenta 1 serie; indirecto
        0,5. Sin cambios, se usa la convención del proyecto.
      </p>
      <label>
        Nivel de detalle
        <select value={view} onChange={(e) => setView(e.target.value as typeof view)}>
          <option value="fino">Fino · 17 grupos</option>
          <option value="medio">Medio · espalda, brazos y core agrupados</option>
          <option value="grueso">Grueso · tren superior / inferior</option>
        </select>
      </label>
      <button type="button" onClick={() => save(view, map)}>
        Guardar nivel de detalle
      </button>
      <h4>Mapa propio por ejercicio</h4>
      {Object.keys(map).length === 0 && (
        <p className="small muted">Todavía no hay ejercicios con mapa propio.</p>
      )}
      <ul>
        {Object.entries(map).map(([k, v]) => (
          <li key={k}>
            <strong>{k}</strong> · directo: {v.direct.map(label).join(', ') || '—'} · indirecto:{' '}
            {v.indirect.map(label).join(', ') || '—'}{' '}
            <button
              type="button"
              onClick={() => {
                const n = { ...map };
                delete n[k];
                setMap(n);
                void save(view, n);
              }}
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>
      <label>
        Ejercicio
        <input
          list="muscle-exercises"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Escribí o elegí"
        />
        <datalist id="muscle-exercises">
          {(names.data ?? []).map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </label>
      <div className="row">
        <fieldset>
          <legend>Directo</legend>
          {GROUPS.map(([g, n]) => (
            <label key={g}>
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
          <legend>Indirecto</legend>
          {GROUPS.map(([g, n]) => (
            <label key={g}>
              <input
                type="checkbox"
                checked={indirect.includes(g)}
                onChange={() => toggle(indirect, setIndirect, g)}
              />{' '}
              {n}
            </label>
          ))}
        </fieldset>
      </div>
      <button
        type="button"
        disabled={!name.trim() || (!direct.length && !indirect.length)}
        onClick={() => {
          const n = {
            ...map,
            [keyOf(name)]: { direct, indirect: indirect.filter((g) => !direct.includes(g)) },
          };
          setMap(n);
          setName('');
          setDirect([]);
          setIndirect([]);
          void save(view, n);
        }}
      >
        Agregar / reemplazar ejercicio
      </button>
      {msg && <p className="small">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/** Cortes de %1RM que definen las zonas de intensidad (Zona 1, 2, 3…). Sin juicio de valor: es la forma de agrupar las series. */
export function ZoneSettings({
  id,
  athlete,
  onChanged,
}: {
  id: string;
  athlete: AthleteDetail;
  onChanged: () => void;
}) {
  const params = athlete.params as ParamsInput;
  const [text, setText] = useState((params.intensityCuts ?? [75, 90]).join(', '));
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    const cuts = text
      .split(/[,;\s]+/)
      .filter(Boolean)
      .map((x) => Number(x.replace(',', '.')));
    if (!cuts.length || cuts.some((c) => !Number.isFinite(c) || c < 10 || c > 150) || cuts.length > 5) {
      setError('Poné de 1 a 5 cortes entre 10 y 150 (p. ej. 75, 90).');
      return;
    }
    try {
      await saveMerged(id, { intensityCuts: [...new Set(cuts)].sort((a, b) => a - b) });
      setMsg('Guardado. Se aplica en Analizar al recargar.');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="zone-settings">
      <h3>Zonas de intensidad</h3>
      <p className="small muted">
        Cortes de %1RM que separan las zonas. Con 75 y 90: Zona 1 &lt; 75, Zona 2 de 75 a &lt; 90, Zona 3 ≥
        90. Es solo una forma de agrupar las series; el sistema no dice qué distribución es mejor.
      </p>
      <label>
        Cortes (%1RM, separados por coma)
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button type="button" onClick={save}>
        Guardar zonas
      </button>
      {msg && <p className="small">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
