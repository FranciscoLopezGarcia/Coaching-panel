# Variables núcleo: NL, SI, tonelaje, volumen por grupo muscular y fatiga

Versión `nucleo-v1` (fatiga `fatiga-v2`, músculos `musculos-v2`, patrones `patrones-v1`, SI de RTS revisión `rts-si-r2`, tablas `rts-curva-default-v1` / `si-tablas-v1` / `prg-formulas-v1`).
Todo se calcula en el motor (`packages/engine`), sin I/O, y se expone por la API. **Solo lectura.** Todo es descriptivo: no hay umbrales inventados ni conclusiones; lo que no se puede calcular se informa como faltante y **no se rellena**.

## 1. Endpoint principal

`GET /api/athletes/:id/core?from=AAAA-MM-DD&to=AAAA-MM-DD[&cutoff=][&lift=SQ|BP|DL][&source=plan|hevy][&domain=recomendado|amplio][&view=weeks|sessions|all]`

| Parámetro        | Notas                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `from`, `to`     | obligatorios; `to` se recorta al corte                                                                                                                  |
| `cutoff`         | default hoy; **nada posterior entra**                                                                                                                   |
| `lift`, `source` | filtros opcionales (movimiento, origen del dato)                                                                                                        |
| `domain`         | dominio de la curva RPE para el e1RM por curva (el SI no depende de esto): `recomendado` reps 1–15 × RPE 4–10 (default) o `amplio` reps 1–50 × RPE 1–10 |
| `view`           | `weeks` (totales + semanas), `sessions` (totales + sesiones) o `all`. Un período de años con `all` pesa varios MB: usá `weeks` o rangos acotados        |

Respuesta (`CoreResult`): `version, fatigueVersion, cutoff, period, scope, domain, totals, muscles, sessions[], weeks[], definitions, warnings[]`. Errores: 400 parámetros inválidos, 404 atleta inexistente.

### Qué trae cada nivel

| Nivel                                                                                 | Contenido                                                                                                                                                            |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `totals`, `sessions[].totals`, `weeks[].totals`, `exercises[].metrics` (`CoreBundle`) | `nl`, `sets`, `tonnage`, `si.rts{total,central,peripheral}`, `si.prg`, `si.efort`, `e1rm.curve`, `e1rm.prg`. Cada uno `{value, unit, status, missing[], warnings[]}` |
| `muscles` / `…muscles` (`MuscleVolume`)                                               | por grupo: `directSets`, `indirectSets`, `equivalentSets`, `equivalentReps`, `equivalentTonnage`, `exercises`; más `unmappedExercises`                               |
| `sessions[].exercises[]`                                                              | un bloque por ejercicio+variante: métricas, `bestE1rm` (curva y fórmulas, separados), `medianRpe`, `topKg`, **`fatigueBetweenSets`**, **`vsPrevious`**               |
| `sessions[].fatigue`                                                                  | **fatiga entre sesiones**: `endFatigue`, `endFatigueDelta`, `readiness`, `daysSincePreviousSession`, `rolling`                                                       |
| `weeks[].fatigue`                                                                     | `endFatigue{mean,max,n}`, `meanDaysBetweenSessions`, `vsPreviousWeek`, `meanRpeDriftPerSession`                                                                      |

## 2. Definiciones (también en `definitions` de la respuesta)

