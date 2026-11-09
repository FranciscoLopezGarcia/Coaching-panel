import { RANK } from '../priority.js';
import type { RuleId, RuleResult, Status } from '../types.js';

type Base = Pick<RuleResult, 'ruleId' | 'exposureId' | 'status' | 'summary'> &
  Partial<RuleResult> & { rankKey?: keyof typeof RANK };

export function result(b: Base): RuleResult {
  const { rankKey, ...rest } = b;
  return {
    evidence: [],
    missing: [],
    alternatives: [],
    proposal: '',
    reviewWhen: '',
    sufficiency: 'insuficiente',
    evidenceItems: [],
    facts: [],
    dataUntil: '',
    support: [],
    isPrincipal: false,
    rank: RANK[rankKey ?? (b.status as Status)],
    ...rest,
  } as RuleResult;
}
export type { RuleId };

import type { Fact } from '../evidence.js';
export const fact = (
  key: string,
  label: string,
  value: Fact['value'],
  unit?: string,
  source: Fact['source'] = 'regla',
  sourceId?: string,
): Fact => ({ key, label, value, ...(unit ? { unit } : {}), source, ...(sourceId ? { sourceId } : {}) });
