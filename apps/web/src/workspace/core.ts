import { get, query } from './api';

/** Adaptador de presentación de GET /core; no calcula ni combina métricas. */
export interface CoreValue {
  value: number | null;
  unit: string;
  status: 'available' | 'partial' | 'unavailable';
  missing: string[];
  warnings: string[];
}
export interface Bundle {
  nl: CoreValue;
  sets: CoreValue;
  tonnage: CoreValue;
  si: { rts: { total: CoreValue; model: string } };
  e1rm: { curve: CoreValue; prg: CoreValue };
}
export interface PatternVolume {
  convention: { version: string };
  rows: { pattern: string; sets: number; nl: number; tonnage: number | null; exercises: string[] }[];
  unmappedExercises: string[];
  warnings: string[];
}
export interface BetweenSets {
  version: string;
  status: 'available' | 'partial' | 'unavailable';
  reasons: string[];
  sets: {
    setNo: number;
    kg: number | null;
    reps: number | null;
    rpe: number | null;
    target: { reps: number | null; repsMax: number | null; rpe: number | null; kg: number | null } | null;
    rpeVsTarget: number | null;
    rpeVsPrevious: number | null;
    repsVsTarget: { position: string; delta: number } | null;
  }[];
  rpe: { first: number; last: number; pattern: string } | null;
  reps: {
    first: number;
    last: number;
    constantLoad: boolean;
    pattern: string;
    lostBestToLast: number;
  } | null;
  notes: string[];
}
export interface CoreSessions {
  version: string;
  sessions: {
    key: string;
    sessionKey: string;
    date: string;
    totals: Bundle;
    patterns?: PatternVolume;
    exercises: {
      exerciseName: string;
      variantKey: string;
      lift: string | null;
      pattern?: string | null;
      metrics: Bundle;
      fatigueBetweenSets?: BetweenSets;
    }[];
    muscles: {
      convention?: { version: string; directWeight: number; indirectWeight: number };
      rows: {
        muscle: string;
        directSets: number;
        indirectSets: number;
        equivalentSets: number;
        equivalentReps?: number;
        equivalentTonnage?: number | null;
      }[];
      warnings: string[];
      unmappedExercises: string[];
    };
  }[];
  weeks?: {
    week: { from: string; to: string; partial: boolean };
    totals: Bundle;
    patterns?: PatternVolume;
    muscles: CoreSessions['sessions'][number]['muscles'];
  }[];
  warnings: string[];
}
export const fetchCoreSessions = (id: string, from: string, to: string, cutoff: string) =>
  get<CoreSessions>(id, 'core' + query({ from, to, cutoff, view: 'sessions' }));