- **NL** = Σ repeticiones de las series de trabajo (calentamiento excluido). No es la cantidad de series (`sets`).
- **Tonelaje** = Σ kg × reps de series con carga total interpretable. Mancuernas por lado, peso corporal sin carga añadida, asistidos y carga desconocida se **excluyen y se informan** (estado `partial`).
- **SI**: tres modelos con escala propia que **nunca se suman ni se comparan**: `rts-aprox-v1` (central/periférico/total; aproximación de RTS), `prg-si-v1` (requiere referencia de fuerza fechada) y `efort-xl-v1` (XL, RIR = 10 − RPE). Todos requieren **RPE real**; sin RPE el valor es parcial o no disponible, nunca se completa con el objetivo.
- **Patrón de movimiento** (`patrones-v1`, otra dimensión): sentadilla, bisagra de cadera, unilateral de pierna, empuje horizontal / vertical, tracción horizontal / vertical, aislamiento de pierna / brazos / hombro-espalda, core, transporte-olímpico. **Cada ejercicio pertenece a un solo patrón**, así que series, NL y tonelaje por patrón **sí suman** (a diferencia de los músculos). Viene en `patterns` (totales, sesión y semana) y en `exercises[].pattern`. Consulta de un ejercicio: `GET /api/tables/muscles/lookup?exercise=`.
- **Volumen por grupo muscular**: series directas ×1,0 e indirectas ×0,5 (`musculos-v2`, convención del proyecto, no la de Hevy). Se informan series equivalentes, repeticiones equivalentes y tonelaje equivalente por grupo. **No hay total entre músculos** (los grupos se superponen). 17 grupos y 80+ reglas por nombre (inglés, español y abreviaturas de powerlifting); un ejercicio sin regla queda sin mapear y se lista.
- **Fatiga entre series** (`fatiga-v2`; dentro de un ejercicio y una sesión; requiere el orden de las series). Cada serie se compara con las demás y con lo previsto:
  - **RPE**: `rpeVsPrevious`, `rpeVsFirst` y `rpeVsTarget` (RPE real − RPE objetivo de esa serie); resumen con `values`, `pattern` (solo el signo de los pasos: ascendente / estable / descendente / mixto), `maxStepUp`, pendiente por serie y cuántas series quedaron sobre / en / bajo el objetivo.
  - **Repeticiones**: `repsVsPrevious`, `repsVsFirst`, `repsLostVsBest` y, si la prescripción es un rango (`repsMax`), `repsVsTarget` (`sobre_rango` / `en_rango` / `bajo_rango` y la distancia). Resumen con `values`, `pattern`, `lostBestToLast`, rango previsto y recuento sobre / dentro / bajo. Con **carga fija** (`constantLoad`) la caída es fatiga pura y se informa `dropPct`; si la carga cambia se muestran igual pero marcadas.
  - **Carga, e1RM por serie** (curva y fórmulas, separados, con caída desde el máximo) y **SI por serie**.
  - Sin umbrales: no clasifica "fatiga alta". Ejemplos reales abajo.
- **Fatiga entre sesiones**: fatiga reportada al terminar la sesión (1–10) y su cambio; preparación (check-in) previa con su antigüedad; días desde la sesión anterior; cambios frente a la sesión anterior **del mismo ejercicio y variante** (e1RM por método, carga máxima, RPE mediano, NL, razón de SI); y carga acumulada: 7 días previos vs promedio semanal de los 28 previos (razón descriptiva de NL, tonelaje y SI, solo con ≥ 28 días de historia previa). Semana vs semana anterior solo si ambas están completas.

## 3. Ejemplos (salida real sobre el caso B del laboratorio, ficticio)

### Fatiga entre series: ejemplos (salida real de `fatigueBetweenSets` con la prescripción vinculada)

**3×3@7, RPE reales 6 – 7 – 7**

```json
{
  "version": "fatiga-v2",
  "status": "available",
  "reasons": [],
  "sets": [
    {
      "setNo": 1,
      "kg": 100,
      "reps": 3,
      "rpe": 6,
      "target": {
        "reps": 3,
        "repsMax": null,
        "rpe": 7,
        "kg": 100
      },
      "rpeVsTarget": -1,
      "rpeVsPrevious": null,
      "rpeVsFirst": null,
      "repsVsTarget": {
        "position": "en_rango",
        "delta": 0
      },
      "repsVsPrevious": null,
      "repsVsFirst": null,
      "repsLostVsBest": 0
    },
    {
      "setNo": 2,
      "kg": 100,
      "reps": 3,
      "rpe": 7,
      "target": {
        "reps": 3,
        "repsMax": null,
        "rpe": 7,
        "kg": 100
      },
      "rpeVsTarget": 0,
      "rpeVsPrevious": 1,
      "rpeVsFirst": 1,
      "repsVsTarget": {
        "position": "en_rango",
        "delta": 0
      },
      "repsVsPrevious": 0,
      "repsVsFirst": 0,
      "repsLostVsBest": 0
    },
    {
      "setNo": 3,
      "kg": 100,
      "reps": 3,
      "rpe": 7,
      "target": {
        "reps": 3,
        "repsMax": null,
        "rpe": 7,
        "kg": 100
      },
      "rpeVsTarget": 0,
      "rpeVsPrevious": 0,
      "rpeVsFirst": 1,
      "repsVsTarget": {
        "position": "en_rango",
        "delta": 0
      },
      "repsVsPrevious": 0,
      "repsVsFirst": 0,
      "repsLostVsBest": 0
    }
  ],
  "rpe": {
    "first": 6,
    "last": 7,
    "delta": 1,
    "pct": 16.666666666666664,
    "n": 3,
    "slopePerSet": 0.5,
    "values": [6, 7, 7],
    "pattern": "ascendente",
    "maxStepUp": 1,
    "vsTarget": {
      "above": 0,
      "at": 2,
      "below": 1,
      "n": 3
    }
  },
  "reps": {
    "first": 3,
    "last": 3,
    "delta": 0,
    "pct": 0,
    "values": [3, 3, 3],
    "pattern": "estable",
    "constantLoad": true,
    "lostBestToLast": 0,
    "dropPct": 0,
    "target": {
      "reps": 3,
      "repsMax": 3
    },
    "vsTarget": {
      "above": 0,
      "within": 3,
      "below": 0,
      "n": 3
    }
  },
  "notes": [
    "Descriptivo: sin umbral validado no se clasifica la fatiga. La velocidad de barra no está disponible."
  ]
}
```

