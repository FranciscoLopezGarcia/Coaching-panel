# Proyección de rendimiento — contrato de API (experimental)

Estado: **v1 inicial, experimental**. Versiones: contrato `performance-projection-v1`; motor `proyeccion-v0.1-experimental`; agregación `exposure-agg-v1`.
Implementación: `packages/engine/src/projection/`, tipos en `@coaching/contracts` (`PerformanceProjection`, `performanceProjectionQuerySchema`), ruta en `apps/api/src/routes/consolidation.ts`.
Es **solo lectura** (no escribe nada). Todo valor es un _indicador de rendimiento_ (e1RM del ejercicio/variante elegido) y **no** equivale a 1RM real, resultado de competencia, éxito de un intento, pico fisiológico, efecto de cambiar el volumen, tolerancia ni riesgo de lesión.

## Endpoint

`GET /api/athletes/:id/performance-projection`

| Query                                    | Tipo                                | Default          | Notas                                                                                                                                                          |
| ---------------------------------------- | ----------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lift`                                   | `SQ\|BP\|DL`                        | —                | Alguno de `lift`/`exercise`/`exposureId` es obligatorio                                                                                                        |
| `exercise`                               | string                              | —                | nombre del ejercicio (p. ej. `Squat comp`)                                                                                                                     |
| `exposureId`                             | string                              | —                | resuelve ejercicio+variante de esa exposición                                                                                                                  |
| `variantKey`                             | string                              | —                | Si hay varias variantes y no se indica, **no se elige una**: `status:"unavailable"`, `reason:"variant_required"` y `selection.availableVariants`               |
| `variable`                               | `e1rm_table_rpe\|e1rm_prg_formulas` | `e1rm_table_rpe` | Métodos **separados**; nunca se mezclan ni se cambia de uno a otro en silencio                                                                                 |
| `source`                                 | string                              | todas            | filtra por origen (`plan`, `hevy`)                                                                                                                             |
| `cutoff`                                 | `AAAA-MM-DD`                        | hoy              | Nada posterior al corte entra en la serie, el ajuste ni la validación                                                                                          |
| `horizonDays`                            | int 1–365                           | 28               | horizonte pedido (puede ser limitado: ver `horizon`)                                                                                                           |
| `macroId` / `blockKey` / `from`+`to`     |                                     |                  | Vista (qué se dibuja). No cambian el entrenamiento salvo `scope=view`                                                                                          |
| `scope`                                  | `history\|view`                     | `history`        | `history`: ajusta con TODA la historia ≤ corte (incluye lo previo al meso, identificado en `periods.training`); `view`: ajusta solo con el período de la vista |
| `aggregate`                              | `best\|median`                      | `best`           | Resumen de varias series de una exposición (ver DOMAIN abajo)                                                                                                  |
| `levelK`, `halfLifeDays`, `rangeNominal` |                                     | ver `config`     | Anulaciones de decisiones operativas                                                                                                                           |

Errores: `400` parámetros inválidos o incoherentes (zod): ningún filtro, más de un selector de vista, `scope=view` sin vista, `from > to`, valores fuera de rango; `404` atleta, macro o meso inexistente; `422` `exposureId` inexistente para el atleta. La falta de datos **no es error**: devuelve `200` con `status` `descriptive_only` o `unavailable` y el motivo.

## Respuesta (`PerformanceProjection`)

| Campo                              | Contenido                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contractVersion`, `engineVersion` | versiones                                                                                                                                                                                                                                                                                                                                                                                        |
| `status`                           | `available` (hay proyección) · `descriptive_only` (hay serie y tendencia descriptiva, pero no proyección) · `unavailable` (no hay serie utilizable)                                                                                                                                                                                                                                              |
| `reasons[]`                        | `{code, message}` de abstención/limitación (códigos: `variant_required`, `insufficient_exposures`, `insufficient_span`, `stale_data`, `horizon_exceeds_history`, `no_rpe`, `no_data`, `outliers_flagged`)                                                                                                                                                                                        |
| `cutoff`, `periods`                | `observed{from,to}`, `view{from,to,kind}`, `training{from,to,scope}`                                                                                                                                                                                                                                                                                                                             |
| `target`                           | atleta, lift, ejercicio, `variantKey`, `variable`, `unit:"kg"`, `method{id,version}`                                                                                                                                                                                                                                                                                                             |
| `selection`                        | filtros resueltos y `availableVariants[]` (exposiciones por variante y método)                                                                                                                                                                                                                                                                                                                   |
| `horizon`                          | `requestedDays`, `effectiveDays\|null`, `forecastDate\|null`, `maxAllowedDays`, `limitedBy`                                                                                                                                                                                                                                                                                                      |
| `aggregation`                      | regla `exposure-agg-v1` y modo                                                                                                                                                                                                                                                                                                                                                                   |
| `observedPoints[]`                 | `{date, value, exposureKey, setIds[], nSets, nEligibleSets, alternateValue, availableOn\|null, inView, outlier{flag,score}}` — **un punto por exposición**                                                                                                                                                                                                                                       |
| `fittedPoints[]`                   | `{date, value, modelId}` valores ajustados del modelo mostrado en las fechas observadas                                                                                                                                                                                                                                                                                                          |
| `forecastPoints[]`                 | `{date, horizonDays, value, modelId}` línea futura (vacía si no hay proyección)                                                                                                                                                                                                                                                                                                                  |
| `baselineForecastPoints[]`         | lo mismo para el baseline (siempre que haya proyección)                                                                                                                                                                                                                                                                                                                                          |
| `forecastRange`                    | `{status, reason, method, nominalCoverage, observedCoverage\|null, coverageSample, sampleSize, horizonToleranceDays, points[{date,lower,upper}], notice}`. Sin muestra suficiente: `status:"unavailable"` y `points:[]`                                                                                                                                                                          |
| `model`                            | `selected{id,version,label}`, `candidates[]` (id, versión, parámetros, `slopeKgPerWeek`, `levelKg`), `level{kg, definition, pointsUsed}`, `selectionRule`, `selectionBasis`                                                                                                                                                                                                                      |
| `validation`                       | esquema origen móvil expansivo: `evaluations`, `horizonDays`, `toleranceDays`, `models[{id, n, maeKg, biasKg, diffMaeVsBaselineKg, wins, losses, ties}]`, `baseline`, `selector` (modelo + regla de selección evaluado con selección anidada), `verdict` (`mejora_sobre_baseline`\|`sin_mejora`\|`no_concluyente`\|`sin_evaluaciones`), `coverage{origins, evaluable, abstentions[]}`, `notes[]` |
| `dataQuality`                      | exposiciones, `spanDays`, `lastExposureAgeDays`, `stale`, `irregularity{medianGapDays,maxGapDays}`, `outliers{count, treatment, sensitivity}`, `missingRpeSets`, `sufficiency`                                                                                                                                                                                                                   |
| `exclusions[]`                     | `{reason, count, sampleIds[]}` series que no entraron y por qué                                                                                                                                                                                                                                                                                                                                  |
| `realMarks[]`                      | marcas reales (mayor carga por cantidad de repeticiones ≤ corte, misma variante). **No** es la serie ajustada                                                                                                                                                                                                                                                                                    |
| `reference`                        | referencia de fuerza para prescripción vigente al corte (`kg, asOf, source`) o `null`. **No** entra en el ajuste                                                                                                                                                                                                                                                                                 |
| `summary`                          | `{trend{label,basis,slopeKgPerWeek,changeKgOverSpan}, projection{valueKg,horizonDays,date,versusBaseline}\|null, limitation, text, lines[]}`                                                                                                                                                                                                                                                     |
| `limitations[]`                    | siempre incluye qué NO es el indicador                                                                                                                                                                                                                                                                                                                                                           |
| `config`                           | decisiones operativas aplicadas con su procedencia                                                                                                                                                                                                                                                                                                                                               |

