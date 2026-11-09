/**
 * Sesión del coach. El token vive en este navegador y se agrega solo a cada pedido a /api (salvo los del atleta, que traen el suyo).
 * Un 401 del servidor cierra la sesión y vuelve a la pantalla de ingreso.
 */
const KEY = 'base:coach-token';
export const getCoachToken = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const setCoachToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* sin almacenamiento: dura lo que la pestaña */
  }
};
let installed = false;
export function installCoachAuth() {
  if (installed) return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const isApi = url.startsWith('/api/') && !url.startsWith('/api/me') && !url.startsWith('/api/auth');
    const t = getCoachToken();
    let next = init;
    if (isApi && t) {
      const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!h.has('authorization')) h.set('authorization', `Bearer ${t}`);
      next = { ...init, headers: h };
    }
    const res = await orig(input, next);
    if (isApi && res.status === 401 && !url.startsWith('/api/coach/login')) {
      setCoachToken(null);
      window.dispatchEvent(new Event('coach-auth'));
    }
    return res;
  };
}
export interface CoachSession {
  authRequired: boolean;
  authenticated: boolean;
  email: string | null;
}
export async function loadCoachSession(): Promise<CoachSession> {
  const r = await fetch('/api/coach/session');
  if (!r.ok) throw new Error('No se pudo consultar la sesión del coach.');
  return (await r.json()) as CoachSession;
}
export async function coachLogin(email: string, password: string) {
  const r = await fetch('/api/coach/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!r.ok || !j.token) throw new Error(j.error ?? `Error ${r.status}`);
  setCoachToken(j.token);
}
export async function coachLogout() {
  try {
    await fetch('/api/coach/logout', { method: 'POST' });
  } finally {
    setCoachToken(null);
    window.dispatchEvent(new Event('coach-auth'));
  }
}
