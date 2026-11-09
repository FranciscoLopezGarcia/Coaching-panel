import {
  buildParams,
  validateParams,
  type EngineParams,
  type FamilyMeta,
  type Lift,
  type ParamIssue,
  type ParamOverrides,
} from '@coaching/engine';
import type { ParamsInput } from '@coaching/contracts';

/** Parámetros guardados del atleta (JSON parcial) → parámetros efectivos del motor (defaults [propuesta] + overrides). Precedencia: lift > atleta > default. */
export function toOverrides(stored: ParamsInput): ParamOverrides {
  const { perLift, families: _families, ...rest } = stored;
  void _families;
  const o: ParamOverrides = { ...rest };
  if (perLift) {
    o.perLift = {};
    for (const l of ['SQ', 'BP', 'DL'] as const) {
      const c = perLift[l];
      if (!c) continue;
      o.perLift[l] = {
        minChangePct: c.minChangePct ?? null,
        minChangeKg: c.minChangeKg ?? null,
        loadLimitKg: c.loadLimitKg ?? null,
        prReps: c.prReps ?? null,
        explorationApproved: c.explorationApproved ?? false,
        stepKg: c.stepKg ?? null,
        prRpe: c.prRpe ?? null,
        allowSingleMax: c.allowSingleMax ?? null,
        prExtrapolationReps: c.prExtrapolationReps ?? null,
        prEffortGap: c.prEffortGap ?? null,
      };
    }
  }
  return o;
}

export const toEngineParams = (stored: ParamsInput): EngineParams => buildParams(toOverrides(stored));
export const validateStored = (stored: ParamsInput): ParamIssue[] => validateParams(toOverrides(stored));
export const familiesOf = (stored: ParamsInput): Record<string, FamilyMeta> => stored.families ?? {};
export type { Lift };
