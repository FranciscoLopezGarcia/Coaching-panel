const prefix = 'base:evaluation-pending:';
export const pendingEvaluation = (id: string) => {
  try {
    return localStorage.getItem(prefix + id);
  } catch {
    return null;
  }
};
export function recordMutation(id: string, evaluated: boolean) {
  try {
    if (evaluated) localStorage.removeItem(prefix + id);
    else localStorage.setItem(prefix + id, new Date().toISOString());
  } catch {
    /* El servidor ya guardó; el almacenamiento local no debe convertirlo en un error. */
  }
  window.dispatchEvent(new Event('base-data-changed'));
}
export function trackWrite(path: string, body: Record<string, unknown>) {
  const m = /\/api\/athletes\/([^/]+)\/([^/?]+)/.exec(path);
  if (!m) return;
  const id = decodeURIComponent(m[1]!);
  const op = m[2];
  if (op === 'evaluate') recordMutation(id, true);
  else if (['sets', 'checkins', 'session-feedback', 'coach-reviews', 'params', 'references'].includes(op!))
    recordMutation(id, false);
  else if (
    (op === 'plan' && body.status !== 'borrador') ||
    (op === 'program' && body.mode === 'apply') ||
    (op === 'imports' && body.mode === 'apply')
  )
    recordMutation(id, false);
}
