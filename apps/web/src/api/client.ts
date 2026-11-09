import { guardInstanceWrite } from '../laboratory/guard';
import { trackWrite } from '../laboratory/freshness';
import type {
  AthleteDetail,
  AthleteSummary,
  BlocksData,
  CheckInRow,
  Comparison,
  DashboardData,
  DecisionRow,
  HistoryData,
  LoadData,
  ParamsInput,
  PerformanceData,
  PlanVersionRow,
  SessionRow,
} from '@coaching/contracts';

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (init?.method && init.method !== 'GET') await guardInstanceWrite();
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { error?: string; details?: unknown };
    throw new Error(
      `${b.error ?? `HTTP ${res.status}`}${b.details ? ` — ${JSON.stringify(b.details).slice(0, 200)}` : ''}`,
    );
  }
  if (init?.method && init.method !== 'GET') {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
    } catch {
      /* no body */
    }
    trackWrite(path, input);
  }
  return body as T;
}
const j = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});
const q = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v !== undefined && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  dashboard: () => request<DashboardData>('/api/dashboard'),
  athletes: () => request<AthleteSummary[]>('/api/athletes'),
  athlete: (id: string) => request<AthleteDetail>(`/api/athletes/${id}`),
  evaluate: (id: string, cutoff?: string) =>
    request<unknown>(`/api/athletes/${id}/evaluate`, j('POST', cutoff ? { cutoff } : {})),
  saveParams: (id: string, params: ParamsInput) =>
    request<unknown>(`/api/athletes/${id}/params`, j('PUT', params)),
  decide: (id: string, key: string, coachDecision: DecisionRow['coachDecision'], coachNote: string) =>
    request<DecisionRow>(
      `/api/athletes/${id}/decisions/${encodeURIComponent(key)}`,
      j('PATCH', { coachDecision, coachNote }),
    ),
  versions: (id: string) => request<PlanVersionRow[]>(`/api/athletes/${id}/plan-versions`),
  history: (id: string) => request<HistoryData>(`/api/athletes/${id}/history`),
  commentEvent: (id: string, eventId: string, coachComment: string) =>
    request<unknown>(
      `/api/athletes/${id}/history/${encodeURIComponent(eventId)}`,
      j('PATCH', { coachComment }),
    ),
  blocks: (id: string) => request<BlocksData>(`/api/athletes/${id}/blocks`),
  compare: (id: string, o: { lift: string; a: string; b: string; universe: string; scope: string }) =>
    request<Comparison>(`/api/athletes/${id}/compare${q(o)}`),
  load: (id: string) => request<LoadData>(`/api/athletes/${id}/load`),
  performance: (id: string) => request<PerformanceData>(`/api/athletes/${id}/performance`),
  sessions: (id: string) => request<SessionRow[]>(`/api/athletes/${id}/sessions`),
  checkins: (id: string) => request<CheckInRow[]>(`/api/athletes/${id}/checkins`),
  addCheckin: (id: string, c: Record<string, unknown>) =>
    request<unknown>(`/api/athletes/${id}/checkins`, j('POST', c)),
  feedback: (id: string, sessionKey: string, endFatigue: number | null) =>
    request<unknown>(`/api/athletes/${id}/session-feedback`, j('POST', { sessionKey, endFatigue })),
  review: (id: string, r: { lift: string; date: string; verdict: string; note: string }) =>
    request<unknown>(`/api/athletes/${id}/coach-reviews`, j('POST', r)),
  importPlan: (id: string, body: unknown) =>
    request<{ changed: boolean; note: string }>(`/api/athletes/${id}/plan`, j('POST', body)),
  importSets: (id: string, body: unknown) =>
    request<{ upserted: number }>(`/api/athletes/${id}/sets`, j('POST', body)),
};
