import { describe, expect, it } from 'vitest';
import { fmtDelta } from './BlockAnalysisPanel';

describe('fmtDelta', () => {
  it('flecha, signo, pp y % sin juicio de valor', () => {
    expect(fmtDelta({ abs: 6, pct: 13.33, unit: 'reps/sem', status: 'ok' })).toContain('↗ +6');
    expect(fmtDelta({ abs: -3, pct: -5.9, unit: 'x', status: 'ok' })).toContain('↘');
    expect(fmtDelta({ abs: 5, pct: null, unit: '%1RM', status: 'ok' })).toContain('pp');
  });
  it('nuevo y no comparable', () => {
    expect(fmtDelta({ abs: 10, pct: null, unit: 'x', status: 'nuevo' })).toContain('nuevo');
    expect(fmtDelta({ abs: null, pct: null, unit: 'x', status: 'no_comparable' })).toBe('No comparable');
  });
});
