# API (real)

Base: `http://127.0.0.1:3001` (en dev el front usa el proxy de Vite `/api` → 3001). JSON. Fechas `AAAA-MM-DD`. Esquemas zod **autoritativos**: `packages/contracts/src/index.ts` (importables como `@coaching/contracts`; los tipos de respuesta también están ahí). Ejemplos reales: `EXAMPLES.md`.

## Errores y validaciones

| Código                                                               | Cuándo                                                                                                                                                                                                                                           | Cuerpo                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 400                                                                  | Body/query/params no cumplen el esquema (incluye claves desconocidas en `selection` de programación y valores fuera de rango)                                                                                                                    | `{error:"Datos inválidos", details:[zod issues]}` |
| 404                                                                  | Atleta/recurso inexistente                                                                                                                                                                                                                       | `{error}`                                         |
| 422                                                                  | Regla de negocio: ids de serie duplicados en el plan, ejecución sobre serie inexistente, parámetros inválidos, destino de programación ocupado sin `replaceExisting`, selección vacía, `confirmToken` ausente o que no coincide, CSV con errores | `{error, details?}`                               |
| 500                                                                  | Error interno                                                                                                                                                                                                                                    | `{error:"Error interno"}`                         |
| Nada se sobrescribe en silencio: los conflictos son 422 con mensaje. |

## Preview vs. operaciones que escriben

- **No escriben**: todos los `GET`; `POST …/program` con `mode:"preview"` (default); `POST …/imports/hevy` y `…/imports/plan-csv` con `mode:"dry_run"` (default); `POST …/replay`; `POST …/evaluate` **sí escribe** (guarda la evaluación y las decisiones del corte; reevaluar no borra decisiones históricas).
- **Escriben**: `program` con `mode:"draft"` (guarda borrador, no cambia el plan vigente ni genera eventos) o `"apply"` (UNA versión + UN evento compuesto); imports con `mode:"apply"` + `confirmToken` de la vista previa **del mismo contenido y opciones**; el resto de `POST/PUT/PATCH/DELETE`.
- No hay guardado "por tecla": el frontend debe acumular cambios y publicar con `apply`.

## Atletas y parámetros

| Método y ruta                     | Descripción                                                              |
| --------------------------------- | ------------------------------------------------------------------------ |
| `GET /api/health`                 | `{ok, timeZone}`                                                         |
| `GET /api/dashboard`              | tarjetas, prioridades, oportunidades, competencias                       |
| `GET /api/athletes`               | `AthleteSummary[]` (por lift: `status, summary, sufficiency, dataUntil`) |
| `POST /api/athletes`              | `{name, competitionExercises?}` → 201                                    |
| `GET /api/athletes/:id`           | detalle: params, última evaluación, decisiones                           |
| `PUT /api/athletes/:id/params`    | parámetros (validados con el registro; 422 con `issues`)                 |
| `POST /api/athletes/:id/evaluate` | `{cutoff?}` → evaluación completa                                        |

## Programación

