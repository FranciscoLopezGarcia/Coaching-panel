import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme } from './theme';
import './fonts/fonts.css';
import './styles.css';
import './experience.css';
import './theme.css';
import './responsive.css';

initTheme();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
