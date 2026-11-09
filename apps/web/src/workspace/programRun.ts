import type { ProgramOpFullInput } from '@coaching/contracts';
import { workspaceApi as w, type ProgramResult } from './api';
import type { EditOp } from './sessionText';

/** Traduce una operación de edición a la operación de programación del backend. */
export const toProgramOp = (o: EditOp): ProgramOpFullInput['op'] =>
  o.kind === 'move'
    ? ({
        type: 'move_session',
        sessionKey: o.sessionKey,
        plannedDate: o.date,
        dayNo: o.dayNo,
        weekNo: o.weekNo,
      } as ProgramOpFullInput['op'])
    : o.kind === 'change'
      ? ({
          type: 'change_protocol',
          selection: { setIds: o.setIds },
          change: o.change,
        } as ProgramOpFullInput['op'])
      : o.kind === 'remove'
        ? ({ type: 'remove_sets', selection: { setIds: o.setIds } } as ProgramOpFullInput['op'])
        : ({ type: 'add_sets', sets: o.sets } as ProgramOpFullInput['op']);

export interface RunItem {
  label: string;
  op: ProgramOpFullInput['op'];
}
export interface Reviewed {
  item: RunItem;
  result: ProgramResult;
}
/** Vista previa de cada operación contra el plan vigente (no guarda nada). Si el plan cambió entre medio, se pide volver a revisar. */
export async function previewAll(id: string, items: RunItem[], label: string): Promise<Reviewed[]> {
  const out: Reviewed[] = [];
  for (const item of items) {
    const result = await w.program(id, { mode: 'preview', label, op: item.op });
    if (out.length && result.baseVersionId !== out[0]!.result.baseVersionId)
      throw new Error('La programación cambió mientras revisabas. Volvé a revisar.');
    out.push({ item, result });
  }
  return out;
}
/** Aplica en orden, encadenando la versión base de cada paso. Devuelve cuántas operaciones se aplicaron. */
export async function applyAll(id: string, reviewed: Reviewed[], label: string): Promise<number> {
  let version = reviewed[0]?.result.baseVersionId ?? null;
  let done = 0;
  for (const r of reviewed) {
    const res = await w.program(id, { mode: 'apply', label, op: r.item.op, baseVersionId: version });
    const saved = res.saved as
      (NonNullable<ProgramResult['saved']> & { version?: { id: string } | null }) | null;
    version = saved?.version?.id ?? version;
    done++;
  }
  return done;
}
