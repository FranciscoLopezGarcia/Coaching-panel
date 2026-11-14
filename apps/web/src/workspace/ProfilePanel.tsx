import { useEffect, useState } from 'react';
import type { ProfileData, ProfileInput } from '@coaching/contracts';
import { request } from '../api/client';
import { Async } from '../components/Async';
import { useLoad } from '../hooks';
import { Message, dateLabel } from './ui';

const num = (v: string): number | null => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const txt = (v: number | null) => (v === null ? '' : String(v));

/** Perfil ampliado del atleta. Todo es opcional: lo que no se carga queda vacío (nunca 0). */
export function ProfilePanel({ id }: { id: string }) {
  const p = useLoad(() => request<ProfileData>(`/api/athletes/${id}/profile`), [id]);
  return (
    <section className="card profile-panel">
      <h2>Perfil del atleta</h2>
      <p className="small muted">
        Datos de contexto para programar y para el resumen que exportás. No cambian ningún cálculo.
      </p>
      <Async state={p}>{(d) => <ProfileForm id={id} initial={d} onSaved={p.reload} />}</Async>
    </section>
  );
}

function ProfileForm({ id, initial, onSaved }: { id: string; initial: ProfileData; onSaved: () => void }) {
  const [f, setF] = useState({
    birthDate: initial.birthDate ?? '',
    sex: initial.sex ?? '',
    bodyweightKg: txt(initial.bodyweightKg),
    weightClass: initial.weightClass,
    federation: initial.federation,
    equipment: initial.equipment ?? '',
    trainingSince: initial.trainingSince ?? '',
    daysPerWeek: txt(initial.daysPerWeek),
    goals: initial.goals,
    historyNotes: initial.historyNotes,
    constraintsNotes: initial.constraintsNotes,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => setMsg(null), [f]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const body = (): ProfileInput => ({
    birthDate: f.birthDate || null,
    sex: (f.sex || null) as ProfileInput['sex'],
    bodyweightKg: num(f.bodyweightKg),
    weightClass: f.weightClass.trim(),
    federation: f.federation.trim(),
    equipment: (f.equipment || null) as ProfileInput['equipment'],
    trainingSince: f.trainingSince || null,
    daysPerWeek: num(f.daysPerWeek),
    goals: f.goals.trim(),
    historyNotes: f.historyNotes.trim(),
    constraintsNotes: f.constraintsNotes.trim(),
  });
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await request(`/api/athletes/${id}/profile`, { method: 'PUT', body: JSON.stringify(body()) });
          onSaved();
          setMsg({ text: 'Perfil guardado.' });
        } catch (err) {
          setMsg({ text: (err as Error).message, error: true });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Fecha de nacimiento
        <input type="date" value={f.birthDate} onChange={set('birthDate')} />
      </label>
      <label>
        Sexo
        <select value={f.sex} onChange={set('sex')}>
          <option value="">Sin dato</option>
          <option value="F">Femenino</option>
          <option value="M">Masculino</option>
          <option value="X">Otro</option>
        </select>
      </label>
      <label>
        Peso corporal (kg)
        <input inputMode="decimal" value={f.bodyweightKg} onChange={set('bodyweightKg')} />
      </label>
      <label>
        Categoría de peso
        <input maxLength={20} value={f.weightClass} onChange={set('weightClass')} placeholder="ej. 63" />
      </label>
      <label>
        Federación
        <input maxLength={60} value={f.federation} onChange={set('federation')} />
      </label>
      <label>
        Equipamiento
        <select value={f.equipment} onChange={set('equipment')}>
          <option value="">Sin dato</option>
          <option value="raw">Raw</option>
          <option value="equipado">Equipado</option>
          <option value="ambos">Ambos</option>
        </select>
      </label>
      <label>
        Entrena desde
        <input type="date" value={f.trainingSince} onChange={set('trainingSince')} />
      </label>
      <label>
        Días por semana disponibles
        <input inputMode="numeric" value={f.daysPerWeek} onChange={set('daysPerWeek')} />
      </label>
      <label className="wide">
        Objetivos
        <textarea rows={2} maxLength={600} value={f.goals} onChange={set('goals')} />
      </label>
      <label className="wide">
        Antecedentes (lesiones, cirugías, historia deportiva)
        <textarea rows={2} maxLength={1000} value={f.historyNotes} onChange={set('historyNotes')} />
      </label>
      <label className="wide">
        Limitaciones y preferencias para programar
        <textarea rows={2} maxLength={600} value={f.constraintsNotes} onChange={set('constraintsNotes')} />
      </label>
      {msg && <Message error={msg.error}>{msg.text}</Message>}
      <div className="sticky-actions">
        {initial.updatedAt && (
          <span className="small muted">Última edición: {dateLabel(initial.updatedAt.slice(0, 10))}</span>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar perfil'}
        </button>
      </div>
    </form>
  );
}