| Ruta                                                                                  | Descripción                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /macros` · `GET /macros` · `GET /macros/active?cutoff` · `GET /macros/:macroId` | `{name,startDate,endDate?,objective?,status?}`; el activo trae mesos con `durationWeeks`/`closed`. Con varios macros activos, `/active` devuelve **uno** (ver GAPS)                                                                                  |
| `PUT /mesos` · `GET /mesos` · `GET /mesos/:blockKey?cutoff`                           | upsert por `blockKey` `{blockKey,macroId?,name,startDate?,endDate?,objective?}`; detalle con microciclos                                                                                                                                             |
| `PUT /microcycles` · `GET /microcycles`                                               | `{blockKey,weekNo,startDate,endDate}`                                                                                                                                                                                                                |
| `POST /plan`                                                                          | importa series previstas (`sets[]`, `status` aplicado\|borrador, `replace`, `effectiveOn`, `label`). Crea sesiones (una sesión = serie(s) con el mismo `sessionKey`). 422 si hay ids duplicados                                                      |
| `GET /sessions`                                                                       | sesiones con `sets[{planned,actual}]`, `endFatigue` (previsto vs realizado)                                                                                                                                                                          |
| `GET /plan-versions`                                                                  | versiones del plan                                                                                                                                                                                                                                   |
| `POST /program`                                                                       | `{mode, label?, effectiveOn?, op}`; `op.type` ∈ `duplicate_session`, `repeat_week`, `repeat_structure`, `apply_template`, `change_protocol`, `move_session`. Respuesta `{mode, preview:{event, addedSets, overwrites, availability[]}, saved\|null}` |
| `POST /templates` · `GET /templates`                                                  | guardar `{name,blockKey,weekNo}` / listar; aplicar con `op.apply_template`                                                                                                                                                                           |
| `PUT/GET/DELETE /exposure-links`                                                      | vínculo explícito entre identidades de exposición `{from,to,note}`                                                                                                                                                                                   |

`change_protocol.selection` es **estricta** (`blockKey, weeks[], sessionKeys[], exposureIds[], lift`) y obligatoria; una clave desconocida da 400. Copiar (`duplicate_session`, `repeat_*`, `apply_template`) **no copia** ejecución, cuestionarios ni completado.

## Registro

| Ruta                                       | Descripción                                                                                                                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /sets`                               | `{sets:[{plannedSetId,status:"done"\|"skipped"\|"pending",kg,reps,rpe,performedOn,pain}], reason?}`; upsert; 422 si la serie prevista no existe. Cada cambio deja una revisión                                                |
| `POST /checkins`                           | `{date,sleep,energy,motivation,stress,pain (1–10                                                                                                                                                                              | null), reason?}` upsert por fecha |
| `POST /session-feedback`                   | `{sessionKey,endFatigue,note?}`                                                                                                                                                                                               |
| `POST /coach-reviews` · `GET`              | revisión técnica `{lift,date,verdict,note}`                                                                                                                                                                                   |
| `GET /checkins` · `POST/GET /competitions` |                                                                                                                                                                                                                               |
| `GET /revisions?entity&key&limit&offset`   | trazabilidad de ediciones. `entity` ∈ `actual_set\|checkin\|session_feedback`; paginado (`limit` 1–200, default 50; `offset`) → `{total, items[{id,entity,key,at,action:create\|update,before,after,reason}], limit, offset}` |

## Análisis

| Ruta                                                                                                     | Descripción                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/catalog`                                                                                       | catálogo de métricas (definición, fórmula, versión, dominio, límites) + matriz de disponibilidad + convención muscular             |
| `GET /state?`                                                                                            | estado multidimensional por lift (`AthleteStateData`)                                                                              |
| `GET /metrics?from&to&lift=SQ\|BP\|DL\|ALL&exercise&referenceMode=original\|retrospective&cutoff&source` | `MetricResult` por id; `status` available\|partial\|unavailable                                                                    |
| `GET /records?source&cutoff`                                                                             | récords tipados (single, reps-at-load, load-for-reps, RPE-comparable)                                                              |
| `GET /series?from&to&cutoff&source`                                                                      | series temporales (e1RM por método separado, carga diaria sin ceros inventados, velas OHLC solo con ≥2 obs comparables)            |
| `GET /weekly` · `/weekly-muscles` (`from,to,cutoff,source`)                                              | resumen semanal por movimiento / por grupo muscular (previsto y realizado separados)                                               |
| `GET /week-compare?lift&exercise&cutoff&source`                                                          | semana vigente vs anterior (normaliza por semana/día si hay parcial)                                                               |
| `GET /period-compare?aFrom&aTo&bFrom&bTo&lift&exercise`                                                  | períodos A/B                                                                                                                       |
| `GET /annotations?from&to`                                                                               | cambios, intervenciones, competencias sobre la línea de tiempo                                                                     |
| `GET /exposures/:exposureId?cutoff`                                                                      | detalle de exposición (sesiones, comparabilidad, identidad)                                                                        |
| `GET /recommendations/:key/evidence?cutoff` (la `key` contiene `                                         | `: usar `encodeURIComponent`)                                                                                                      | `{key, explanation, assessment, records}` |
| `GET /decisions?validity=vigente\|expirada` · `PATCH /decisions/:key`                                    | decisiones; el PATCH (compat) cambia `coachDecision` y **no** modifica la programación. Para el ciclo completo usar intervenciones |
| `GET /blocks` · `/compare?lift&a&b&universe&scope` · `/load` · `/performance`                            | resúmenes por bloque/familia (TTP), comparación de bloques, carga, rendimiento                                                     |
| `POST /replay`                                                                                           | `{from,to,step:weekly\|sessions,horizonN?}` → informe de replay sin fuga                                                           |

## Intervenciones

| Ruta                                       | Descripción                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /interventions`                      | `{proposalKey?, lift?, exposureId?, …}`; sin `proposalKey` = intervención manual (exige `lift`). Una propuesta ⇒ una intervención (idempotente) |
| `GET /interventions?cutoff`                | `[{intervention, followUp}]`                                                                                                                    |
| `POST /interventions/:iid/transition`      | `{to, on?, note?, appliedOn?, appliedDescription?, deviatesFromProposal?, linkedEventId?}`; transiciones inválidas → 422                        |
| `POST /interventions/:iid/link`            | `{eventId}` vincula el cambio de plan aplicado (404 si el evento no existe)                                                                     |
| `GET /history` · `PATCH /history/:eventId` | `{events, deviations}`: cambios automáticos del plan con seguimiento; el PATCH solo guarda el comentario del coach                              |
| `GET /plan-versions`                       |                                                                                                                                                 |