### Estados y qué dibujar

- `available`: puntos observados + línea ajustada + línea futura discontinua; banda solo si `forecastRange.status === "available"`.
- `descriptive_only`: puntos observados y tendencia descriptiva (`summary.trend`); sin línea futura ni banda.
- `unavailable`: solo `reasons`, `selection` y `exclusions`.
- Mostrar siempre `target.method`, `summary.limitation` y, si `validation.verdict !== "mejora_sobre_baseline"`, que la referencia es el baseline.

### Resumen (`summary`)

Texto determinista (sin LLM): 1) tendencia, 2) proyección, 3) limitación principal. Etiquetas de tendencia: `ascendente|estable|descendente` **solo** si el atleta tiene configurado el cambio mínimo relevante del movimiento (`minChangePct`/`minChangeKg`); si no, `indeterminada` y se describe el cambio numérico sin clasificarlo. Nunca usa "va a levantar", "PR asegurado" ni "pico confirmado".

### Relación con otros conceptos (no se conectan automáticamente)

Tendencia descriptiva ≠ proyección condicional a continuidad del patrón ≠ candidato a PR (`R-PR`) ≠ ventana de expresión (`R-EXPRESSION`) ≠ TTP histórico. Pueden discrepar; el endpoint no las reconcilia.

## Qué proyecta (y qué no)

Un **indicador de rendimiento**: e1RM por exposición del ejercicio/variante elegido, con UN método a la vez.

- `e1rm_table_rpe` — curva reps×RPE (`rts-curva-default-v1`). Una serie sin RPE real **se excluye** (no se completa con el objetivo; no se convierte en test máximo).
- `e1rm_prg_formulas` — promedio de 6 fórmulas de repeticiones (reps 2–10, sin RPE). Una serie submáxima subestima la fuerza en una magnitud desconocida; se advierte en `dataQuality.warnings`.
  Las marcas reales (`realMarks`) y la referencia de fuerza para prescripción (`reference`) son entidades aparte y **no entran en el ajuste**. Variantes distintas no son equivalentes: no se elige una por el usuario ni se extrapola entre ellas (`variant_required`).

### Protocolo de agregación `exposure-agg-v1`

Una exposición = (fuente, sesión, ejercicio, variante) → **un solo punto**, sin importar cuántas series tenga. Series elegibles: de trabajo (no calentamiento ni dropset), fecha ≤ corte, carga total conocida y datos que exige el método. Valor = el mejor e1RM (`best`, default) o la mediana (`median`) de esas series; `alternateValue` trae el otro. Sesgo conocido de `best`: tiende a subir con más series porque es el máximo de más muestras; por eso el peso en el ajuste es de un punto por exposición y se reporta el otro resumen. El protocolo está versionado: cambiarlo cambia `aggregation.id`.

