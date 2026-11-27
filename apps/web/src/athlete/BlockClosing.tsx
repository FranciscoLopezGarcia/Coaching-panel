import { useEffect, useState } from 'react';
import type { BlockFeedbackAnswers, LiftClosing } from '@coaching/contracts';
import { api, type Closing } from './api';

type Lift = Closing['lifts'][number];
const LIFT_NAME: Record<Lift, string> = { SQ: 'Sentadilla', BP: 'Banca', DL: 'Peso muerto' };

const emptyLift = (): LiftClosing => ({
  feel: null,
  fatigue: null,
  technique: null,
  discomfort: null,
  discomfortWhere: '',
  note: '',
});
const empty = (): BlockFeedbackAnswers => ({
  general: { fatigue: null, stress: null, sleep: null, motivation: null, satisfaction: null, load: null },
  lifts: {},
  notes: { best: '', hardest: '', next: '', other: '' },
});

/** Escala de un toque. Volver a tocar el número elegido lo deja sin contestar. */
function Scale({
  label,
  low,
  high,
  from = 1,
  value,
  onChange,
}: {
  label: string;
  low: string;
  high: string;
  from?: 0 | 1;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const numbers = Array.from({ length: 11 - from }, (_, i) => i + from);
  return (
    <fieldset className="ath-scale">
      <legend>{label}</legend>
      <div style={{ gridTemplateColumns: `repeat(${numbers.length}, 1fr)` }}>
        {numbers.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            onClick={() => onChange(value === n ? null : n)}
          >
            {n}
          </button>
        ))}
      </div>
      <small>
        <span>{low}</span>
        <span>{high}</span>
      </small>
    </fieldset>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <fieldset className="ath-scale">
      <legend>{label}</legend>
      <div style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(value === v ? null : v)}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Text({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
}) {
  return (
    <label>
      {label}
      <textarea rows={2} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Cierre de bloque: cómo le fue en general y en cada movimiento. Todo es opcional. */
export function BlockClosing({ blockKey, go }: { blockKey: string; go: (hash: string) => void }) {
  const [data, setData] = useState<Closing | null>(null);
  const [v, setV] = useState<BlockFeedbackAnswers>(empty);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  // se carga una sola vez: una actualización en vivo no debe pisar lo que se está escribiendo
  useEffect(() => {
    api
      .closing(blockKey)
      .then((c) => {
        setData(c);
        if (c.feedback) setV(c.feedback.answers);
      })
      .catch((e: Error) => setError(e.message));
  }, [blockKey]);
  if (!data) return error ? <p className="ath-error">{error}</p> : <p className="muted">Cargando…</p>;

  const general = (patch: Partial<BlockFeedbackAnswers['general']>) => {
    setSent(false);
    setV((x) => ({ ...x, general: { ...x.general, ...patch } }));
  };
  const lift = (l: Lift, patch: Partial<LiftClosing>) => {
    setSent(false);
    setV((x) => ({ ...x, lifts: { ...x.lifts, [l]: { ...(x.lifts[l] ?? emptyLift()), ...patch } } }));
  };
  const notes = (patch: Partial<BlockFeedbackAnswers['notes']>) => {
    setSent(false);
    setV((x) => ({ ...x, notes: { ...x.notes, ...patch } }));
  };
  const answered = [v.general, ...Object.values(v.lifts), v.notes].some((group) =>
    Object.values(group ?? {}).some((x) => x !== null && x !== ''),
  );

  return (
    <form
      className="ath-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await api.saveClosing(blockKey, v);
          setSent(true);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <header className="ath-hello">
        <h1>Cierre de {data.name}</h1>
        <p className="muted">
          Contestá lo que quieras: lo que dejes en blanco queda sin dato.
          {data.feedback ? ' Ya lo enviaste; podés corregirlo.' : ''}
        </p>
      </header>

      <section className="ath-card">
        <h2>El bloque en general</h2>
        <Scale
          label="Fatiga acumulada"
          low="Fresco"
          high="Fundido"
          value={v.general.fatigue}
          onChange={(n) => general({ fatigue: n })}
        />
        <Scale
          label="Estrés (dentro y fuera del gimnasio)"
          low="Bajo"
          high="Muy alto"
          value={v.general.stress}
          onChange={(n) => general({ stress: n })}
        />
        <Scale
          label="Sueño"
          low="Mal"
          high="Muy bien"
          value={v.general.sleep}
          onChange={(n) => general({ sleep: n })}
        />
        <Scale
          label="Ganas de entrenar"
          low="Pocas"
          high="Muchas"
          value={v.general.motivation}
          onChange={(n) => general({ motivation: n })}
        />
        <Scale
          label="¿Qué tan conforme quedaste?"
          low="Nada"
          high="Mucho"
          value={v.general.satisfaction}
          onChange={(n) => general({ satisfaction: n })}
        />
        <Choice
          label="La carga del bloque fue"
          options={[
            ['liviana', 'Liviana'],
            ['justa', 'Justa'],
            ['pesada', 'Pesada'],
          ]}
          value={v.general.load}
          onChange={(load) => general({ load })}
        />
      </section>

      {data.lifts.map((l) => {
        const x = v.lifts[l] ?? emptyLift();
        return (
          <section className="ath-card ath-lift" key={l}>
            <h2>{LIFT_NAME[l]}</h2>
            <Choice
              label="Comparado con el arranque, lo sentiste"
              options={[
                ['peor', 'Peor'],
                ['igual', 'Igual'],
                ['mejor', 'Mejor'],
              ]}
              value={x.feel}
              onChange={(feel) => lift(l, { feel })}
            />
            <Scale
              label="Fatiga"
              low="Poca"
              high="Mucha"
              value={x.fatigue}
              onChange={(n) => lift(l, { fatigue: n })}
            />
            <Scale
              label="Confianza en la técnica"
              low="Baja"
              high="Alta"
              value={x.technique}
              onChange={(n) => lift(l, { technique: n })}
            />
            <Scale
              label="Molestias"
              low="Ninguna"
              high="Muy fuertes"
              from={0}
              value={x.discomfort}
              onChange={(n) => lift(l, { discomfort: n })}
            />
            {!!x.discomfort && (
              <label>
                ¿Dónde y cuándo aparecían?
                <input
                  maxLength={120}
                  value={x.discomfortWhere}
                  onChange={(e) => lift(l, { discomfortWhere: e.target.value })}
                />
              </label>
            )}
            <Text label="Notas" max={600} value={x.note} onChange={(note) => lift(l, { note })} />
          </section>
        );
      })}

      <section className="ath-card">
        <h2>Para tu coach</h2>
        <Text
          label="Lo mejor del bloque"
          max={800}
          value={v.notes.best}
          onChange={(best) => notes({ best })}
        />
        <Text
          label="Lo que más te costó"
          max={800}
          value={v.notes.hardest}
          onChange={(hardest) => notes({ hardest })}
        />
        <Text
          label="Qué te gustaría para el próximo"
          max={800}
          value={v.notes.next}
          onChange={(next) => notes({ next })}
        />
        <Text label="Algo más" max={800} value={v.notes.other} onChange={(other) => notes({ other })} />
      </section>

      {error && <p className="ath-error">{error}</p>}
      {sent && (
        <p className="ath-sent" role="status">
          ✓ Enviado. Tu coach ya lo puede ver.
        </p>
      )}
      <button className="ath-primary" disabled={busy || !answered || sent}>
        {busy ? 'Enviando…' : data.feedback ? 'Guardar cambios' : 'Enviar cierre'}
      </button>
      <button type="button" className="ath-ghost" onClick={() => go('#/atleta')}>
        Volver al inicio
      </button>
    </form>
  );
}