## Importación y referencias

| Ruta                                        | Descripción                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /imports/hevy`                        | `{csv, mode, timeZone?, exerciseMap?, confirmToken?}`. Preview: `newRows, duplicatesExisting, rejected, rejectedByReason[], rejectedSample[], validWithGaps[], exercises[] (mapeo revisable), unmappedExercises[], bySetType, withRpe/withoutRpe, loadKinds, warnings, token, fatal[]`. Aplicar: `applied:{batchId,inserted,ignored}`; reimportar es idempotente. El `exerciseMap` guardado se mezcla con el enviado (gana el enviado) |
| `GET/PUT/DELETE /imports/hevy/exercise-map` | mapeo persistente `{title, lift:SQ\|BP\|DL\|null, variantKey?, loadKind?}` (`DELETE ?title=`)                                                                                                                                                                                                                                                                                                                                          |
| `GET /imports`                              | lotes importados                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `POST /imports/plan-csv`                    | contrato canónico `plan-canonical-v1` `{csv, mode, status, replace, effectiveOn?, label?, confirmToken?}` → `{parse:{ok,errors,warnings,summary,availability}, token, applied}`                                                                                                                                                                                                                                                        |
| `POST/GET /references`                      | referencia de fuerza `{exerciseName,kg,source,asOf,note}`; sin referencia vigente no hay intensidad relativa                                                                                                                                                                                                                                                                                                                           |

Rutas relativas: todas cuelgan de `/api/athletes/:id` salvo `/api/health`, `/api/dashboard`, `/api/catalog`, `/api/athletes`.

## Paginación y filtros

Solo `GET /revisions` está paginado. Las demás listas devuelven todo (volúmenes de un atleta). Filtros: ver cada ruta; `validity` en decisiones; `source` (omitido = `todas`; si se indica, filtra observaciones por origen, p. ej. `hevy`) en métricas/series.

## Compatibilidad

`confidence` ya no existe (→ `sufficiency` + `assessment`); `slotKey` es ubicación, la identidad es `exposureId`; `coachDecision` es alias deprecado de `lifecycle`. Detalle en `docs/MIGRACION_Y_COMPATIBILIDAD.md`.

## Actualización (sesiones, protocolos y proyección)

- `GET /sessions` ahora trae ids estables, protocolo, segmentos y aproximaciones (`isWarmup`); `GET /plan` y `GET /plan-versions/:versionId` son nuevos; `POST /program` suma selección por `setIds`/`segmentKeys`, operaciones `remove_sets`/`add_sets` (tipo `ProgramOpFullInput`), `baseVersionId` (409 si el plan cambió) y devuelve `warnings`. Detalle y ejemplos en `docs/PERFORMANCE_PROJECTION_API.md` (sección "Sesiones y protocolos").
- `GET /performance-projection` (experimental): contrato completo en `docs/PERFORMANCE_PROJECTION_API.md`.
- `GET /plan` y `GET /sessions` no están paginados.