**3×3@7, RPE reales 7 – 8 – 8,5** (resumen)

```json
{
  "sets": [
    {
      "setNo": 1,
      "rpe": 7,
      "rpeVsTarget": 0,
      "rpeVsPrevious": null,
      "rpeVsFirst": null
    },
    {
      "setNo": 2,
      "rpe": 8,
      "rpeVsTarget": 1,
      "rpeVsPrevious": 1,
      "rpeVsFirst": 1
    },
    {
      "setNo": 3,
      "rpe": 8.5,
      "rpeVsTarget": 1.5,
      "rpeVsPrevious": 0.5,
      "rpeVsFirst": 1.5
    }
  ],
  "rpe": {
    "first": 7,
    "last": 8.5,
    "delta": 1.5,
    "pct": 21.428571428571427,
    "n": 3,
    "slopePerSet": 0.75,
    "values": [7, 8, 8.5],
    "pattern": "ascendente",
    "maxStepUp": 1,
    "vsTarget": {
      "above": 2,
      "at": 1,
      "below": 0,
      "n": 3
    }
  }
}
```

**3×8-10 con carga fija, repeticiones 10 – 10 – 8** (resumen)

```json
{
  "sets": [
    {
      "setNo": 1,
      "kg": 80,
      "reps": 10,
      "repsVsTarget": {
        "position": "en_rango",
        "delta": 0
      },
      "repsVsPrevious": null,
      "repsLostVsBest": 0
    },
    {
      "setNo": 2,
      "kg": 80,
      "reps": 10,
      "repsVsTarget": {
        "position": "en_rango",
        "delta": 0
      },
      "repsVsPrevious": 0,
      "repsLostVsBest": 0
    },
    {
      "setNo": 3,
      "kg": 80,
      "reps": 8,
      "repsVsTarget": {
        "position": "en_rango",
        "delta": 0
      },
      "repsVsPrevious": -2,
      "repsLostVsBest": 2
    }
  ],
  "reps": {
    "first": 10,
    "last": 8,
    "delta": -2,
    "pct": -20,
    "values": [10, 10, 8],
    "pattern": "descendente",
    "constantLoad": true,
    "lostBestToLast": 2,
    "dropPct": 20,
    "target": {
      "reps": 8,
      "repsMax": 10
    },
    "vsTarget": {
      "above": 0,
      "within": 3,
      "below": 0,
      "n": 3
    }
  }
}
```

### Una sesión

