import { useEffect, useState } from 'react';
import { get, send } from './api';
import { Message } from './ui';

export const VIEW_LABEL: Record<string, string> = {
  completo: 'Carga (kg) y RPE',
  solo_rpe: 'Solo RPE (sin kg ni %)',
  solo_carga: 'Solo carga (sin RPE)',
  rpe_porcentaje: 'RPE y % del RM (sin kg)',
};

/** Acceso del atleta al portal (email + contraseña que asigna el coach) y qué ve por defecto de cada serie. */
export function AthleteAccess({ id }: { id: string }) {
  const [account, setAccount] = useState<{ email: string } | null | undefined>(undefined);
  const [modes, setModes] = useState<string[]>([]);
  const [def, setDef] = useState('completo');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const a = await get<{ account: { email: string } | null }>(id, 'account');
    setAccount(a.account);
    if (a.account) setEmail(a.account.email);
    const v = await get<{ modes: string[]; settings: Record<string, string> }>(id, 'view-settings');
    setModes(v.modes);
    setDef(v.settings['*'] ?? 'completo');
  };
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, [id]);
  return (
    <section className="access">
      <h3>Acceso del atleta al portal</h3>
      <p className="small muted">
        Asignale un mail y una contraseña. Con eso entra desde el celular en{' '}
        <code>{window.location.origin}/#/atleta</code> y ve su Inicio, sus entrenos y registra sus series.
      </p>
      {error && <Message error>{error}</Message>}
      {msg && <Message>{msg}</Message>}
      <p className={`access-state ${account ? 'on' : ''}`}>
        {account === undefined
          ? 'Cargando…'
          : account
            ? `Acceso activo · ${account.email}`
            : 'Todavía no tiene acceso al portal.'}
      </p>
      <p className="small">
        Link para el atleta: <code>{window.location.origin}/#/atleta</code>{' '}
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(`${window.location.origin}/#/atleta`)
              .then(() => setMsg('Link copiado.'))
          }
        >
          Copiar
        </button>
      </p>
      <form
        className="form-grid compact"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setMsg('');
          try {
            await send(id, 'account', { email, password }, 'PUT');
            setPassword('');
            setMsg(
              account
                ? 'Contraseña actualizada. Las sesiones abiertas del atleta se cerraron.'
                : 'Cuenta creada.',
            );
            await load();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email del atleta
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {account ? 'Nueva contraseña' : 'Contraseña'} (mín. 6)
          <input
            type="text"
            required
            minLength={6}
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            setPassword(
              Array.from(
                crypto.getRandomValues(new Uint8Array(8)),
                (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31],
              ).join(''),
            )
          }
        >
          Generar contraseña
        </button>
        <button className="primary" disabled={busy}>
          {account ? 'Cambiar email / contraseña' : 'Crear acceso'}
        </button>
      </form>
      {account && (
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm('¿Quitar el acceso de este atleta al portal?')) return;
            await send(id, 'account', {}, 'DELETE');
            setEmail('');
            setMsg('Acceso quitado.');
            await load();
          }}
        >
          Quitar acceso
        </button>
      )}
      <h3>Qué ve el atleta de cada serie (por defecto)</h3>
      <p className="small muted">
        Se puede cambiar entreno por entreno desde «Editar sesión». Lo que no se muestra no llega al
        dispositivo del atleta.
      </p>
      <label>
        Vista por defecto
        <select
          value={def}
          onChange={async (e) => {
            setDef(e.target.value);
            await send(id, 'view-settings', { sessionKey: '*', mode: e.target.value }, 'PUT');
            setMsg('Vista por defecto guardada.');
          }}
        >
          {modes.map((m) => (
            <option key={m} value={m}>
              {VIEW_LABEL[m] ?? m}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
