import { useState } from 'react';
import { today } from './ui';

/** Resumen de solo lectura del atleta para pegar en una IA o archivar (lo arma la API con los mismos números que la app). */
export function ExportPanel({ id, name }: { id: string; name: string }) {
  const [asOf, setAsOf] = useState(today());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const fetchText = async () => {
    const res = await fetch(`/api/athletes/${id}/export?asOf=${asOf}&format=md`);
    if (!res.ok) throw new Error(`No se pudo generar el resumen (HTTP ${res.status})`);
    return res.text();
  };
  const run = async (kind: 'copy' | 'file') => {
    setBusy(true);
    setMsg('');
    try {
      const text = await fetchText();
      if (kind === 'copy') {
        await navigator.clipboard.writeText(text);
        setMsg('Resumen copiado. Pegalo en tu IA.');
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `resumen-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${asOf}.md`;
        a.click();
        URL.revokeObjectURL(url);
        setMsg('Archivo descargado.');
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="export-panel">
      <h3>Exportar para una IA</h3>
      <p className="small muted">
        Arma un resumen en texto (e1RM, bloques, zonas, competencias y check-ins) con los mismos números de la
        app. No incluye accesos ni contraseñas. Revisalo antes de compartirlo: tiene datos del atleta.
      </p>
      <label>
        Al corte
        <input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
      </label>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => run('copy')}>
          Copiar resumen
        </button>
        <button type="button" disabled={busy} onClick={() => run('file')}>
          Descargar .md
        </button>
      </div>
      {msg && <p className="small">{msg}</p>}
    </section>
  );
}