```json
{
  "date": "2026-08-03",
  "source": "plan",
  "totals": {
    "nl": {
      "value": 15,
      "unit": "repeticiones",
      "status": "available",
      "missing": [],
      "warnings": ["NL es la suma de repeticiones, no la cantidad de series."]
    },
    "tonnage": {
      "value": 1912.5,
      "unit": "kg",
      "status": "available",
      "missing": [],
      "warnings": []
    },
    "si": {
      "rts": {
        "total": {
          "value": 4.14,
          "unit": "SI (rts-aprox-v1)",
          "status": "available",
          "missing": [],
          "warnings": [
            "Modelo rts-aprox-v1: aproximación experimental de RTS, no su fórmula exacta; no comparable con otros SI.",
            "Componente: total."
          ]
        },
        "model": "rts-aprox-v1"
      },
      "prg": {
        "value": 3.106315740045079,
        "status": "available",
        "missing": [],
        "model": "prg-si-v1"
      },
      "efort": {
        "value": 1169.6232042431322,
        "status": "available",
        "model": "efort-xl-v1"
      }
    }
  },
  "exercise": {
    "exerciseName": "Squat comp",
    "pattern": "sentadilla",
    "bestE1rm": {
      "curve": 150,
      "prg": 147
    },
    "medianRpe": 9.5,
    "topKg": 127.5,
    "fatigueBetweenSets": {
      "version": "fatiga-v2",
      "status": "available",
      "reasons": [],
      "sets": [
        {
          "setNo": 2,
          "kg": 127.5,
          "reps": 5,
          "rpe": 9.5,
          "target": {
            "reps": 5,
            "repsMax": null,
            "rpe": 8,
            "kg": 152.5
          },
          "rpeVsTarget": 1.5,
          "rpeVsPrevious": null,
          "rpeVsFirst": null,
          "repsVsTarget": {
            "position": "en_rango",
            "delta": 0
          },
          "repsVsPrevious": null,
          "repsVsFirst": null,
          "repsLostVsBest": 0
        },
        {
          "setNo": 3,
          "kg": 127.5,
          "reps": 5,
          "rpe": 9.5,
          "target": {
            "reps": 5,
            "repsMax": null,
            "rpe": 8,
            "kg": 152.5
          },
          "rpeVsTarget": 1.5,
          "rpeVsPrevious": 0,
          "rpeVsFirst": 0,
          "repsVsTarget": {
            "position": "en_rango",
            "delta": 0
          },
          "repsVsPrevious": 0,
          "repsVsFirst": 0,
          "repsLostVsBest": 0
        },
        {
          "setNo": 4,
          "kg": 127.5,
          "reps": 5,
          "rpe": 9.5,
          "target": {
            "reps": 5,
            "repsMax": null,
            "rpe": 8,
            "kg": 152.5
          },
          "rpeVsTarget": 1.5,
          "rpeVsPrevious": 0,
          "rpeVsFirst": 0,
          "repsVsTarget": {
            "position": "en_rango",
            "delta": 0
          },
          "repsVsPrevious": 0,
          "repsVsFirst": 0,
          "repsLostVsBest": 0
        }
      ],
      "rpe": {
        "first": 9.5,
        "last": 9.5,
        "delta": 0,
        "pct": 0,
        "n": 3,
        "slopePerSet": 0,
        "values": [9.5, 9.5, 9.5],
        "pattern": "estable",
        "maxStepUp": 0,
        "vsTarget": {
          "above": 3,
          "at": 0,
          "below": 0,
          "n": 3
        }
      },
      "reps": {
        "first": 5,
        "last": 5,
        "delta": 0,
        "pct": 0,
        "values": [5, 5, 5],
        "pattern": "estable",
        "constantLoad": true,
        "lostBestToLast": 0,
        "dropPct": 0,
        "target": {
          "reps": 5,
          "repsMax": 5
        },
        "vsTarget": {
          "above": 0,
          "within": 3,
          "below": 0,
          "n": 3
        }
      },
      "notes": [
        "Descriptivo: sin umbral validado no se clasifica la fatiga. La velocidad de barra no está disponible."
      ]
    },
    "vsPrevious": {
      "previousDate": "2026-07-27",
      "daysSince": 7,
      "e1rmCurvePct": -1.9230769230769211,
      "e1rmPrgPct": -2,
      "topKgDelta": -2.5,
      "medianRpeDelta": 0,
      "nlDelta": 0,
      "siRtsTotalRatio": 1
    }
  },
  "muscles": {
    "rows": [
      {
        "muscle": "cuadriceps",
        "directSets": 3,
        "indirectSets": 0,
        "equivalentSets": 3,
        "equivalentReps": 15,
        "equivalentTonnage": 1912.5,
        "exercises": ["Squat comp"]
      },
      {
        "muscle": "gluteos",
        "directSets": 3,
        "indirectSets": 0,
        "equivalentSets": 3,
        "equivalentReps": 15,
        "equivalentTonnage": 1912.5,
        "exercises": ["Squat comp"]
      },
      "…"
    ]
  },
  "patterns": {
    "convention": {
      "version": "patrones-v1"
    },
    "rows": [
      {
        "pattern": "sentadilla",
        "sets": 3,
        "nl": 15,
        "tonnage": 1912.5,
        "exercises": ["Squat comp"]
      }
    ],
    "unmappedExercises": [],
    "warnings": [
      "Cada ejercicio pertenece a un solo patrón (convención del proyecto): las filas se pueden sumar."
    ]
  },
  "fatigue": {
    "version": "fatiga-v2",
    "endFatigue": 9,
    "endFatigueDelta": 0,
    "readiness": {
      "value": 4.8,
      "date": "2026-08-02",
      "ageDays": 1
    },
    "daysSincePreviousSession": 4,
    "rolling": {
      "acute7": {
        "nl": 39,
        "tonnage": 4410,
        "siRtsTotal": 6.58908938176602,
        "sessions": 2
      },
      "chronicWeeklyMean28": {
        "nl": 39,
        "tonnage": 4453.125,
        "siRtsTotal": 6.073503131092423
      },
      "ratio": {
        "nl": 1,
        "tonnage": 0.9903157894736843,
        "siRtsTotal": 1.0848910817274675
      },
      "coverage": "historia previa ≥ 28 días"
    }
  }
}
```