## Modelos (v0.1)

| id                                                                                                                                               | versión                         | Qué hace                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------- |
| `baseline`                                                                                                                                       | `baseline-nivel-reciente-v1`    | Mantiene el **nivel reciente** = mediana de las últimas `levelK` (3) exposiciones.           |
| `linear`                                                                                                                                         | `tendencia-lineal-v1`           | Mínimos cuadrados sobre el **tiempo real** (días civiles), no sobre el número de exposición. |
| `linear_weighted`                                                                                                                                | `tendencia-lineal-ponderada-v1` | Igual, con peso 0,5^(edad/semivida); semivida `halfLifeDays` (28).                           |
| Sin polinomios, redes ni modelo de fatiga. El horizonte se cuenta desde la **última exposición observada** (`horizon.fromDate`), en días reales. |

**Qué modelo se muestra**: el baseline, salvo que la validación anidada (fuera de muestra) demuestre que un modelo con tendencia lo mejora (`validation.verdict = mejora_sobre_baseline`). Si no mejora o es no concluyente, el baseline es la referencia y se dice.

### Controles y decisiones operativas (todas configurables, `config`, procedencia "propuesta")

`minExposures` 5 · `minSpanDays` 21 · `maxStalenessDays` 42 · `maxHorizonDays` 84 · `maxHorizonToSpanRatio` 0,5 · `levelK` 3 · `halfLifeDays` 28 · `outlierMadK` 3,5 · `minExposuresForOutlier` 6 · `targetToleranceDays` 7 · `minTrainExposures` 4 · `minEvaluations` 8 · `minErrorsForRange` 10 · `rangeNominal` 0,8. **Ninguno está validado con datos reales**; viven en `packages/engine/src/projection/config.ts`.

- Pocas exposiciones, poca extensión, dato obsoleto u horizonte mayor que el permitido por el historial ⇒ `descriptive_only` con `reasons`.
- Atípicos: se **marcan** (`observedPoints[].outlier`, residuo robusto MAD), no se eliminan; `dataQuality.outliers.sensitivity` compara el pronóstico con y sin ellos.
- Cambio de método o de variante: no se mezclan; son series distintas.

## Validación temporal

Origen móvil expansivo: en cada origen (fecha de una exposición) se ajusta **solo con fecha ≤ origen**, se proyecta al primer objetivo posterior a `horizonDays ± toleranceDays` días reales y se compara con lo observado. Todos los modelos se comparan en los **mismos pliegues**. Error = pronóstico − real (**sesgo > 0 = sobreestima**).

- `validation.models[]`: n, `maeKg`, `biasKg`, `diffMaeVsBaselineKg`, victorias/derrotas/empates frente al baseline. Es una comparación sobre todos los pliegues (descriptiva).
- `validation.selector`: la regla de selección evaluada con **selección anidada** (en cada origen solo usa pliegues con objetivo ya conocido). El `verdict` sale de aquí, no de elegir el mejor modelo con los mismos resultados con que se afirma su rendimiento.
- `verdict`: `mejora_sobre_baseline` (≥ `minEvaluations`, MAE del selector menor y más victorias que derrotas), `sin_mejora`, `no_concluyente` (< `minEvaluations`), `sin_evaluaciones`.
- Fechas de **ejecución**: si no existe fecha de disponibilidad del registro (`observedPoints[].availableOn`), el replay no reconstruye exactamente qué sabía el coach en ese momento. `availableOn` solo se informa cuando existe (revisión de creación del registro o lote de importación).

## Rango de proyección

Rango **empírico** de los errores fuera de muestra del modelo mostrado en pliegues del mismo horizonte (`empirical-quantile-nearest-rank-v1`): percentiles `(1−c)/2` y `1−(1−c)/2` de los errores, aplicados al pronóstico. Requiere ≥ `minErrorsForRange` errores; si no, `status:"unavailable"` y `reason`. `observedCoverage` es la cobertura medida fuera de muestra (el rango de cada pliegue se arma solo con errores ya conocidos) y `coverageSample` su tamaño. **No es un intervalo de confianza ni garantiza cobertura futura**; no hay probabilidades de PR. Aplica únicamente al punto con `rangeApplies:true` (el horizonte pedido) y al mismo indicador.

### Calibración del rango (obligatorio mostrarla)

`forecastRange.label` es siempre `"rango empírico no calibrado"`. `forecastRange.calibration` compara la cobertura **observada fuera de muestra** con la nominal: `below_nominal` (observada < nominal), `at_or_above_nominal` o `not_evaluable` (menos de `minCoverageSample` = 10 casos). `forecastRange.warnings[]` trae `coverage_below_nominal`, `coverage_not_evaluable` o `range_unavailable` con texto listo para mostrar. El rango no se reajusta para "llegar" a la cobertura nominal: ajustar y evaluar sobre los mismos errores daría una cobertura circular; cada pliegue se evalúa con un rango construido solo con errores de pliegues ya conocidos. En los datos reales medidos la cobertura observada fue 0,70–0,76 frente a 0,8 nominal ⇒ el aviso `coverage_below_nominal` corresponde. No presentar el rango como "80 %" ni como intervalo de confianza.

