import { useEffect, useState } from 'react';
import { readSearch, updateSearch } from '../workspace/ui';
import type { Mode, Scale, Source } from './types';

/**
 * Estado de la pantalla en la URL (se comparte y se conserva al recargar): fuente, escala, métricas elegidas para comparar y vista
 * (por período / por bloque) de cada familia.
 */
export interface AnalysisState {
  source: Source;
  scale: Scale;
  sel: string[];
  block: string;
  /** Comparativa en conjunto abierta. */
  compare: boolean;
  setCompare: (open: boolean) => void;
  mode: (family: string) => Mode;
  setSource: (s: Source) => void;
  setScale: (s: Scale) => void;
  setBlock: (b: string) => void;
  setMode: (family: string, m: Mode) => void;
  toggle: (ids: string[], on?: boolean) => void;
  clear: () => void;
}

const SOURCES: Source[] = ['real', 'plan', 'ambos'];

export function useAnalysisState(): AnalysisState {
  const [, force] = useState(0);
  useEffect(() => {
    const on = () => force((n) => n + 1);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const q = readSearch();
  const src = q.get('src') as Source | null;
  const sel = (q.get('sel') ?? '').split(',').filter(Boolean);
  const set = (v: Record<string, string | null>) => updateSearch(v, true);
  return {
    source: src && SOURCES.includes(src) ? src : 'real',
    scale: q.get('scale') === 'session' ? 'session' : 'week',
    sel,
    block: q.get('ablock') ?? '',
    compare: q.get('cmp') === '1',
    setCompare: (open) => set({ cmp: open ? '1' : null }),
    mode: (f) => (q.get(`m_${f}`) === 'bloque' ? 'bloque' : 'periodo'),
    setSource: (s) => set({ src: s === 'real' ? null : s }),
    setScale: (s) => set({ scale: s === 'week' ? null : s }),
    setBlock: (b) => set({ ablock: b || null }),
    setMode: (f, m) => set({ [`m_${f}`]: m === 'periodo' ? null : m }),
    toggle: (ids, on) => {
      const cur = new Set(sel);
      const all = ids.every((i) => cur.has(i));
      const turnOn = on ?? !all;
      for (const i of ids) {
        if (turnOn) cur.add(i);
        else cur.delete(i);
      }
      set({ sel: cur.size ? [...cur].join(',') : null });
    },
    clear: () => set({ sel: null }),
  };
}
