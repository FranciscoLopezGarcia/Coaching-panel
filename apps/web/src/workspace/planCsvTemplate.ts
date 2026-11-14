/** CSV estándar de importación de planes (plan-canonical-v1). Filas FICTICIAS de ejemplo: se borran antes de cargar tu planilla. */
export const PLAN_CSV_TEMPLATE = [
  'block,week,date,exercise,protocol,day,session,exposure_id,lift,role,priority,variant,ref_kg,family,slot,notes',
  'EJEMPLO-BORRAR,1,2026-01-05,Squat comp,"1x5x140@7 + 3x5x125@8",1,s1,sq-primaria,SQ,primaria,1,Squat comp,150,F1,squat|D1,fila ficticia de ejemplo (top set + back-offs)',
  'EJEMPLO-BORRAR,1,2026-01-05,Remo con barra,3x10@8,1,s1,remo,,accesorio,3,Remo con barra,,F1,remo|D1,fila ficticia sin movimiento de competencia',
  'EJEMPLO-BORRAR,1,2026-01-07,Bench comp,4x5@8,3,s3,bp-primaria,BP,primaria,1,Bench comp,100,F1,bench|D3,fila ficticia sin top set (protocolo libre)',
].join('\n');
export const downloadPlanCsvTemplate = () => {
  const url = URL.createObjectURL(new Blob([PLAN_CSV_TEMPLATE + '\n'], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla-plan.csv';
  a.click();
  URL.revokeObjectURL(url);
};
