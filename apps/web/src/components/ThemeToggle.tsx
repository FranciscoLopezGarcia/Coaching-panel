import { useState } from 'react';
import { currentTheme, setTheme, type Theme } from '../theme';

/** Botón para alternar modo claro / oscuro. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setT] = useState<Theme>(currentTheme());
  const next: Theme = theme === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      className={className ?? 'theme-toggle'}
      aria-label={`Cambiar a modo ${next === 'light' ? 'claro' : 'oscuro'}`}
      title={`Cambiar a modo ${next === 'light' ? 'claro' : 'oscuro'}`}
      onClick={() => {
        setTheme(next);
        setT(next);
      }}
    >
      <span aria-hidden="true">{theme === 'light' ? '☾' : '☼'}</span>
      {theme === 'light' ? ' Oscuro' : ' Claro'}
    </button>
  );
}
