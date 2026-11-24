import {
  ComplianceChart,
  ZonesChart,
  type CBlock,
  type CCompliance,
  type CZones,
} from '../workspace/BlockCharts';
import { number } from '../workspace/ui';
import type { AnalysisResult } from './types';

/** Composición por bloque de la intensidad (zonas de %1RM): gráfico apilado y su tabla. Vive en la familia Carga. */
export function ZonesBlock({ data }: { data: AnalysisResult }) {
  const z = data.blocks?.zones as unknown as CZones | undefined;
  const blocks = (data.blocks?.window.blocks ?? []) as CBlock[];
  if (!z || !z.byBlock.length) return null;
  return (
    <div className="an-extra">
      <h4 className="an-sub">Zonas de intensidad por bloque</h4>
      <ZonesChart zones={z} blocks={blocks} />
      <div className="an-tablewrap">
        <table className="an-table">
          <thead>
            <tr>
              <th>Bloque</th>
              {z.byBlock[0]?.zones.map((zz) => (
                <th key={zz.zone}>
                  {zz.label}
                  <small>{zz.range} %1RM</small>
                </th>
              ))}
              <th>
                Sin referencia<small>series</small>
              </th>
            </tr>
          </thead>
          <tbody>
            {z.byBlock.map((bz, i) => (
              <tr key={bz.blockKey}>
                <th scope="row">
                  B{i} · {bz.blockKey}
                </th>
                {bz.zones.map((zz) => (
                  <td key={zz.zone}>
                    <span className="num">
                      {zz.shareSets === null ? '—' : `${number(100 * zz.shareSets, 0)} %`}
                    </span>
                    <small>
                      {zz.sets} series · {zz.reps} reps
                    </small>
                  </td>
                ))}
                <td className="num">{bz.withoutRef}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="an-note">
        Cortes configurados: {z.cuts.join(' · ')} %1RM. Descriptivo: no indica que una distribución sea mejor.
      </p>
    </div>
  );
}

/** Cumplimiento por bloque: hechas, omitidas y sin registro (faltante ≠ omitida). Vive en la familia Cumplimiento. */
export function ComplianceBlock({ data }: { data: AnalysisResult }) {
  const c = data.blocks?.compliance as unknown as CCompliance[] | undefined;
  const blocks = (data.blocks?.window.blocks ?? []) as CBlock[];
  if (!c?.length) return null;
  return (
    <div className="an-extra">
      <h4 className="an-sub">Series por estado y bloque</h4>
      <ComplianceChart data={c} blocks={blocks} />
      <div className="an-tablewrap">
        <table className="an-table">
          <thead>
            <tr>
              <th>Bloque</th>
              <th>Sesiones con trabajo</th>
              <th>Previstas</th>
              <th>Hechas</th>
              <th>Omitidas</th>
              <th>Sin registro</th>
            </tr>
          </thead>
          <tbody>
            {c.map((x, i) => (
              <tr key={x.blockKey}>
                <th scope="row">
                  B{i} · {x.blockKey}
                </th>
                <td className="num">
                  {x.total.sessionsWithWork}/{x.total.sessionsPlanned}
                </td>
                <td className="num">{x.total.setsPlanned}</td>
                <td className="num">{x.total.setsDone}</td>
                <td className="num">{x.total.setsSkipped}</td>
                <td className="num">{x.total.setsUnknown}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
