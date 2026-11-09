import type {
  AthleteStateData,
  MacroSummary,
  MesoSummary,
  MetricDefinition,
  MetricResult,
  Preview,
  ProgramOpFullInput,
  Intervention,
  InterventionFollowUp,
  Explanation,
  PeriodComparison,
  StrengthReference,
  ImportPlanInput,
} from '@coaching/contracts';
import { request } from '../api/client';
export type Macro = Pick<MacroSummary, 'id' | 'name' | 'status' | 'startDate' | 'endDate' | 'objective'>;
export interface Meso {
  blockKey: string;
  macroId: string | null;
  name: string;
  startDate: string | null;
  endDate: string | null;
  objective: string | null;
}
export interface Weekly {
  week: { from: string; to: string; partial: boolean; future: boolean };
  movement: { exerciseName: string; variantKey: string; lift: string | null };
  planned: {
    sets: number;
    nl: number;
    tonnage: number | null;
    frequency: number;
    siTotal: number | null;
  } | null;
  actual: Record<string, MetricResult>;
}
export interface Series {
  performance: {
    methodId: string;
    methodVersion: string;
    exercise: string;
    variantKey: string;
    points: { date: string; value: number; setId: string }[];
  }[];
  notes: string[];
}
export interface MuscleData {
  convention: { version: string; directWeight: number; indirectWeight: number; note: string };
  rows: {
    week: { from: string; to: string; partial: boolean };
    muscle: string;
    directSets: number;
    indirectSets: number;
    equivalentSets: number;
    exercises: string[];
  }[];
  unmappedExercises: string[];
  warnings: string[];
}
export interface Evidence {
  explanation: Explanation | null;
  records: {
    ref: { kind: string; id: string; date?: string };
    sets?: {
      planned: ImportPlanInput['sets'][number];
      actual: { kg: number | null; reps: number | null; rpe: number | null } | null;
    }[];
    checkin?: unknown;
    review?: unknown;
  }[];
}
export interface ExposureDetail {
  exposureId: string;
  exercise: string;
  comparability: { segments: number; currentSegmentExposures: number; breaks: unknown[] };
  identity: { source: string; note: string };
  sessions: {
    sessionKey: string;
    date: string;
    variantKey: string;
    sets: {
      setNo: number;
      planned: {
        reps: number;
        kg: number | null;
        targetRpe: number | null;
        protocol: ImportPlanInput['sets'][number]['protocol'];
      };
      actual: {
        plannedSetId: string;
        status: string;
        kg: number | null;
        reps: number | null;
        rpe: number | null;
        performedOn: string | null;
        pain: number | null;
      } | null;
    }[];
  }[];
}
export interface ProgramResult {
  mode: string;
  baseVersionId: string | null;
  warnings: string[];
  preview: Preview;
  saved: { changed: boolean; note: string } | null;
}
export const endpoint = (id: string, path: string) => `/api/athletes/${encodeURIComponent(id)}/${path}`;
export const query = (values: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => {
    if (v !== undefined && v !== '') p.set(k, v);
  });
  return '?' + p.toString();
};
export const get = <T>(id: string, path: string) => request<T>(endpoint(id, path));
export const send = <T>(id: string, path: string, body: unknown, method = 'POST') =>
  request<T>(endpoint(id, path), { method, body: JSON.stringify(body) });
export const workspaceApi = {
  state: (id: string) => get<AthleteStateData>(id, 'state'),
  macros: (id: string) => get<Macro[]>(id, 'macros'),
  active: (id: string) =>
    get<(MacroSummary & { selection?: string; otherActiveMacros?: { id: string; name: string }[] }) | null>(
      id,
      'macros/active',
    ),
  macro: (id: string, key: string) => get<MacroSummary>(id, `macros/${encodeURIComponent(key)}`),
  mesos: (id: string) => get<Meso[]>(id, 'mesos'),
  meso: (id: string, key: string) => get<MesoSummary>(id, `mesos/${encodeURIComponent(key)}`),
  weekly: (id: string, from: string, to: string) => get<Weekly[]>(id, 'weekly' + query({ from, to })),
  muscles: (id: string, from: string, to: string) =>
    get<MuscleData>(id, 'weekly-muscles' + query({ from, to })),
  series: (id: string, from: string, to: string) => get<Series>(id, 'series' + query({ from, to })),
  catalog: () => request<{ version: string; metrics: MetricDefinition[] }>('/api/catalog'),
  evidence: (id: string, key: string) =>
    get<Evidence>(id, `recommendations/${encodeURIComponent(key)}/evidence`),
  exposure: (id: string, key: string) => get<ExposureDetail>(id, `exposures/${encodeURIComponent(key)}`),
  program: (id: string, body: ProgramOpFullInput) => send<ProgramResult>(id, 'program', body),
  interventions: (id: string) =>
    get<{ intervention: Intervention; followUp: InterventionFollowUp | null }[]>(id, 'interventions'),
  period: (id: string, values: Record<string, string>) =>
    get<PeriodComparison>(id, 'period-compare' + query(values)),
  references: (id: string) => get<StrengthReference[]>(id, 'references'),
};
