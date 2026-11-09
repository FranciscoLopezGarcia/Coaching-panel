import type { InstanceData } from '@coaching/contracts';
import { request } from './api/client';
import { useLoad } from './hooks';
import { configureInstance } from './laboratory/environment';
import { instanceLabel, laboratory } from './laboratory/environment';
import { useEffect, useState } from 'react';
import { AthletePage } from './pages/AthletePage';
import { Dashboard } from './pages/Dashboard';
import { AthleteApp } from './athlete/AthleteApp';
import { CoachLogin } from './coach/CoachLogin';
import { coachLogout, installCoachAuth, loadCoachSession, type CoachSession } from './coach/auth';

installCoachAuth();
function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}
function useCoachSession() {
  const [s, setS] = useState<CoachSession | null>(null);
  const [error, setError] = useState('');
  const refresh = () =>
    loadCoachSession()
      .then((x) => {
        setS(x);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void refresh();
    window.addEventListener('coach-auth', refresh);
    return () => window.removeEventListener('coach-auth', refresh);
  }, []);
  return { s, error, refresh };
}
export function App() {
  const hash0 = useHashRoute();
  const coach = useCoachSession();
  if (!hash0.startsWith('#/atleta')) {
    if (coach.error) return <p className="error">{coach.error}</p>;
    if (!coach.s) return <p className="muted">Cargando…</p>;
    if (coach.s.authRequired && !coach.s.authenticated)
      return <CoachLogin onDone={() => void coach.refresh()} />;
  }
  return <Panel auth={coach.s} />;
}
function Panel({ auth }: { auth: CoachSession | null }) {
  const instance = useLoad(async () => {
    const data = await request<InstanceData>('/api/instance');
    configureInstance(data);
    return data;
  }, []);
  const hash = useHashRoute();
  if (hash.startsWith('#/atleta')) return <AthleteApp hash={hash} />;
  const match = /^#\/athlete\/([^?]+)/.exec(hash);
  let id: string | null = null;
  try {
    id = match ? decodeURIComponent(match[1]!) : null;
  } catch {
    /* URL inválida: inicio */
  }
  return (
    <div className="app-shell">
      <a
        className="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Saltar al contenido
      </a>
      <aside className="sidebar">
        <a href="#/" className="brand">
          <span className="brand-symbol">╋</span> BASE<span className="brand-sub">STRENGTH COACHING</span>
        </a>
        <div className="nav-caption">ESPACIO DEL COACH</div>
        <nav aria-label="Navegación principal">
          <a className={!id && !hash.includes('focus=plantel') ? 'active' : ''} href="#/">
            <span>▦</span>Inicio del coach
          </a>
          <a className={id || hash.includes('focus=plantel') ? 'active' : ''} href="#/?focus=plantel">
            <span>♙</span>Atletas
          </a>
        </nav>
        <div className="sidebar-foot">
          <span className="local-dot" /> {auth?.authRequired ? 'En línea' : 'Entorno local'}
          <p>
            El motor informa.
            <br />
            Vos decidís.
          </p>
          {auth?.authRequired ? (
            <button type="button" onClick={() => void coachLogout()}>
              Salir ({auth.email})
            </button>
          ) : (
            <small>Sin autenticación (local)</small>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            Planificación y seguimiento <span className="muted">/ Powerlifting</span>
          </span>
          <span className="local-label">LOCAL · COACH</span>
        </header>
        <div className={laboratory ? 'instance-banner laboratory' : 'instance-banner'} role="status">
          {instanceLabel}
          {laboratory && <span> · No cargues datos personales en esta instancia.</span>}
        </div>
        <main id="main" tabIndex={-1}>
          {instance.loading ? (
            <p role="status">Verificando instancia…</p>
          ) : instance.error ? (
            <div className="message error" role="alert">
              {instance.error}
              <button onClick={instance.reload}>Reintentar</button>
            </div>
          ) : id ? (
            <AthletePage key={id} id={id} />
          ) : (
            <Dashboard />
          )}
        </main>
        <footer className="app-footer">
          BASE / Fuerza con contexto <span>Reglas operativas propuestas · Decisiones a cargo del coach</span>
        </footer>
      </div>
    </div>
  );
}
