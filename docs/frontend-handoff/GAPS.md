# Disponibilidad, faltantes y límites

## Disponible (probado en `apps/api/test/journeys.test.ts` y tests previos)

- A Programación: atleta, macro, meso, microciclo, sesiones con protocolos (kg, %, RPE, RPE con tope, top/back-off, tempo/pausa/instrucciones); semana siguiente, repetir estructura, duplicar sesión, plantillas, cambio de protocolo en destinos explícitos, mover sesión; vista previa de diferencias y disponibilidad; borrador/aplicar; historial de versiones y eventos; copiar no copia resultados.
- B Registro: consultar sesiones, registrar ejecución y cuestionarios (check-in, fatiga de sesión, revisión técnica), previsto vs realizado, ediciones con revisiones (antes/después/motivo, paginado).
- C Análisis: estado multidimensional, macro activo, métricas con disponibilidad parcial, series, comparar semanas/períodos, evidencias, récords.
- D Intervenciones: ciclo completo, aceptar ≠ aplicar, vincular evento de plan, seguimiento.
- E Historial: listar macros/mesos/microciclos, semanal por movimiento y músculo, anotaciones, cambios automáticos.
- Importación Hevy: dry-run/apply con token, rechazos por motivo y muestra, válidos con huecos, mapeo de ejercicios persistente y revisable, idempotencia. Programación: contrato `plan-canonical-v1`.

## Falta (backend)

- Autenticación/autorización, usuarios y roles; actor real en los cambios (hoy "cambio detectado", actor desconocido).
- Varios macros activos por atleta: `/macros/active` devuelve uno solo; falta una regla (p. ej. un solo activo) o devolver lista.
- Edición/borrado de macros y microciclos (hoy solo crear/upsert de meso y micro; macro solo POST). Sin DELETE de sesiones: se elimina con `POST /plan` `replace:true`.
- Endpoint dedicado "crear sesión": se usa `POST /plan` (con `replace:false` agrega; ids únicos).
- Revisiones cubren series realizadas, check-ins y fatiga de sesión; **no** cubren cambios de parámetros ni referencias.
- Paginación en listas distintas de `revisions`.
- Importación del Excel de programación (`Macro (2).xlsx`): bloqueada por ambigüedad (sin fechas, relación tarjeta↔sesión, semántica de la celda 1RM); no bloquea programación nueva. 184 ejercicios de Hevy sin mapeo hasta que se revisen vía `exercise-map`.
- TRAC y CTL/ATL no implementados; dosis óptima de volumen desconocida.
- Sin validación estadística del motor: el replay existe, la validación no (ver `docs/VALIDACION_Y_REPLAY.md`).

## Lo resuelve Codex en el frontend

Navegación, formularios (con validación espejo de zod), borradores locales previos a `apply`, gráficos sobre `series`/`weekly*`, tablas de diferencias desde `preview`, estados vacíos/parciales/"no disponible" con su motivo, edición con diff, accesibilidad, pruebas del frontend. Ajustar los cuatro archivos de `apps/web` que ya consumen los contratos (provisionales).

## Requiere backend (pedirlo, no resolverlo en el cliente)

Cualquier cálculo nuevo, nueva regla, regla de unicidad de macro activo, DELETE/edición de macro, auditoría con actor, paginación, nuevos filtros, exportaciones.

## Antes de exponer externamente

Sin autenticación ni CSRF; CORS abierto solo al origen de dev; SQLite local de un solo proceso (sin backups, sin migraciones reversibles); `bodyLimit` 25 MB; sin rate limiting; sin HTTPS; datos personales en CSV de Hevy (no versionar, política de retención pendiente); `node:sqlite` es experimental; reglas y umbrales son **[propuesta]**; no hay despliegue configurado (el CI no despliega).

## Actualización

Resuelto en backend: lectura íntegra de sesiones con ids, protocolos y segmentos editables por serie/segmento, quitar y agregar series con vista previa, registrar cualquier serie por id, versión base para detectar concurrencia, reabrir borradores. Sigue pendiente: unicidad/edición/borrado de macros, detalle de meso vacío, desglose muscular planificado, comparación de prescripción entre semanas, catálogo HTTP de parámetros, autenticación.
