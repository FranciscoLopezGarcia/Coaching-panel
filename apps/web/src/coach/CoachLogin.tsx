import { useState } from 'react';
import { coachLogin } from './auth';

export function CoachLogin({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="coach-login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await coachLogin(email, password);
            onDone();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand-symbol">╋</div>
        <h1>BASE · Coach</h1>
        <p className="muted">Ingresá con tu email y contraseña de coach.</p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="small muted">
          ¿Sos atleta? Entrá por <a href="#/atleta">/#/atleta</a>.
        </p>
      </form>
    </main>
  );
}
