/** Cliente del portal del atleta. El token vive en este navegador (localStorage) y se manda como Bearer. */
const KEY = 'base:athlete-token';
export const getToken = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const setToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* sin almacenamiento: la sesión dura mientras la pestaña esté abierta */
  }
};
export class AuthError extends Error {}
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const t = getToken();
  const r = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (r.status === 401 && path !== '/api/auth/login') {
    setToken(null);
    window.dispatchEvent(new Event('ath-auth'));
    throw new AuthError(j.error ?? 'Sesión vencida');
  }
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j as T;
}
export const api = {
  login: (email: string, password: string) =>
    call<{ token: string; athlete: { id: string; name: string } }>('POST', '/api/auth/login', {
      email,
      password,
    }),
  logout: () => call('POST', '/api/auth/logout', {}),
  home: () => call<Home>('GET', '/api/me/home'),
  plan: () => call<PlanData>('GET', '/api/me/plan'),
  next: () => call<{ next: SessionMeta | null }>('GET', '/api/me/next'),
  session: (key: string) => call<SessionData>('GET', `/api/me/sessions/${encodeURIComponent(key)}`),
  /** Registra una serie. Sin conexión no se pierde: queda en el teléfono y se reenvía sola (ver `flushOutbox`). */
  logSet: (b: SetBody) => queueSet(b),
  note: (sessionKey: string, exerciseName: string, note: string) =>
    call('PUT', '/api/me/notes', { sessionKey, exerciseName, note }),
  checkin: (b: { sleep: number; energy: number; motivation: number; stress: number; pain: number }) =>
    call('POST', '/api/me/checkins', b),
  finish: (key: string, endFatigue: number | null, note: string) =>
    call('POST', `/api/me/sessions/${encodeURIComponent(key)}/finish`, {
      endFatigue,
      note: note || undefined,
    }),
};

export interface SessionMeta {
  key: string;
  date: string;
  blockKey: string;
  weekNo: number;
  dayNo: number;
  title: string;
  exercises: string[];
  status: 'done' | 'part' | 'none';
  doneSets: number;
  totalSets: number;
}
export interface BlockInfo {
  key: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  weeks: number;
  objective: string | null;
  currentWeek: number | null;
}
export interface Checkin {
  date: string;
  sleep: number;
  energy: number;
  motivation: number;
  stress: number;
  pain: number;
}
export interface Home {
  athlete: { id: string; name: string };
  today: string;
  session: SessionMeta | null;
  todaysCount: number;
  next: SessionMeta | null;
  block: BlockInfo | null;
  trac: { doneToday: boolean; today: Checkin | null; recent: Checkin[] };
}
export interface PlanData {
  today: string;
  next: SessionMeta | null;
  blocks: (BlockInfo & { weeksList: { weekNo: number; sessions: SessionMeta[] }[] })[];
}
export interface SetView {
  id: string;
  setNo: number;
  kind: 'warmup' | 'top' | 'backoff' | 'work';
  reps: number;
  repsMax: number | null;
  rpe: number | null;
  kg: number | null;
  kgSource: 'fixed' | 'derived' | null;
  pct: number | null;
  note: string | null;
  tempo: string | null;
  pauseSec: number | null;
  actual: { kg: number | null; reps: number | null; rpe: number | null; status: string } | null;
  goal: { reps: number | null; kg: number | null } | null;
}
export interface SessionData extends Omit<SessionMeta, 'exercises'> {
  mode: 'completo' | 'solo_rpe' | 'solo_carga' | 'rpe_porcentaje';
  block: BlockInfo;
  endFatigue: number | null;
  exercises: {
    name: string;
    lift: string | null;
    priority: number | null;
    mode: 'completo' | 'solo_rpe' | 'solo_carga' | 'rpe_porcentaje';
    coachNotes: string[];
    goalText: string;
    athleteNote: string;
    sets: SetView[];
    previous: { date: string; sets: { kg: number | null; reps: number | null; rpe: number | null }[] } | null;
  }[];
}

/* ---------------- serie → servidor, sin perder nada ---------------- */
export interface SetBody {
  plannedSetId: string;
  status: 'done' | 'pending' | 'skipped';
  kg: number | null;
  reps: number | null;
  rpe: number | null;
}
const OUT = 'base:athlete-outbox';
const readOut = (): Record<string, SetBody> => {
  try {
    return JSON.parse(localStorage.getItem(OUT) ?? '{}') as Record<string, SetBody>;
  } catch {
    return {};
  }
};
const writeOut = (o: Record<string, SetBody>) => {
  try {
    localStorage.setItem(OUT, JSON.stringify(o));
  } catch {
    /* sin almacenamiento: queda solo en memoria de la pestaña */
  }
};
let memory: Record<string, SetBody> = {};
export const pendingCount = () => Object.keys({ ...readOut(), ...memory }).length;
let flushing = false;
/** Manda lo pendiente (la última versión de cada serie). Un rechazo definitivo (serie que ya no existe) descarta esa serie. */
export async function flushOutbox(): Promise<{ sent: number; dropped: number; left: number }> {
  if (flushing) return { sent: 0, dropped: 0, left: pendingCount() };
  flushing = true;
  let sent = 0;
  let dropped = 0;
  try {
    for (const [id, body] of Object.entries({ ...readOut(), ...memory })) {
      try {
        await call('PUT', '/api/me/sets', body);
        sent++;
      } catch (e) {
        if (e instanceof AuthError) break;
        if (e instanceof TypeError || /^Error 5/.test((e as Error).message)) break; // red / servidor caído: se reintenta
        dropped++; // el servidor la rechazó (p. ej. el coach cambió esa serie): no tiene sentido reintentar
      }
      // solo se borra si no llegó una versión más nueva mientras tanto
      const now = { ...readOut(), ...memory };
      if (JSON.stringify(now[id]) === JSON.stringify(body)) {
        delete memory[id];
        const o = readOut();
        delete o[id];
        writeOut(o);
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, dropped, left: pendingCount() };
}
async function queueSet(b: SetBody) {
  memory[b.plannedSetId] = b;
  writeOut({ ...readOut(), [b.plannedSetId]: b });
  const r = await flushOutbox();
  return { ok: true, queued: r.left > 0 };
}
export const clearOutboxMemory = () => {
  memory = {};
};
