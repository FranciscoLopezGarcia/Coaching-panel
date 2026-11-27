import { useState } from 'react';
import { Message, Modal } from './ui';

export interface ExportableBlock {
  key: string;
  name: string;
  detail: string;
  /** Vacío: sin sesiones, no hay nada para exportar. */
  weeks: { n: number; detail: string }[];
}

/** Elegir bloques o semanas y el formato. El archivo lo arma la API; acá solo se descarga. */
export function BlockExportDialog({
  id,
  blocks,
  current,
  onClose,
}: {
  id: string;
  blocks: ExportableBlock[];
  current: string;
  onClose: () => void;
}) {
  const everything = () => Object.fromEntries(blocks.map((b) => [b.key, b.weeks.map((w) => w.n)]));
  /** Semanas elegidas de cada bloque. */
  const [chosen, setChosen] = useState<Record<string, number[]>>(() =>
    Object.fromEntries(blocks.filter((b) => b.key === current).map((b) => [b.key, b.weeks.map((w) => w.n)])),
  );
  const weeksIn = (key: string) => chosen[key] ?? [];
  const total = blocks.reduce((a, b) => a + weeksIn(b.key).length, 0);
  const [format, setFormat] = useState<'json' | 'csv'>('json');
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const reset = () => {
    setError('');
    setDone('');
  };
  const choose = (key: string, weeks: number[]) => {
    reset();
    setChosen((c) => ({ ...c, [key]: weeks }));
  };
  const download = async () => {
    setBusy(true);
    reset();
    try {
      const p = new URLSearchParams({ format, anon: anon ? '1' : '0' });
      for (const b of blocks) {
        const weeks = weeksIn(b.key);
        if (!weeks.length) continue;
        if (weeks.length === b.weeks.length) p.append('block', b.key);
        else for (const n of weeks) p.append('week', `${n}:${b.key}`);
      }
      const res = await fetch(`/api/athletes/${encodeURIComponent(id)}/block-export?${p}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `No se pudo generar el archivo (HTTP ${res.status})`);
      }
      const file =
        /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `bloques.${format}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      a.click();
      URL.revokeObjectURL(url);
      setDone(`Se descargó ${file}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Exportar bloques o semanas" onClose={onClose}>
      <p className="small muted">
        Lo programado contra lo que registró el atleta, serie por serie, con las notas de ambos.
      </p>
      <fieldset>
        <legend>Qué exportar</legend>
        <div className="row">
          <button
            type="button"
            onClick={() => {
              reset();
              setChosen(everything());
            }}
          >
            Elegir todos
          </button>
          <button
            type="button"
            disabled={!total}
            onClick={() => {
              reset();
              setChosen({});
            }}
          >
            Quitar selección
          </button>
        </div>
        {blocks.map((b) => {
          const mine = weeksIn(b.key);
          const some = mine.length > 0 && mine.length < b.weeks.length;
          return (
            <div className="export-block" key={b.key}>
              <label className="check">
                <input
                  type="checkbox"
                  disabled={!b.weeks.length}
                  checked={!!b.weeks.length && mine.length === b.weeks.length}
                  ref={(el) => {
                    if (el) el.indeterminate = some;
                  }}
                  onChange={(e) => choose(b.key, e.target.checked ? b.weeks.map((w) => w.n) : [])}
                />
                <span>
                  <b>{b.name}</b> · {b.detail}
                  {some && ` · elegidas ${mine.length} de ${b.weeks.length} semanas`}
                </span>
              </label>
              {b.weeks.length > 1 && (
                <div className="export-weeks" role="group" aria-label={`Semanas de ${b.name}`}>
                  {b.weeks.map((w) => (
                    <label className="check" key={w.n}>
                      <input
                        type="checkbox"
                        checked={mine.includes(w.n)}
                        onChange={(e) =>
                          choose(b.key, e.target.checked ? [...mine, w.n] : mine.filter((n) => n !== w.n))
                        }
                      />
                      <span>
                        Semana {w.n} <small>{w.detail}</small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </fieldset>
      <fieldset>
        <legend>Formato</legend>
        <label className="check">
          <input
            type="radio"
            name="export-format"
            checked={format === 'json'}
            onChange={() => {
              reset();
              setFormat('json');
            }}
          />
          <span>
            <b>JSON</b> · completo, para una IA o un modelo: sesiones, resumen y cierre de cada bloque,
            check-ins, competencias, perfil y una guía de lectura.
          </span>
        </label>
        <label className="check">
          <input
            type="radio"
            name="export-format"
            checked={format === 'csv'}
            onChange={() => {
              reset();
              setFormat('csv');
            }}
          />
          <span>
            <b>CSV</b> · una fila por serie, para abrir en una planilla. No incluye resúmenes, perfil,
            competencias ni los check-ins de días sin entreno.
          </span>
        </label>
      </fieldset>
      <label className="check">
        <input
          type="checkbox"
          checked={anon}
          onChange={(e) => {
            reset();
            setAnon(e.target.checked);
          }}
        />
        <span>Ocultar nombre, fecha de nacimiento y lugares de competencia</span>
      </label>
      <p className="small muted">
        Las notas escritas van tal cual y el archivo tiene datos de salud (dolor, molestias, peso). Revisalo
        antes de compartirlo.
      </p>
      {error && <Message error>{error}</Message>}
      {done && <Message>{done}</Message>}
      <div className="sticky-actions">
        <button type="button" onClick={onClose}>
          Cerrar
        </button>
        <button type="button" className="primary" disabled={busy || !total} onClick={download}>
          {busy ? 'Generando…' : `Descargar ${format.toUpperCase()}`}
        </button>
      </div>
    </Modal>
  );
}