### Una semana

```json
{
  "week": {
    "from": "2026-08-03",
    "to": "2026-08-09",
    "days": 7,
    "partial": false
  },
  "sessions": 2,
  "trainingDays": 2,
  "totals": {
    "nl": {
      "value": 39,
      "unit": "repeticiones",
      "status": "available",
      "missing": [],
      "warnings": ["NL es la suma de repeticiones, no la cantidad de series."]
    },
    "tonnage": {
      "value": 4312.5,
      "unit": "kg",
      "status": "available",
      "missing": [],
      "warnings": []
    },
    "si": {
      "rts": {
        "total": {
          "value": 6.75,
          "unit": "SI (rts-aprox-v1)",
          "status": "available",
          "missing": [],
          "warnings": [
            "Modelo rts-aprox-v1: aproximación experimental de RTS, no su fórmula exacta; no comparable con otros SI.",
            "Componente: total."
          ]
        },
        "model": "rts-aprox-v1"
      },
      "prg": {
        "value": 3.106315740045079,
        "status": "partial",
        "missing": [],
        "model": "prg-si-v1"
      },
      "efort": {
        "value": 2091.7305856628286,
        "status": "available",
        "model": "efort-xl-v1"
      }
    }
  },
  "patterns": [
    {
      "pattern": "sentadilla",
      "sets": 6,
      "nl": 39,
      "tonnage": 4312.5,
      "exercises": ["Squat comp", "Squat pausa"]
    }
  ],
  "fatigue": {
    "endFatigue": {
      "mean": 9,
      "max": 9,
      "n": 1
    },
    "meanDaysBetweenSessions": 3.5,
    "vsPreviousWeek": {
      "nl": 1,
      "tonnage": 0.9778911564625851,
      "siRtsTotal": 1.0244207672579562,
      "comparable": true,
      "reason": null
    },
    "meanRpeDriftPerSession": 0
  }
}
```

## 4. Tablas (completas, con los rangos más amplios que respalda la fuente)

Índice: `GET /api/tables`. Todas son de solo lectura y no dependen de un atleta.

