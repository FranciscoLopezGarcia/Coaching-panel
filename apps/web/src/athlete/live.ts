import { useEffect, useRef, useState } from 'react';
import { getToken } from './api';

/**
 * Cambios en vivo. Canal principal: SSE (el servidor avisa en el instante en que el coach guarda algo). Respaldo: se pregunta la
 * revisión cada 4 s y al volver a la pestaña / recuperar conexión. Cualquier diferencia de revisión dispara `onChange`.
 */
export type LiveState = 'live' | 'poll' | 'offline';
export function useLive(onChange: () => void): LiveState {
  const cb = useRef(onChange);
  cb.current = onChange;
  const [state, setState] = useState<LiveState>('poll');
  useEffect(() => {
    let stopped = false;
    let last: number | null = null;
    let ctrl: AbortController | null = null;
    const seen = (rev: number) => {
      if (last !== null && rev !== last) cb.current();
      last = rev;
    };
    const auth = () => {
      const t = getToken();
      return t ? { authorization: `Bearer ${t}` } : undefined;
    };
    const poll = async () => {
      const h = auth();
      if (!h || stopped) return;
      try {
        const r = await fetch('/api/me/rev', { headers: h, cache: 'no-store' });
        if (r.ok) {
          seen(((await r.json()) as { rev: number }).rev);
          setState((s) => (s === 'offline' ? 'poll' : s));
        }
      } catch {
        setState('offline');
      }
    };
    const open = async () => {
      while (!stopped) {
        const h = auth();
        if (!h) return;
        ctrl = new AbortController();
        try {
          const r = await fetch('/api/me/events', { headers: h, signal: ctrl.signal, cache: 'no-store' });
          if (!r.ok || !r.body) throw new Error('sin canal');
          setState('live');
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i: number;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const m = /data: (\{.*\})/.exec(buf.slice(0, i));
              buf = buf.slice(i + 2);
              if (m) seen((JSON.parse(m[1] as string) as { rev: number }).rev);
            }
          }
        } catch {
          /* cortado: se reintenta abajo; mientras tanto el sondeo cubre */
        }
        if (stopped) return;
        setState((s) => (s === 'live' ? 'poll' : s));
        await new Promise((res) => setTimeout(res, 1500));
      }
    };
    void poll();
    void open();
    const timer = setInterval(() => void poll(), 4000);
    const wake = () => document.visibilityState !== 'hidden' && void poll();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    return () => {
      stopped = true;
      ctrl?.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
    };
  }, []);
  return state;
}
