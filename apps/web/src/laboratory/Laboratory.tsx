import { useState } from 'react';
import { currentInstance } from './environment';
import { useLoad } from '../hooks';
import { api } from '../api/client';
import { workspaceApi } from '../workspace/api';
import { Async } from '../components/Async';
export function Laboratory({ onCreate }: { onCreate: () => void }) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const cases = useLoad(async () => {
    const athletes = await api.athletes();
    return Promise.all(
      athletes.map(async (a) => {
        const macro = await workspaceApi.active(a.id);
        const guide = currentInstance()?.cases.find((c) => c.athleteId === a.id);
        return {
          ...a,
          startDate: macro?.startDate,
          guide,
          objective:
            guide?.summary ??
            guide?.explores ??
            macro?.objective ??
            'Crear programación, registrar una sesión y evaluar su respuesta.',
        };
      }),
    );
  }, []);
  return (
    <section className="laboratory-entry">
      <div className="row between">
        <div>
          <h2>Elegí un caso para probar</h2>
          <p className="small muted">Las ediciones se guardan. No hay reinicio automático.</p>
        </div>
        <button className="primary" onClick={onCreate}>
          ＋ Crear atleta ficticio propio
        </button>
      </div>
      <Async state={cases}>
        {(list) => (
          <div className="lab-cases">
            {list.map((a, i) => (
              <article key={a.id}>
                <span className="eyebrow">CASO {i + 1}</span>
                <h3>{a.name}</h3>
                <p>{a.objective}</p>
                {a.guide && a.startDate && (
                  <label>
                    Fecha sugerida de análisis
                    <select
                      value={selected[a.id] ?? a.evaluatedOn ?? ''}
                      onChange={(e) => setSelected({ ...selected, [a.id]: e.target.value })}
                    >
                      {a.evaluatedOn && !a.guide.cutoffs.some((c) => c.date === a.evaluatedOn) && (
                        <option value={a.evaluatedOn}>Evaluación guardada · {a.evaluatedOn}</option>
                      )}
                      {a.guide.cutoffs.map((c) => (
                        <option key={c.date} value={c.date}>
                          {c.date} · {c.note}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="row">
                  {[
                    ['resumen', 'Abrir caso'],
                    ['plan', 'Programación'],
                    ['registro', 'Registro'],
                    ['analisis', 'Análisis'],
                  ].map(([tab, label]) => (
                    <a
                      key={tab}
                      href={`#/athlete/${encodeURIComponent(a.id)}?${new URLSearchParams({ tab: tab!, ...((selected[a.id] ?? a.evaluatedOn) ? { cutoff: selected[a.id] ?? a.evaluatedOn!, to: selected[a.id] ?? a.evaluatedOn! } : {}), ...(a.startDate ? { from: a.startDate } : {}) })}`}
                    >
                      {label} →
                    </a>
                  ))}
                </div>
              </article>
            ))}
            {!list.length && <p>No hay casos cargados en esta instancia. Podés crear tu atleta ficticio.</p>}
          </div>
        )}
      </Async>
    </section>
  );
}