| Ruta                                               | Contenido y rango                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/tables/rpe`                                  | %1RM por **reps 1–50 × RPE 1–10 (pasos de 0,5)**; 860 de 950 celdas (las demás tendrían reps + 10 − RPE > 50, fuera de la curva). Origen por celda: `medido-rts` (170 combinaciones medidas en la app) o `derivado-curva`; compara con la tabla anterior del proyecto |
| `/api/tables/rm`                                   | nRM: %1RM para n = 1–50 repeticiones al fallo; `/rm/inverse?pct=` da las repeticiones posibles para un %1RM                                                                                                                                                           |
| `/api/tables/load?e1rm=&stepKg=`                   | kg para cada reps × RPE dado un e1RM, redondeado hacia abajo al paso de carga                                                                                                                                                                                         |
| `/api/tables/formulas`                             | %1RM de cada fórmula de PRG (Epley, Brzycki, Lander, Lombardi, Mayhew, O’Conner) y del promedio, **reps 1–36**; 2–10 es el dominio de la app PRG, el resto se rotula `extrapolacion-matematica` (Brzycki y Lander se acercan a su singularidad en 37)                 |
| `/api/tables/prg-rpe`                              | tabla RPE×reps de PRG (reps 1–12) con **RPE 0,5–10** (6–10 originales, por debajo la extrapolación de la app) y su diferencia frente a RTS (38 celdas divergen)                                                                                                       |
| `/api/tables/si/rts`                               | SI de RTS (central, periférico, total), reps 1–50 × RPE 1–10; **170 celdas medidas** y el resto aproximado; error de la aproximación en las medidas                                                                                                                   |
| `/api/tables/si/efort` , `/si/efort-curve`         | XL por kg (reps 1–50 × RPE 1–10) y curva continua de eFort (h = 1–50)                                                                                                                                                                                                 |
| `/api/tables/si/prg?pctFrom&pctTo&pctStep&repsMax` | SI de PRG por % de la referencia × reps (1–50) × RPE 1–10; default 30–110 % en pasos de 5 y reps 1–30                                                                                                                                                                 |

### Muestras reales de las tablas

```json
{
  "rpe": {
    "version": "rts-curva-default-v1",
    "stats": {
      "cells": 950,
      "available": 860,
      "byOrigin": {
        "derivado-curva": 690,
        "medido-rts": 170
      }
    },
    "legacyTable": {
      "cells": 195,
      "divergent": 107,
      "maxAbsDiff": 0.167,
      "firstDivergentH": 10.5
    },
    "rpes": [1, 1.5, 2, 2.5, "…"],
    "rows (reps 5)": [
      {
        "reps": 5,
        "rpe": 7,
        "h": 8,
        "pct": 0.786,
        "origin": "medido-rts",
        "legacyProyecto": 0.7859999999999999,
        "legacyDiff": 0
      },
      {
        "reps": 5,
        "rpe": 7.5,
        "h": 7.5,
        "pct": 0.798,
        "origin": "medido-rts",
        "legacyProyecto": 0.799,
        "legacyDiff": -0.001
      },
      {
        "reps": 5,
        "rpe": 8,
        "h": 7,
        "pct": 0.811,
        "origin": "medido-rts",
        "legacyProyecto": 0.8109999999999999,
        "legacyDiff": 0
      },
      {
        "reps": 5,
        "rpe": 8.5,
        "h": 6.5,
        "pct": 0.824,
        "origin": "medido-rts",
        "legacyProyecto": 0.8240000000000001,
        "legacyDiff": 0
      }
    ]
  },
  "siRts": {
    "model": "rts-aprox-v1",
    "validation": {
      "measuredCells": 170,
      "maxAbsError": {
        "central": 0.02,
        "peripheral": 0.3,
        "total": 0.15
      },
      "meanAbsError": {
        "central": 0,
        "peripheral": 0.01,
        "total": 0.01
      }
    },
    "cell 7 reps @ RPE 6,5": {
      "reps": 7,
      "rpe": 6.5,
      "central": 0.34,
      "peripheral": 0.75,
      "total": 0.54,
      "origin": "medido-rts",
      "approx": {
        "central": 0.34,
        "peripheral": 0.75,
        "total": 0.54
      },
      "error": {
        "central": 0,
        "peripheral": 0,
        "total": 0
      }
    },
    "cell 13 reps @ RPE 7,5": {
      "reps": 13,
      "rpe": 7.5,
      "central": 0.2,
      "peripheral": 1,
      "total": 0.6,
      "origin": "aproximado"
    }
  },
  "formulas": {
    "version": "prg-formulas-v1",
    "row reps 5": {
      "reps": 5,
      "origin": "app-prg",
      "pct": {
        "epley": 85.71,
        "brzycki": 88.89,
        "lander": 87.94,
        "lombardi": 85.13,
        "mayhew": 84.03,
        "oconner": 88.89
      },
      "pctAverage": 86.72,
      "factorAverage": 1.1531
    },
    "row reps 20": {
      "reps": 20,
      "origin": "extrapolacion-matematica",
      "pct": {
        "epley": 60,
        "brzycki": 47.22,
        "lander": 47.88,
        "lombardi": 74.11,
        "mayhew": 66.15,
        "oconner": 66.67
      },
      "pctAverage": 58.63,
      "factorAverage": 1.7057
    }
  }
}
```

## 4b. SI de RTS: revisión `rts-si-r2`

El SI de RTS no es una fórmula publicada: RTS lo calcula en su servidor. Se mantiene el id `rts-aprox-v1` y ahora se reproduce así: **si (reps, RPE) es una de las 170 combinaciones medidas en la app real, se devuelve el valor medido tal cual (exacto a 2 decimales)**; fuera de ellas rige la fórmula, corregida: el periférico dejaba de decaer mal a RPE bajo (acotando el RIR en 5, el error en RPE < 5 pasó de 0,30 a ≈ 0,006). Error de la fórmula contra las 170 mediciones: central ≤ 0,016, periférico ≤ 0,006, total ≤ 0,010. Es lo más cerca de RTS que se puede llegar sin su código; ampliar las mediciones (por ejemplo, otras repeticiones intermedias) reduce el uso de la fórmula.

## 5. Corrección importante de la curva RPE

La tabla que usaba el motor (`rpe-proyecto-v1`, reps 1–15 × RPE 4–10) **coincidía con la curva de RTS solo hasta h = reps + 10 − RPE = 10**; en 107 de sus 195 celdas por encima de ese valor divergía (por ejemplo 12 reps @10: 68,0 % contra 70,7 %), un error de copia heredado de PRG. `LEEME_DECISIONES` ya decía "se usa la curva real de RTS". Ahora **`rts-curva-default-v1`** usa la curva (verificada contra 170 mediciones de la app). Efecto: el e1RM por curva cambia solo en series con h > 10 (por ejemplo muchas repeticiones con RPE bajo); el resto es idéntico. La tabla anterior se conserva solo para comparar (`legacyProyecto` por celda).

## 6. Validación

- **Sintética** (tests): tablas (monotonía, dimensiones, celdas medidas contra la curva, fórmulas contra los valores verificados de PRG, SI contra mediciones), núcleo (NL/tonelaje/SI/músculos/fatiga con casos construidos) y API sobre el laboratorio ficticio (NL semanal 50 en E; deterioro en B; faltantes en D; corte sin fuga).
- **Datos reales (solo lectura, en memoria, sin importar ni copiar):** el export personal de Hevy (579 sesiones, 2023–2026) se calcula completo en ~2 s, sin NaN; NL 82 064 `available`, tonelaje `partial` (cargas por lado y peso corporal excluidas), SI parcial (solo series con RPE); la convención muscular mapea los 188 ejercicios (12 107 series, 0 sin mapear); 2 267 de 2 560 bloques ejercicio-sesión tienen fatiga entre series disponible (los demás tienen una sola serie).
- **Aproximación de SI de RTS:** error absoluto máximo en las celdas medidas — central 0,02, periférico 0,30, total 0,15 (error medio ≤ 0,01).

## 7. Límites

- La convención muscular es del proyecto y no está verificada contra el mapeo interno de Hevy; ante un nombre desconocido el ejercicio queda sin mapear.
- El SI de RTS fuera de las 170 celdas medidas es una aproximación; PRG y eFort son fórmulas recuperadas del código.
- No hay velocidad de barra ni duración/descanso entre series: la fatiga entre series es descriptiva a partir de RPE, repeticiones, carga y e1RM. Sin umbrales validados no se clasifica.
- El orden de las series de Hevy viene de `set_index`; en datos sin orden la fatiga entre series no se calcula.
- La razón agudo/crónico es descriptiva (no es un umbral ni una predicción); CTL/ATL siguen sin implementarse por evidencia contradictoria.

## 8. Para el frontend (coordinación)

- **Grupo muscular vs patrón de movimiento**: hoy la pantalla de análisis ofrece "Por movimiento" (ejercicio + variante) y "Por grupo muscular". El backend agrega una tercera dimensión, **patrón de movimiento** (`patterns`), distinta de ambas: los músculos se superponen (un ejercicio aporta a varios, no se suman); los patrones no (suman). Decisión de UX pendiente: qué mostrar por defecto y si hace falta un selector. La convención de grupos y patrones se inspecciona en `/api/tables/muscles` y `/api/tables/muscles/lookup?exercise=`.
- **Fatiga entre series**: cada `sets[]` ya trae las comparaciones listas para dibujar (vs anterior, vs primera, vs objetivo, vs rango); `rpe.pattern` / `reps.pattern` describen la forma sin umbrales.
- **Rangos de repeticiones**: se guardan en `protocol.repsMax` (reps = mínimo). Las sesiones creadas con `POST /plan` o `POST /program` pueden enviarlo; el CSV canónico (`3x8-10x100`) lo llena solo.
- **Tipos**: `BetweenSets.reps.constantLoad` pasó de literal `true` a `boolean`; `SetPoint` suma campos; `ExerciseBlock` suma `pattern`; `CoreResult`, `SessionRow` y `WeekRow` suman `patterns`.
