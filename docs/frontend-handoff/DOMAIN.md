# Dominio

## Jerarquía y entidades

Atleta → Macro → Meso (`blockKey`) → Microciclo (`blockKey`+`weekNo`, fechas explícitas opcionales) → Sesión (`sessionKey`) → Exposición → Serie prevista (`PlannedSet`) ← Serie realizada (`ActualSet`, 1:1 por `plannedSetId`).
Aparte: `checkins` (por fecha), `session_feedback` (fatiga fin de sesión), `coach_reviews` (técnica), `competitions`, `strength_references` (fuente/fecha/ejercicio), `observed_sets` (Hevy, **no** ligadas a prescripción), `plan_versions` + `change_events`, `interventions`, `record_revisions`, `plan_templates`, `exposure_links`.
Duraciones de macro/meso/micro variables; si un meso no tiene fechas, el motor deriva de las series previstas y lo marca.

## IDs e identidad de exposición

- `PlannedSet.id`, `sessionKey`, `blockKey`: los define quien programa; estables y únicos por atleta (duplicados → 422). Copias reciben ids nuevos y `copiedFrom`.
- **`exposureId`** = identidad estable de una exposición (ej. `sq-primaria`). **`slotKey`** = ubicación en el calendario. **`variantKey`** = criterio de comparabilidad (ejercicio/equipo/protocolo). Los tres son independientes: mover o duplicar sesiones no cambia la identidad; cambiar variante parte la serie comparable (`comparableTail`).
- Datos viejos: `exposureId` derivado del slot con `identity_source = legacy_slot`. Vínculos manuales con `exposure-links`; nunca se fusiona por inferencia.

## Programación vs ejecución

Lo previsto vive en `planned_sets` (con `protocol`, `plannedKgSource`); lo realizado en `actual_sets`. Registro ausente ≠ omitida (`actual:null` vs `status:"skipped"`). Descanso no registrado = desconocido, nunca 0. Los kg de un protocolo `pct` se resuelven en el motor con la referencia (`refKg`/`strength_references` vigente a la fecha). `protocol` válido: `loadMode` kg\|pct\|rpe\|rpe_cap, `pct`, `capKg`, `segment` top\|backoff\|work, `tempo`, `pauseSec`, `instructions` (texto libre: **no** se convierte en cálculos).

## Estados

- **Decisión/estado por lift** (`status`): `revision_tecnica`(B-DOLOR/B-TECNICA bloquean), `fin_esfuerzo`, `fin_respuesta`/`posible_fin_respuesta`, `datos_insuficientes`, `candidato_pr`, `oportunidad_pendiente`, `ventana_expresion`, `margen_carga`, `progreso`, `tendencia`, `estabilidad_observada`, `volumen`, `frecuencia`, `sin_senal`. Prioridad en `packages/engine/src/priority.ts`. Estable ≠ fin de respuesta.
- **Suficiencia**: `suficiente|parcial|insuficiente` + `recency` + `comparability` + grupos independientes. Sin probabilidades.
- **Ciclo de intervención**: `detectada → revisada → aceptada|descartada → aplicada → seguimiento → cerrada`. Aceptar no aplica; lo aplicado puede diferir (`deviatesFromProposal`); fechas separadas (`detectedOn, reviewedOn, decidedOn, appliedOn, closedOn`); intervención manual sin propuesta permitida; `linkedEventId` vincula el cambio de plan; `seguimiento` se inicia solo si `appliedOn ≤ hoy`. Las decisiones históricas no desaparecen (`validity: expirada`).
- **Plan**: versión `aplicado|borrador`; `change_events` automáticos (actor desconocido, comentario opcional).
- **Importación**: dry-run → `token` → apply.

## Métricas (catálogo en `GET /api/catalog`)

| id                                                            | unidad              | método                                                                          |
| ------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| `nl`                                                          | repeticiones        | suma de reps (≠ series)                                                         |
| `sets`, `frequency`                                           | series; días/semana | conteos                                                                         |
| `tonnage`                                                     | kg                  | solo cargas totales conocidas                                                   |
| `intensity_rel`                                               | % ref               | kg ÷ referencia fechada                                                         |
| `e1rm_table_rpe`                                              | kg                  | curva reps×RPE `rts-curva-default-v1`; **exige RPE real**                       |
| `e1rm_prg_formulas`                                           | kg                  | promedio de 6 fórmulas PRG, reps 2–10                                           |
| `si_rts_*` (aprox), `si_prg`, `si_efort_xl`                   | adimensional        | modelos distintos, **no se suman ni comparan**                                  |
| `inol_prg`, `acwr_prg`, `fatigue_ratio_prg`, `peak_index_prg` | —                   | PRG reconstruido                                                                |
| `muscle_sets_equivalent`                                      | series eq.          | directo 1.0 / indirecto 0.5 (convención del proyecto); sin total entre músculos |

`MetricResult`: `status, value, unit, period{from,to,days,weeks,partial}, scope, usedRecords, excluded, missing, reference, baseline, method{id,version}, warnings, cutoff`.
**Disponibilidad y abstención**: `unavailable` ⇒ `value:null` + `missing`; `partial` ⇒ valor con `warnings`. Una regla sin dato **se abstiene** (la matriz completa está en `informe-final.md` §5 y en `/api/catalog`.availability); las demás métricas siguen. Nunca se completa un RPE faltante con el objetivo. `referenceMode`: `original` (referencia conocida a la fecha) vs `retrospective` (recalculado, rotulado).

## Procedencia de recomendaciones

Cada decisión trae `ruleId` + `rulesVersion` + `paramsVersion`, `explanation` (qué/por qué/qué revisar/límites/próxima revisión), evidencia con `origin` (rendimiento|carga|cuestionario|cumplimiento|observación técnica) y `independenceGroup`, `missing`, `alternatives` descartadas, `validity`. Etiquetas de procedencia: recuperado / documentado / aproximado / **propuesta** (todas las reglas actuales) / desconocido. Nada es una predicción validada.

## Convenciones

- **Fechas**: ISO local del atleta (`TZ_APP`, default `America/Argentina/Mendoza`); Hevy se interpreta en esa zona (`dateInterpretation` lo informa).
- **Semanas**: lunes–domingo (`dayNo` 1–7, lunes=1). `weekNo` es de bloque (microciclo), no de calendario. Semana parcial se marca `partial` y se normaliza por semana/día.
- **Cargas**: kg. Tipos de carga: `total, per_side (mancuernas por lado), machine, bodyweight, added_bodyweight, assisted, unknown`; solo `total`/`machine` entran al tonelaje. `RPE` 1–10 (pasos .5); `pain` 0–10 por serie; check-in 1–10.
- **Grupos musculares**: tabla de la app (no la de Hevy); NL ≠ series musculares.
- **Parámetros**: `PARAM_REGISTRY` (default, alcance, versión); precedencia movimiento > atleta > default; `missingConfig` dice qué falta y qué se suspende.