## Cómo consumirlo (Codex)

1. `GET /api/athletes/:id/performance-projection?lift=SQ` (opcional `exercise`+`variantKey`, `variable`, `blockKey|macroId|from+to`, `horizonDays`).
2. Si `status==="unavailable"`: mostrar `reasons[]` y, si `variant_required`, ofrecer `selection.availableVariants`.
3. Dibujar `observedPoints` (puntos; opacar los `inView:false` si hay vista), `fittedPoints` (línea), `forecastPoints` (discontinua; el último tiene `rangeApplies`), `baselineForecastPoints` (línea de referencia opcional) y `forecastRange.points` (banda) solo si `forecastRange.status==="available"`.
4. Junto al gráfico: `summary.lines` (máx. 3) o `summary.text`; el detalle en `validation`, `dataQuality`, `exclusions`, `model`, `config`.
5. No inferir "PR", "pico" ni "va a levantar": no están en el contrato.

```bash
# Demo aislada con un atleta de 30 semanas (BD nueva; se niega si el archivo existe)
npm run seed:synthetic -w @coaching/api -- ./data/demo-proyeccion.sqlite --with-projection
PORT=3119 DB_PATH=./data/demo-proyeccion.sqlite npm run dev -w @coaching/api
curl -s "localhost:3119/api/athletes" | head -c 300           # tomar el id de "DEMO H · serie larga (sintético)"
curl -s "localhost:3119/api/athletes/$ID/performance-projection?lift=SQ"
curl -s "localhost:3119/api/athletes/$ID/performance-projection?lift=SQ&variable=e1rm_prg_formulas&blockKey=LARGA-2&scope=view"
```

## Ejemplos (salida real sobre la demo sintética; recortados solo por longitud)

### Disponible (DEMO H, e1RM por curva)

