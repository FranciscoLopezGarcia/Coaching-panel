import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';
import { HomeScreen } from './Home';
import { Login } from './Login';
import { Picker } from './Picker';
import { Workout } from './Workout';
import './athlete.css';

const go = (hash: string) => {
  window.location.hash = hash;
};

/** Portal del atleta (ruta #/atleta): login, home, selector de entrenos y pantalla de entreno. Pensado para el celular. */
export function AthleteApp({ hash }: { hash: string }) {
  const [token, setTok] = useState(getToken());
  useEffect(() => {
    const on = () => setTok(getToken());
    window.addEventListener('ath-auth', on);
    return () => window.removeEventListener('ath-auth', on);
  }, []);
  if (!token) return <Login onIn={() => setTok(getToken())} />;
  const m = /^#\/atleta\/entreno\/(.+)$/.exec(hash);
  const tab = m ? 'workout' : hash.startsWith('#/atleta/entrenos') ? 'picker' : 'home';
  return (
    <div className="ath">
      <div className="ath-body">
        {tab === 'home' && <HomeScreen go={go} />}
        {tab === 'picker' && <Picker go={go} />}
        {tab === 'workout' && m && (
          <Workout key={m[1]} keyName={decodeURIComponent(m[1] as string)} go={go} />
        )}
      </div>
      <nav className="ath-nav" aria-label="Navegación del atleta">
        <a className={tab === 'home' ? 'on' : ''} href="#/atleta">
          <span>⌂</span>Inicio
        </a>
        <a className={tab === 'picker' ? 'on' : ''} href="#/atleta/entrenos">
          <span>☰</span>Entrenos
        </a>
        <button
          onClick={async () => {
            try {
              await api.logout();
            } catch {
              /* igual se cierra acá */
            }
            setToken(null);
            setTok(null);
            go('#/atleta');
          }}
        >
          <span>⎋</span>Salir
        </button>
      </nav>
    </div>
  );
}
