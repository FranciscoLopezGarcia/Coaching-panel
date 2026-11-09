# Migración y compatibilidad (consolidación del motor)

## Base de datos

- Migración `003_consolidacion.sql` (automática al arrancar; **no** toca datos existentes, solo añade columnas/tablas):
  `planned_sets` (+exposure_id, identity_source, variant_key, protocol, planned_kg_source, copied_from, …), tablas
  `exposure_links`, `import_batches`, `observed_sets`, `strength_references`, `interventions`, `macros`, `mesos`, `microcycles`, `plan_templates`.
- Series previstas antiguas: `exposure_id` se deriva del antiguo `slot_key` con `identity_source = 'legacy_slot'`
  (se conserva la ubicación en `slotKey`; la identidad pasa a `exposureId`). Nunca se reconstruye de forma ambigua en silencio:
  el origen queda marcado y se puede reemplazar con `exposure-links` explícitos.
- Evaluaciones/decisiones antiguas: se leen con `upgradeDecisionRow` / `upgradePlannedSet` (capa `repositories/legacy.ts`).
  Una evaluación sin `paramsVersion`/`state` se trata como **obsoleta** (`isLegacyEvaluation`) → hay que re-evaluar. Las decisiones históricas nunca se borran.
- Una BD de desarrollo creada antes de 003 migra sola; recomendado hacer copia antes. No se modificó ninguna BD real.

## Cambios de contrato (para quien consuma la API)

| Antes                               | Ahora                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `confidence` (alta/media/baja)      | `sufficiency` (suficiente/parcial/insuficiente) + `assessment` {recency, comparability, independentGroups}. Sin probabilidades |
| `slotKey` como identidad            | `exposureId` (identidad), `slotKey` (ubicación), `variantKey` (comparabilidad)                                                 |
| `coachDecision`                     | `lifecycle` (detectada→revisada→aceptada/descartada→aplicada→seguimiento→cerrada); `coachDecision` queda como alias deprecado  |
| TTP `no_delimitado`                 | `censurado` / `en_curso` / `insuficiente` / `no_concluyente` / `delimitado`                                                    |
| `BlockSummary.exposures` (número)   | lista de exposiciones                                                                                                          |
| familia `confidence`                | `comparability` + `pattern` (exploratorio / patron_repetido)                                                                   |
| `AthleteSummary.lifts[].confidence` | `.sufficiency`                                                                                                                 |
| estados                             | nuevos: `oportunidad_pendiente`, `estabilidad_observada`                                                                       |
| `PUT /params`                       | valida (422) con el registro de parámetros                                                                                     |
| `POST /plan`                        | rechaza ids de serie duplicados (422)                                                                                          |

`apps/web` solo recibió arreglos mínimos de tipos/etiquetas; **no** se desarrolló UI.

## Sesiones, protocolos y proyección (cambios posteriores)

- **Comportamiento**: `GET /sessions` incluye ahora las aproximaciones (`isWarmup:true`) y series con `retired:true`; consumidores que contaban series deben filtrar. Todo lo demás es aditivo (campos nuevos, rutas nuevas).
- **Contratos**: `programOpSchema`/`ProgramOpInput` no cambian; las operaciones nuevas están en `programOpFullSchema`/`ProgramOpFullInput`. `selection` suma `setIds` y `segmentKeys` (sigue estricta).
- **API**: `POST /program` responde además `baseVersionId` y `warnings`; `baseVersionId` en la solicitud es opcional (409 si el plan cambió). `POST /sets` registra con la hora del servidor (reloj inyectable).
- **Base de datos**: sin migración nueva en este tramo (la 004 ya existía); no se reescribe ningún resultado histórico. Las series retiradas con ejecución se conservan.
- **Proyección**: solo lectura, sin tablas nuevas.

## Variables núcleo y tablas (2026-11-08)

- **⚠ Cambio de cálculo**: el e1RM por curva usa ahora la curva de RTS (`rts-curva-default-v1`) en lugar de la tabla `rpe-proyecto-v1`. Difiere solo donde reps + 10 − RPE > 10 (107 de 195 celdas de la tabla anterior); el resto es idéntico. `method.version` de `e1rm_table_rpe` cambia de string. No se reescriben resultados guardados: re-evaluar para ver los nuevos.
- **Dominio**: por defecto sigue siendo reps 1–15 × RPE 4–10; el amplio (reps 1–50 × RPE 1–10) es opcional (`domain=amplio`).
- **Músculos**: `musculos-v1` (9 grupos) → `musculos-v2` (17 grupos + reglas por nombre). Se agregan grupos; los 9 anteriores conservan su nombre. Ejercicios que antes no tenían músculos (remos, jalones, curl, etc.) ahora aportan.
- **Nuevo**: `GET /api/athletes/:id/core`, `GET /api/tables/*`, `ObservedSet.setNo` (orden de series; de `set_index` en Hevy, sin migración de BD: se lee de la clave externa guardada).