```json
{
  "contractVersion": "performance-projection-v1",
  "engineVersion": "proyeccion-v0.1-experimental",
  "status": "available",
  "reasons": [],
  "cutoff": "2026-11-06",
  "periods": {
    "observed": {
      "from": "2026-05-26",
      "to": "2026-11-03"
    },
    "view": {
      "kind": "cutoff",
      "from": null,
      "to": null,
      "label": null
    },
    "training": {
      "from": "2026-05-26",
      "to": "2026-11-03",
      "scope": "history",
      "exposures": 24,
      "note": "Se ajusta con toda la historia disponible hasta el corte, incluso la anterior al período mostrado."
    }
  },
  "target": {
    "athleteId": "99fee3f8-9280-4b92-bf7c-fcdc46283296",
    "lift": "SQ",
    "exercise": "Squat comp",
    "variantKey": "Squat comp",
    "variable": "e1rm_table_rpe",
    "unit": "kg",
    "method": {
      "id": "table-rpe",
      "version": "rts-curva-default-v1"
    },
    "indicator": "e1RM por curva RPE (requiere RPE real)"
  },
  "selection": {
    "filters": {
      "lift": "SQ",
      "exercise": "Squat comp",
      "variantKey": "Squat comp"
    },
    "availableVariants": [
      {
        "exercise": "Squat comp",
        "variantKey": "Squat comp",
        "lift": "SQ",
        "exposures": {
          "e1rm_table_rpe": 24,
          "e1rm_prg_formulas": 30
        }
      }
    ]
  },
  "horizon": {
    "requestedDays": 28,
    "effectiveDays": 28,
    "fromDate": "2026-11-03",
    "forecastDate": "2026-12-01",
    "maxAllowedDays": 80,
    "limitedBy": null
  },
  "aggregation": {
    "id": "exposure-agg-v1",
    "mode": "best",
    "rule": "Un punto por exposición (fuente+sesión+ejercicio+variante). Series elegibles: de trabajo, carga total conocida, con los datos que exige el método. Valor = mejor e1RM (\"best\") o mediana (\"median\") de esas series; la cantidad de series no pondera."
  },
  "observedPoints": [
    {
      "date": "2026-05-26",
      "value": 138.72,
      "exposureKey": "plan|h-sq-7|Squat comp|Squat comp",
      "setIds": ["h-sq-7-1", "h-sq-7-2", "h-sq-7-3"],
      "nSets": 3,
      "nEligibleSets": 3,
      "alternateValue": 138.72,
      "availableOn": "2026-11-06",
      "inView": true,
      "outlier": {
        "flag": false,
        "score": -0.06
      }
    },
    {
      "date": "2026-06-02",
      "value": 135.64,
      "exposureKey": "plan|h-sq-8|Squat comp|Squat comp",
      "setIds": ["h-sq-8-1", "h-sq-8-2", "h-sq-8-3"],
      "nSets": 3,
      "nEligibleSets": 3,
      "alternateValue": 135.64,
      "availableOn": "2026-11-06",
      "inView": true,
      "outlier": {
        "flag": false,
        "score": -1.16
      }
    },
    {
      "…": "21 puntos más"
    },
    {
      "date": "2026-11-03",
      "value": 147.97,
      "exposureKey": "plan|h-sq-30|Squat comp|Squat comp",
      "setIds": ["h-sq-30-1", "h-sq-30-2", "h-sq-30-3"],
      "nSets": 3,
      "nEligibleSets": 3,
      "alternateValue": 147.97,
      "availableOn": "2026-11-06",
      "inView": true,
      "outlier": {
        "flag": false,
        "score": -2.06
      }
    }
  ],
  "fittedPoints": [
    {
      "date": "2026-05-26",
      "value": 151.05,
      "modelId": "baseline"
    },
    {
      "date": "2026-06-02",
      "value": 151.05,
      "modelId": "baseline"
    },
    {
      "…": "21 puntos más"
    },
    {
      "date": "2026-11-03",
      "value": 151.05,
      "modelId": "baseline"
    }
  ],
  "forecastPoints": [
    {
      "date": "2026-11-03",
      "horizonDays": 0,
      "value": 151.05,
      "modelId": "baseline",
      "rangeApplies": false
    },
    {
      "…": "puntos semanales intermedios"
    },
    {
      "date": "2026-12-01",
      "horizonDays": 28,
      "value": 151.05,
      "modelId": "baseline",
      "rangeApplies": true
    }
  ],
  "baselineForecastPoints": [
    {
      "date": "2026-11-03",
      "horizonDays": 0,
      "value": 151.05,
      "modelId": "baseline"
    },
    {
      "…": "puntos semanales intermedios"
    },
    {
      "date": "2026-12-01",
      "horizonDays": 28,
      "value": 151.05,
      "modelId": "baseline"
    }
  ],
  "forecastRange": {
    "status": "available",
    "reason": null,
    "method": "empirical-quantile-nearest-rank-v1",
    "nominalCoverage": 0.8,
    "observedCoverage": 0.4,
    "coverageSample": 5,
    "sampleSize": 18,
    "horizonToleranceDays": 7,
    "points": [
      {
        "date": "2026-12-01",
        "lower": 147.97,
        "upper": 163.38
      }
    ],
    "notice": "Rango empírico de errores históricos fuera de muestra; no es un intervalo de confianza y no garantiza cobertura futura."
  },
  "model": {
    "selected": {
      "id": "baseline",
      "version": "baseline-nivel-reciente-v1",
      "label": "Mantiene el nivel reciente"
    },
    "candidates": [
      {
        "id": "baseline",
        "version": "baseline-nivel-reciente-v1",
        "label": "Mantiene el nivel reciente",
        "params": {
          "levelK": 3,
          "pointsUsed": 3
        },
        "slopeKgPerWeek": 0,
        "levelKg": 151.05
      },
      {
        "id": "linear",
        "version": "tendencia-lineal-v1",
        "label": "Tendencia lineal",
        "params": {},
        "slopeKgPerWeek": 0.7022998981397098,
        "levelKg": 155.27
      },
      {
        "id": "linear_weighted",
        "version": "tendencia-lineal-ponderada-v1",
        "label": "Tendencia lineal con más peso a lo reciente",
        "params": {
          "halfLifeDays": 28
        },
        "slopeKgPerWeek": 0.26047381936981784,
        "levelKg": 151.86
      }
    ],
    "level": {
      "kg": 151.05,
      "definition": "mediana de las últimas 3 exposiciones",
      "pointsUsed": 3
    },
    "selectionRule": "Un modelo distinto del baseline solo se muestra con ≥ 8 evaluaciones, y si el selector anidado (fuera de muestra) tiene MAE menor y más victorias que derrotas frente al baseline; si no, se mantiene el baseline como referencia.",
    "selectionBasis": {
      "evaluationsUsed": 18,
      "minEvaluations": 8
    }
  },
  "validation": {
    "scheme": "origen móvil expansivo, horizonte en días reales desde la última exposición",
    "horizonDays": 28,
    "toleranceDays": 7,
    "evaluations": 18,
    "models": [
      {
        "id": "baseline",
        "n": 18,
        "maeKg": 4.795177421564601,
        "biasKg": -3.4251267296889996,
        "diffMaeVsBaselineKg": 0,
        "wins": 0,
        "losses": 0,
        "ties": 18
      },
      {
        "id": "linear",
        "n": 18,
        "maeKg": 6.274179844915882,
        "biasKg": 3.1510413950203304,
        "diffMaeVsBaselineKg": 1.4790024233512815,
        "wins": 8,
        "losses": 10,
        "ties": 0
      },
      {
        "id": "linear_weighted",
        "n": 18,
        "maeKg": 5.718052878528307,
        "biasKg": 2.8214307339577562,
        "diffMaeVsBaselineKg": 0.9228754569637063,
        "wins": 9,
        "losses": 9,
        "ties": 0
      }
    ],
    "selector": {
      "id": "selector",
      "n": 18,
      "maeKg": 7.108152010577247,
      "biasKg": -0.42712679473855214,
      "diffMaeVsBaselineKg": 2.3129745890126463,
      "wins": 0,
      "losses": 7,
      "ties": 11
    },
    "verdict": "sin_mejora",
    "coverage": {
      "origins": 24,
      "evaluable": 18,
      "abstentions": [
        {
          "reason": "entrenamiento insuficiente en el origen",
          "count": 3
        },
        {
          "reason": "sin observación posterior dentro del horizonte ± tolerancia",
          "count": 3
        }
      ]
    },
    "notes": [
      "Cada origen entrena solo con exposiciones de fecha ≤ origen; la selección de modelo usa solo pliegues con objetivo ya conocido en ese origen (selección anidada).",
      "Las fechas son las de EJECUCIÓN. Si no hay fecha de disponibilidad del registro, el replay no reconstruye exactamente qué sabía el coach en ese momento."
    ]
  },
  "dataQuality": {
    "exposures": 24,
    "spanDays": 161,
    "lastExposureAgeDays": 3,
    "stale": false,
    "irregularity": {
      "medianGapDays": 7,
      "maxGapDays": 7
    },
    "outliers": {
      "count": 0,
      "treatment": "Los atípicos se marcan, no se eliminan; se informa la sensibilidad del pronóstico.",
      "sensitivity": null
    },
    "missingRpeSets": 18,
    "sufficiency": "suficiente",
    "warnings": []
  },
  "exclusions": [
    {
      "reason": "sin RPE real registrado",
      "count": 18,
      "sampleIds": ["h-sq-1-1", "h-sq-1-2", "h-sq-1-3", "h-sq-2-1", "h-sq-2-2"]
    }
  ],
  "realMarks": [
    {
      "reps": 5,
      "kg": 127.5,
      "date": "2026-09-15",
      "setId": "h-sq-23-1",
      "rpe": 8
    }
  ],
  "reference": null,
  "summary": {
    "trend": {
      "label": "indeterminada",
      "basis": "No hay cambio mínimo relevante configurado para este movimiento: se describe el cambio sin clasificarlo.",
      "slopeKgPerWeek": 0.7022998981397098,
      "changeKgOverSpan": 16.152897657213327,
      "spanDays": 161
    },
    "projection": {
      "valueKg": 151.04808877928485,
      "horizonDays": 28,
      "date": "2026-12-01",
      "modelId": "baseline",
      "versusBaseline": "sin_mejora",
      "baselineKg": 151.04808877928485,
      "range": {
        "date": "2026-12-01",
        "lower": 147.97,
        "upper": 163.38
      }
    },
    "limitation": "Indicador experimental (e1RM estimado): no es un 1RM real ni una predicción de resultado.",
    "text": "Cambio de +16,2 kg en 23 semanas (e1RM por curva RPE, Squat comp), 24 exposiciones; sin cambio mínimo relevante configurado, no se clasifica. Si se mantiene el nivel reciente, el indicador se ubicaría en 151,0 kg a 28 días, rango empírico de errores históricos 148,0–163,4 kg. En la validación temporal ninguna tendencia mejoró a este baseline. Indicador experimental (e1RM estimado): no es un 1RM real ni una predicción de resultado.",
    "lines": [
      "Cambio de +16,2 kg en 23 semanas (e1RM por curva RPE, Squat comp), 24 exposiciones; sin cambio mínimo relevante configurado, no se clasifica.",
      "Si se mantiene el nivel reciente, el indicador se ubicaría en 151,0 kg a 28 días, rango empírico de errores históricos 148,0–163,4 kg. En la validación temporal ninguna tendencia mejoró a este baseline.",
      "Indicador experimental (e1RM estimado): no es un 1RM real ni una predicción de resultado."
    ]
  },
  "limitations": [
    "El indicador es un e1RM estimado del ejercicio/variante elegido: no equivale a un 1RM real, a un resultado de competencia ni al éxito de un intento.",
    "La proyección es condicional a que continúe el patrón observado; no considera cambios de volumen, intensidad, fatiga ni lesiones.",
    "…"
  ],
  "config": [
    {
      "id": "horizonDays",
      "value": 28,
      "default": 28,
      "overridden": false,
      "unit": "días",
      "note": "Horizonte pedido desde la última exposición observada.",
      "provenance": "propuesta (decisión operativa configurable, no validada)"
    },
    {
      "id": "minExposures",
      "value": 5,
      "default": 5,
      "overridden": false,
      "unit": "exposiciones",
      "note": "Mínimo de fechas distintas para proyectar; menos ⇒ solo descriptivo.",
      "provenance": "propuesta (decisión operativa configurable, no validada)"
    },
    {
      "id": "minEvaluations",
      "value": 8,
      "default": 8,
      "overridden": false,
      "unit": "evaluaciones",
      "note": "Mínimo para declarar mejora o elegir un modelo distinto del baseline.",
      "provenance": "propuesta (decisión operativa configurable, no validada)"
    },
    {
      "id": "rangeNominal",
      "value": 0.8,
      "default": 0.8,
      "overridden": false,
      "unit": "proporción",
      "note": "Cobertura nominal del rango empírico; no garantiza cobertura futura.",
      "provenance": "propuesta (decisión operativa configurable, no validada)"
    },
    {
      "…": "resto de decisiones operativas"
    }
  ]
}
```

