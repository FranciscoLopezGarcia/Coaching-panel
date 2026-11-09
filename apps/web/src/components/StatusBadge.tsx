import { statusInfo } from '../labels';

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = statusInfo(status);
  return <span className={`badge tone-${s.tone}`}>{s.label}</span>;
}
