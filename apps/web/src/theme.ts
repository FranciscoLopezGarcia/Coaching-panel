/** Modo claro / oscuro. Por defecto oscuro (base de la marca); la elección queda en este navegador. */
export type Theme = 'light' | 'dark';
const KEY = 'theme';

export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function apply(t: Theme) {
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
}

export function initTheme() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* sin almacenamiento: queda el oscuro */
  }
  apply(saved === 'light' ? 'light' : 'dark');
}

export function setTheme(t: Theme) {
  apply(t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* no se pudo recordar: igual cambia en esta sesión */
  }
}