### Solo descriptivo (DEMO F: horizonte pedido mayor que el permitido por el historial)

```json
{
  "status": "descriptive_only",
  "reasons": [
    {
      "code": "horizon_exceeds_history",
      "message": "El horizonte pedido (28 d) supera el máximo permitido por el historial (24 d)."
    }
  ],
  "horizon": {
    "requestedDays": 28,
    "effectiveDays": null,
    "fromDate": null,
    "forecastDate": null,
    "maxAllowedDays": 24,
    "limitedBy": "maxHorizonToSpanRatio"
  },
  "dataQuality": {
    "exposures": 8,
    "spanDays": 49,
    "lastExposureAgeDays": 2,
    "stale": false,
    "irregularity": {
      "medianGapDays": 7,
      "maxGapDays": 7
    },
    "outliers": {
      "count": 0,
      "treatment": "Los atípicos se marcan, no se eliminan; se informa la sensibilidad del pronóstico.",
      "sensitivity": null
    },
    "missingRpeSets": 0,
    "sufficiency": "suficiente",
    "warnings": []
  },
  "forecastPoints": [],
  "forecastRange": {
    "status": "unavailable",
    "reason": "sin proyección",
    "method": "empirical-quantile-nearest-rank-v1",
    "nominalCoverage": 0.8,
    "observedCoverage": null,
    "coverageSample": 0,
    "sampleSize": 0,
    "horizonToleranceDays": 7,
    "points": [],
    "notice": "Rango empírico de errores históricos fuera de muestra; no es un intervalo de confianza y no garantiza cobertura futura."
  },
  "summary": {
    "trend": {
      "label": "estable",
      "basis": "Cambio de la tendencia lineal comparado con el cambio mínimo relevante configurado del movimiento.",
      "slopeKgPerWeek": 0,
      "changeKgOverSpan": 0,
      "spanDays": 49
    },
    "projection": null,
    "limitation": "El horizonte pedido (28 d) supera el máximo permitido por el historial (24 d).",
    "text": "Tendencia estable (cambio por debajo del mínimo relevante configurado): +0,0 kg en 7 semanas (e1RM por curva RPE, Squat comp), 8 exposiciones. No se proyecta: El horizonte pedido (28 d) supera el máximo permitido por el historial (24 d). El horizonte pedido (28 d) supera el máximo permitido por el historial (24 d).",
    "lines": [
      "Tendencia estable (cambio por debajo del mínimo relevante configurado): +0,0 kg en 7 semanas (e1RM por curva RPE, Squat comp), 8 exposiciones.",
      "No se proyecta: El horizonte pedido (28 d) supera el máximo permitido por el historial (24 d).",
      "El horizonte pedido (28 d) supera el máximo permitido por el historial (24 d)."
    ]
  }
}
```

