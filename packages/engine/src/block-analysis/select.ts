import type { PlannedSet } from '../types.js';
import type { BlockCard, BlockWindow } from './contracts.js';

/** Ordena los bloques del atleta por fecha de inicio (luego por clave, estable) y arma la ventana: actual + hasta 3 anteriores. */
export function orderedBlocks(planned: PlannedSet[], asOf: string): Omit<BlockCard, 'index'>[] {
  const m = new Map<string, { start: string; end: string; weeks: Set<number> }>();
  for (const s of planned) {
    if (s.isWarmup) continue;
    const b = m.get(s.blockKey) ?? { start: s.plannedDate, end: s.plannedDate, weeks: new Set<number>() };
    if (s.plannedDate < b.start) b.start = s.plannedDate;
    if (s.plannedDate > b.end) b.end = s.plannedDate;
    b.weeks.add(s.weekNo);
    m.set(s.blockKey, b);
  }
  return [...m.entries()]
    .map(([blockKey, b]) => ({
      blockKey,
      start: b.start,
      end: b.end,
      weeks: b.weeks.size,
      closed: b.end < asOf,
    }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.blockKey < b.blockKey ? -1 : 1));
}

export function selectRecentBlocks(
  planned: PlannedSet[],
  currentBlockKey: string,
  asOf: string,
): BlockWindow | null {
  const all = orderedBlocks(planned, asOf);
  const i = all.findIndex((b) => b.blockKey === currentBlockKey);
  if (i < 0) return null;
  const blocks = all.slice(Math.max(0, i - 3), i + 1).map((b, index) => ({ ...b, index }));
  return { asOf, currentBlockKey, blocks, partial: blocks.length < 4 };
}
