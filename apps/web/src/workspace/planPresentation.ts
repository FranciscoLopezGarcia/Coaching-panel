import type { SessionRow } from '@coaching/contracts';
/** Conteos de presentación: las aproximaciones y series retiradas no son dosis de trabajo. */
export const workSets = (session: SessionRow) => session.sets.filter((s) => !s.isWarmup && !s.retired);