### Sin RPE real (método por curva no disponible)

```json
{
  "status": "unavailable",
  "reasons": [
    {
      "code": "no_rpe",
      "message": "Ninguna serie tiene RPE real: no hay e1RM por curva. Probá e1rm_prg_formulas (otro método, no comparable)."
    }
  ],
  "exclusions": [
    {
      "reason": "sin RPE real registrado",
      "count": 18,
      "sampleIds": ["h-sq-1-1", "h-sq-1-2", "h-sq-1-3", "h-sq-2-1", "h-sq-2-2"]
    }
  ],
  "summary": {
    "trend": {
      "label": "indeterminada",
      "basis": "Menos de 3 exposiciones con fecha distinta.",
      "slopeKgPerWeek": null,
      "changeKgOverSpan": null,
      "spanDays": null
    },
    "projection": null,
    "limitation": "Ninguna serie tiene RPE real: no hay e1RM por curva. Probá e1rm_prg_formulas (otro método, no comparable).",
    "text": "No hay una serie utilizable para describir una tendencia. No disponible: Ninguna serie tiene RPE real: no hay e1RM por curva. Probá e1rm_prg_formulas (otro método, no comparable). Ninguna serie tiene RPE real: no hay e1RM por curva. Probá e1rm_prg_formulas (otro método, no comparable).",
    "lines": [
      "No hay una serie utilizable para describir una tendencia.",
      "No disponible: Ninguna serie tiene RPE real: no hay e1RM por curva. Probá e1rm_prg_formulas (otro método, no comparable).",
      "Ninguna serie tiene RPE real: no hay e1RM por curva. Probá e1rm_prg_formulas (otro método, no comparable)."
    ]
  }
}
```

### Sin datos

```json
{
  "status": "unavailable",
  "reasons": [
    {
      "code": "no_data",
      "message": "No hay series de trabajo para ese filtro hasta el corte."
    }
  ],
  "selection": {
    "filters": {
      "lift": "DL"
    },
    "availableVariants": []
  },
  "summary": {
    "trend": {
      "label": "indeterminada",
      "basis": "Menos de 3 exposiciones con fecha distinta.",
      "slopeKgPerWeek": null,
      "changeKgOverSpan": null,
      "spanDays": null
    },
    "projection": null,
    "limitation": "Indicador experimental (e1RM estimado): no es un 1RM real ni una predicción de resultado.",
    "text": "No hay una serie utilizable para describir una tendencia. No disponible: No hay series de trabajo para ese filtro hasta el corte. Indicador experimental (e1RM estimado): no es un 1RM real ni una predicción de resultado.",
    "lines": [
      "No hay una serie utilizable para describir una tendencia.",
      "No disponible: No hay series de trabajo para ese filtro hasta el corte.",
      "Indicador experimental (e1RM estimado): no es un 1RM real ni una predicción de resultado."
    ]
  }
}
```

