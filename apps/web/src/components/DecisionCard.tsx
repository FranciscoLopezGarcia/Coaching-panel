import { useState } from 'react';
import type { DecisionRow } from '@coaching/contracts';
import { RULE_NAMES } from '../labels';
import { StatusBadge } from './StatusBadge';

interface Props {
  row: DecisionRow;
  onDecide: (key: string, decision: DecisionRow['coachDecision'], note: string) => Promise<void>;
  compact?: boolean;
}

/** Una propuesta del motor con su evidencia, límites y decisión del coach. Mostrar evidencia + período + motivos es obligatorio. */
export function DecisionCard({ row, onDecide, compact }: Props) {
  const [note, setNote] = useState(row.coachNote);
  const [busy, setBusy] = useState(false);
  const decide = async (d: DecisionRow['coachDecision']) => {
    setBusy(true);
    try {
      await onDecide(row.key, d, note);
    } finally {
      setBusy(false);
    }
  };
  const expired = row.validity === 'expirada';
  return (
    <article className={`card${expired ? ' expired' : ''}`}>
      <div className="card-head">
        <StatusBadge status={row.status} />
        <span className="chip">{RULE_NAMES[row.ruleId] ?? row.ruleId}</span>
        {row.exposureId && <span className="chip">exposición {row.exposureId}</span>}
        <span className="chip">evidencia: {row.sufficiency}</span>
        {expired && <span className="chip">expirada</span>}
      </div>
      <p className="summary">{row.summary}</p>
      {row.proposal && (
        <p className="proposal">
          <strong>Propuesta (no se aplica sola):</strong> {row.proposal}
        </p>
      )}
      <p className="muted small">
        Datos hasta {row.dataUntil || '—'} · evaluado al corte {row.evaluatedOn} · {row.rulesVersion} ·
        recuperación: {row.readiness}
      </p>
      {!compact && (
        <>
          <Section title="Evidencia" items={row.evidence} />
          <Section title="Faltantes y límites" items={row.missing} />
          <Section title="Alternativas / señales secundarias" items={row.alternatives} />
          {row.reviewWhen && <p className="small">Revisar: {row.reviewWhen}</p>}
          <details>
            <summary>Parámetros y soporte</summary>
            <p className="small">{row.paramsText}</p>
            <p className="small">Sesiones de soporte: {row.support.join('; ') || '—'}</p>
          </details>
        </>
      )}
      {expired ? (
        <p className="muted small">
          {row.expiryReason} · decisión del coach: {row.coachDecision}
        </p>
      ) : (
        <div className="decision">
          <input
            placeholder="Motivo (opcional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Motivo de la decisión"
          />
          {(['Aprobada', 'Descartada', 'Atendida', 'Pendiente'] as const).map((d) => (
            <button
              key={d}
              disabled={busy}
              className={row.coachDecision === d ? 'on' : ''}
              onClick={() => decide(d)}
            >
              {d}
            </button>
          ))}
          {row.decidedOn && <span className="muted small">decidido el {row.decidedOn}</span>}
        </div>
      )}
    </article>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <details open={title === 'Evidencia' ? false : true}>
      <summary>
        {title} ({items.length})
      </summary>
      <ul>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </details>
  );
}
