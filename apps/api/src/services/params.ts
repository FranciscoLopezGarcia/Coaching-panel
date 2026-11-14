import {
  buildParams,
  validateParams,
  type EngineParams,
  type FamilyMeta,
  type Lift,
  type ParamIssue,
  type ParamOverrides,
  MUSCLE_GROUPS,
  MUSCLE_VIEWS,
  type MuscleConfig,
  type MuscleGroup,
  type MuscleMap,
  type MuscleView,
} from '@coaching/engine';
import type { ParamsInput } from '@coaching/contracts';

/** Parámetros guardados del atleta (JSON parcial) → parámetros efectivos del motor (defaults [propuesta] + overrides). Precedencia: lift > atleta > default. */
export function toOverrides(stored: ParamsInput): ParamOverrides {
  const {
    perLift,
    families: _families,
    muscleView: _view,
    muscleMap: _map,
    intensityCuts: _cuts,
    ...rest
  } = stored;
  void _cuts;
  void _families;
  void _view;
  void _map;
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
/** Vista y mapa propio de músculos del atleta (solo se aceptan grupos conocidos). */
export const muscleConfigOf = (stored: ParamsInput, viewOverride?: string): MuscleConfig => {
  const known = new Set<string>(MUSCLE_GROUPS);
  const map: MuscleMap = {};
  for (const [k, v] of Object.entries(stored.muscleMap ?? {}))
    map[k] = {
      direct: v.direct.filter((g): g is MuscleGroup => known.has(g)),
      indirect: v.indirect.filter((g): g is MuscleGroup => known.has(g)),
    };
  const view = (viewOverride ?? stored.muscleView) as MuscleView | undefined;
  return { view: view && (MUSCLE_VIEWS as readonly string[]).includes(view) ? view : 'fino', map };
};
export const familiesOf = (stored: ParamsInput): Record<string, FamilyMeta> => stored.families ?? {};
export type { Lift };