## Resultados con datos reales (solo lectura, en memoria)

Medido sobre el export personal de Hevy del coach (579 sesiones, 2023-06 a 2026-04), **sin importarlo, sin guardarlo y sin copiarlo al proyecto**; solo agregados. Horizonte 28 días, corte 2026-04-03, variante barra de mayor historia por movimiento:

| Movimiento   | Método    | Exposiciones    | Estado                                                           | Evaluaciones | MAE baseline (kg) | MAE selector − baseline (kg) | Veredicto    | Cobertura observada (nominal 0,8) |
| ------------ | --------- | --------------- | ---------------------------------------------------------------- | ------------ | ----------------- | ---------------------------- | ------------ | --------------------------------- |
| SQ           | fórmulas  | 245             | disponible                                                       | 224          | 27,1              | 0,0                          | sin mejora   | 0,70                              |
| BP           | fórmulas  | 259             | disponible                                                       | 239          | 11,4              | +0,34                        | sin mejora   | 0,76                              |
| DL           | fórmulas  | 105             | disponible                                                       | 88           | 28,2              | +1,56                        | sin mejora   | 0,75                              |
| SQ / BP / DL | curva RPE | 87 / 122 / 4–55 | solo descriptivo (dato obsoleto: último RPE real hace ~485 días) | 0            | —                 | —                            | no evaluable | —                                 |

Lectura honesta: **ninguna tendencia mejoró a “mantener el nivel reciente”**; en BP y DL el selector anidado empeoró levemente al baseline, por lo que se muestra el baseline. El error del baseline es grande (≈ 11–28 kg) porque el e1RM por fórmulas de una sesión depende del esquema de repeticiones del día; eso limita cualquier proyección con este indicador. Las coberturas observadas (0,70–0,76) quedan por debajo de la nominal: el rango es optimista. Esto es **evidencia de un solo atleta**, no una validación general.

## Sesiones y protocolos (cambios de esta versión)

Ver también `docs/frontend-handoff/API.md`. **Aditivo salvo lo marcado.**

- `GET /sessions` — ahora devuelve la sesión completa: cada serie con `plannedSetId` (id estable para registrar), `exposureId`, `exerciseName`, `lift`, `variantKey`, `segmentKey`, `isWarmup`, `retired`, `priority`, `refKg`, `copiedFrom`, `plannedKgSource` y `protocol`; además `exercises[]` (ejercicios de la sesión) y `segments[]` (top/backoff/work con sus `setIds`). **⚠ Cambio de comportamiento:** `sets` incluye las aproximaciones (`isWarmup:true`), que antes se omitían; quien cuente series debe filtrarlas. `retired:true` marca series que ya no están en la programación vigente pero se conservan por tener ejecución.
- `GET /plan?sessionKey&blockKey&weekNo&exposureId&from&to&includeActual` — **nuevo**: prescripción vigente íntegra con ids, `segmentKey`, `resolved{kg,source,missing}` (el motor resuelve %, RPE y tope) y `actual` vinculada; `baseVersionId`.
- `GET /plan-versions/:versionId` — **nuevo**: foto completa de una versión (aplicada o borrador): permite reabrir un borrador y auditar la publicación.
- `POST /program` — selección de `change_protocol` ampliada con `setIds` (series concretas) y `segmentKeys` (segmento = sesión+exposición+top/backoff/work); sigue estricta (clave desconocida ⇒ 400, selección vacía ⇒ 422). Operaciones **nuevas**: `remove_sets` (la vista previa avisa si las series tienen ejecución; esas se retiran de la programación pero su ejecución se conserva) y `add_sets` (series nuevas con vista previa; un id existente nunca se pisa ⇒ 422). Respuesta con `baseVersionId` y `warnings[]`.
- Control de concurrencia: `baseVersionId` opcional en la solicitud; si el plan cambió desde la vista previa, `draft/apply` responde **409** sin escribir. Omitirlo mantiene el comportamiento anterior.
- Contratos: `programOpSchema` (6 operaciones originales) no cambia; las nuevas están en `programOpFullSchema`/`ProgramOpFullInput` para no romper compilación del frontend.
- Registro: `POST /sets` sigue exigiendo series previstas existentes; ahora cualquier serie (copiada por el servidor, importada, creada en otro navegador) es registrable porque su id se lee de `GET /plan`/`GET /sessions`. La disponibilidad del registro (`updated_at`, revisión de creación) usa el reloj del servidor.
- Ejecución nunca se copia ni se reescribe: duplicar/repetir/aplicar plantilla no copia resultados, y las ediciones dejan revisión (`GET /revisions`). Linaje: `copiedFrom` + `exposureId` se conservan al duplicar.
- Aún pendiente: unicidad/edición de macros, detalle de meso vacío (404), desglose muscular planificado, sincronización de borradores de edición (el borrador de programación sí es recuperable con `GET /plan-versions/:id`).

## Limitaciones

Experimental; decisiones operativas sin validar; un indicador (e1RM) por vez; sin escenarios causales; horizonte desde la última exposición; rango empírico optimista en los datos reales medidos; el e1RM por fórmulas es sensible al esquema de repeticiones; sin fecha histórica de disponibilidad la validación usa fecha de ejecución.
