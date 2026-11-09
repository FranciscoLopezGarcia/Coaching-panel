# Ejemplos (salida REAL de la API sobre la demo sintética)

Cada bloque se generó llamando a la API con la base sintética (fecha fija 2026-03-10) y se recortó solo por longitud (marcado). Los ids cambian en cada siembra. **Datos 100 % inventados.**
Para reproducir: `npm run seed:synthetic -w @coaching/api -- ./data/demo-sintetica.sqlite` y `DB_PATH=./data/demo-sintetica.sqlite npm run dev:api`.

## 1. Resumen del atleta (lista)

Una fila por atleta con el estado principal por lift. `sufficiency` reemplaza a `confidence`.

`GET /api/athletes`

```json
{
  "id": "bb8d7a39-3fa1-44d6-956d-1e195cd487c9",
  "name": "DEMO A · progresa (sintético)",
  "lastRecord": "2026-03-08",
  "evaluatedOn": "2026-03-10",
  "lifts": {
    "SQ": {
      "status": "ventana_expresion",
      "summary": "Ventana favorable según el motor propio (modo B): se cumplen las 5 condiciones. Es una ventana favorable observada: no es un pico fisiológico confirmado ni una predicción.",
      "sufficiency": "parcial",
      "dataUntil": "2026-03-08"
    },
    "BP": {
      "status": "candidato_pr",
      "summary": "Oportunidad potencial, pendiente validar: 102,5 kg × 5 @ RPE 9 (récord previo 100 kg).",
      "sufficiency": "parcial",
      "dataUntil": "2026-03-07"
    },
    "DL": {
      "status": "posible_fin_respuesta",
      "summary": "Posible meseta: 6 exposiciones durante 5 semanas con rango de E 0 kg (0 %), por debajo del cambio mínimo, con un objetivo de progreso y sin cambios de estímulo.",
      "sufficiency": "parcial",
      "dataUntil": "2026-03-06"
    }
  },
  "pendingDecisions": 3
}
```

## 2. Macro con mesos

Macro activo con mesos (duración variable, `closed` según fechas).

`GET /api/athletes/:id/macros/active`

```json
{
  "id": "242cac9d-fc71-4d2a-91cf-23cc663b1f71",
  "name": "Macro de DEMO A",
  "status": "activo",
  "startDate": "2026-01-30",
  "endDate": null,
  "objective": "demostración",
  "durationWeeks": 8,
  "mesos": [
    {
      "blockKey": "FUERZA-1",
      "name": "Meso FUERZA-1",
      "startDate": "2026-01-30",
      "endDate": "2026-03-15",
      "durationWeeks": 6,
      "closed": false
    },
    {
      "blockKey": "ACUM-1",
      "name": "Meso ACUM-1",
      "startDate": "2026-02-01",
      "endDate": "2026-03-08",
      "durationWeeks": 5,
      "closed": true
    },
    {
      "blockKey": "ACUM-2",
      "name": "Meso ACUM-2",
      "startDate": "2026-03-15",
      "endDate": "2026-03-29",
      "durationWeeks": 2,
      "closed": false
    }
  ],
  "activeMeso": "FUERZA-1"
}
```

## 3. Protocolo mixto (request de `POST /api/athletes/:id/plan`)

Top set por RPE con tope + back-off por % de la referencia (`refKg` 150 → 120 kg). El cliente NO calcula kg: los resuelve el motor.

`POST /api/athletes/:id/plan`

```json
{
  "sets": [
    {
      "sessionKey": "s1",
      "slotKey": "squat|D1",
      "exerciseName": "Squat comp",
      "lift": "SQ",
      "plannedDate": "2026-03-02",
      "reps": 5,
      "targetRpe": 8.5,
      "blockKey": "M1",
      "weekNo": 1,
      "dayNo": 1,
      "familyKey": "F1",
      "refKg": 150,
      "exposureId": "sq-primaria",
      "variantKey": "Squat comp",
      "id": "s1-1",
      "setNo": 1,
      "plannedKg": null,
      "protocol": {
        "loadMode": "rpe_cap",
        "capKg": 120,
        "segment": "top",
        "instructions": "Subir hasta RPE 8,5 sin pasar de 120 kg"
      }
    },
    {
      "sessionKey": "s1",
      "slotKey": "squat|D1",
      "exerciseName": "Squat comp",
      "lift": "SQ",
      "plannedDate": "2026-03-02",
      "reps": 5,
      "targetRpe": 8,
      "blockKey": "M1",
      "weekNo": 1,
      "dayNo": 1,
      "familyKey": "F1",
      "refKg": 150,
      "exposureId": "sq-primaria",
      "variantKey": "Squat comp",
      "id": "s1-2",
      "setNo": 2,
      "plannedKg": null,
      "protocol": {
        "loadMode": "pct",
        "pct": 80,
        "segment": "backoff",
        "tempo": "3-1-0",
        "pauseSec": 2
      }
    },
    {
      "sessionKey": "s1",
      "slotKey": "squat|D1",
      "exerciseName": "Squat comp",
      "lift": "SQ",
      "plannedDate": "2026-03-02",
      "reps": 5,
      "targetRpe": 8,
      "blockKey": "M1",
      "weekNo": 1,
      "dayNo": 1,
      "familyKey": "F1",
      "refKg": 150,
      "exposureId": "sq-primaria",
      "variantKey": "Squat comp",
      "id": "s1-3",
      "setNo": 3,
      "plannedKg": null,
      "protocol": {
        "loadMode": "pct",
        "pct": 80,
        "segment": "backoff"
      }
    }
  ],
  "status": "aplicado",
  "label": "Semana 1"
}
```

## 3b. Respuesta del plan

Resultado de la importación (versión y evento).

`POST /api/athletes/:id/plan`

```json
{
  "changed": true,
  "status": "aplicado",
  "version": {
    "id": "f7118c2f",
    "seq": 1
  },
  "event": null,
  "note": "Primera versión: no hay versión previa con la que comparar (historial incompleto).",
  "retired": 0,
  "deleted": 0,
  "warnings": []
}
```

## 4. Microciclos y sesiones

Microciclos con fechas explícitas y sesiones con previsto vs realizado (`actual: null` = sin registro).

`GET /api/athletes/:id/microcycles · GET /api/athletes/:id/sessions`

```json
{
  "microcycles": [
    {
      "blockKey": "M1",
      "weekNo": 1,
      "startDate": "2026-03-02",
      "endDate": "2026-03-08"
    }
  ],
  "sessions": [
    {
      "sessionKey": "s1",
      "date": "2026-03-02",
      "lift": "SQ",
      "exerciseName": "Squat comp",
      "blockKey": "M1",
      "weekNo": 1,
      "dayNo": 1,
      "endFatigue": null,
      "sets": [
        {
          "setNo": 1,
          "planned": {
            "reps": 5,
            "targetRpe": 8.5,
            "kg": 120
          },
          "actual": null
        },
        {
          "setNo": 2,
          "planned": {
            "reps": 5,
            "targetRpe": 8,
            "kg": 120
          },
          "actual": null
        },
        {
          "setNo": 3,
          "planned": {
            "reps": 5,
            "targetRpe": 8,
            "kg": 120
          },
          "actual": null
        }
      ]
    }
  ]
}
```

## 5. Vista previa de una operación de programación (no guarda)

Diferencias clasificadas + disponibilidad de métricas previstas. `saved: null`.

`POST /api/athletes/:id/program  {mode:"preview"}`

```json
{
  "mode": "preview",
  "preview": {
    "event": {
      "id": "actual->propuesta",
      "versionA": "actual",
      "versionB": "propuesta",
      "detectedOn": "9999-12-31",
      "effectiveOn": "2026-03-09",
      "effectiveEstimated": true,
      "status": "borrador",
      "actor": null,
      "changes": [
        {
          "lift": "SQ",
          "blockKey": "M1",
          "classification": "cambio_duracion",
          "tags": [
            "duracion"
          ],
          "deltas": [
            {
              "variable": "NL por semana",
              "unit": "reps",
              "before": 15,
              "after": 15,
              "delta": 0,
              "pct": 0,
              "note": "NL = Σ repeticiones; no es la cantidad de series"
            },
            {
              "variable": "Series por semana",
              "unit": "series",
              "before": 3,
              "after": 3,
              "delta": 0,
              "pct": 0
            },
            {
              "variable": "Frecuencia",
              "unit": "sesiones/semana",
              "before": 1,
              "after": 1,
              "delta": 0,
              "pct": 0
            },
            {
              "variable": "Duración del bloque",
              "unit": "semanas",
              "before": 1,
              "after": 2,
              "delta": 1,
              "pct": 100
            },
            {
              "variable": "NL total del bloque",
              "unit": "reps",
              "before": 15,
              "after": 30,
              "delta": 15,
              "pct": 100,
              "note": "total bruto; comparar con la dosis semanal"
            },
            {
              "variable": "Carga media",
              "unit": "kg",
              "before": 120,
              "after": 120,
              "delta": 0,
              "pct": 0
            },
            {
              "variable": "Intensidad relativa media",
              "unit": "% ref",
              "before": 80.00000000000001,
              "after": 80.00000000000001,
              "delta": 0,
              "pct": 0,
              "note": "depende de la referencia fechada"
            },
            {
              "variable": "RPE objetivo medio",
              "unit": "RPE",
              "before": 8.166666666666666,
              "after": 8.166666666666666,
              "delta": 0,
              "pct": 0
            },
            {
              "variable": "SI total",
              "unit": "SI (rts-aprox-v1)",
              "before": 2.745723533771134,
  // … recortado para el documento
```

## 6. Comparativa semanal

Semana B parcial: se compara dosis por semana y se marca `partial`.

`GET /api/athletes/:id/week-compare?lift=SQ`

```json
{
  "a": {
    "period": {
      "from": "2026-03-02",
      "to": "2026-03-08"
    },
    "days": 7,
    "weeks": 1,
    "partial": false
  },
  "b": {
    "period": {
      "from": "2026-03-09",
      "to": "2026-03-10"
    },
    "days": 2,
    "weeks": 0.2857142857142857,
    "partial": true
  },
  "scope": {
    "lift": "SQ"
  },
  "rows": [
    {
      "metricId": "nl",
      "unit": "repeticiones",
      "a": 15,
      "b": null,
      "aPerWeek": 15,
      "bPerWeek": null,
      "diff": null,
      "diffPerWeek": null,
      "statusA": "available",
      "statusB": "unavailable",
      "note": "falta series de trabajo con repeticiones"
    },
    {
      "metricId": "sets",
      "unit": "series",
      "a": 3,
      "b": null,
      "aPerWeek": 3,
      "bPerWeek": null,
      "diff": null,
      "diffPerWeek": null,
      "statusA": "available",
      "statusB": "unavailable",
      "note": "falta series de trabajo"
    }
  ],
  "notes": [
    "Los períodos duran 7 y 2 días: la comparación válida es la dosis POR SEMANA; los totales no son comparables entre sí.",
    "Al menos un período es parcial (semana incompleta o recortada por el corte).",
    "Universo REALIZADO. Los dos métodos de e1RM y los modelos de SI van separados y no se unen."
  ],
  "normalizedPerDay": [
    {
      "metricId": "nl",
      "previous": 2.142857142857143,
      "current": null
    },
    {
      "metricId": "sets",
      "previous": 0.42857142857142855,
      "current": null
    }
  ]
}
```

## 7a. Métrica parcial

Disponible con salvedades: `warnings` explican el límite (no es un error).

`GET /api/athletes/:id/metrics`

```json
{
  "frequency": {
    "status": "partial",
    "value": 0.20289855072463767,
    "period": {
      "from": "2026-01-01",
      "to": "2026-03-10",
      "days": 69,
      "weeks": 9.857142857142858,
      "partial": true
    },
    "scope": {
      "athleteId": "71324aa2-b6a3-4dea-8150-93f17709142a",
      "lift": "SQ"
    },
    "usedRecords": [
      {
        "kind": "session",
        "id": "2026-02-23",
        "date": "2026-02-23"
      },
      {
        "kind": "session",
        "id": "2026-03-02",
        "date": "2026-03-02"
      }
    ],
    "excluded": [],
    "missing": [],
    "reference": null,
    "baseline": null,
    "warnings": [
      "Cuenta días con exposición; un día sin registro no es un descanso confirmado.",
      "Período parcial: la frecuencia semanal se normaliza por los días considerados."
    ],
    "metricId": "frequency",
    "unit": "días/semana",
    "method": {
      "id": "distinct-days",
      "version": "v1"
    },
    "cutoff": "2026-03-10"
  }
}
```

## 7b. Métrica no disponible

Sin dato requerido: `value: null`, `missing` y motivo. Nunca se rellena.

`GET /api/athletes/:id/metrics`

```json
{
  "intensity_rel": {
    "status": "unavailable",
    "value": null,
    "period": {
      "from": "2026-01-01",
      "to": "2026-03-10",
      "days": 69,
      "weeks": 9.857142857142858,
      "partial": true
    },
    "scope": {
      "athleteId": "71324aa2-b6a3-4dea-8150-93f17709142a",
      "lift": "SQ"
    },
    "usedRecords": [],
    "excluded": [
      {
        "reason": "sin referencia de fuerza vigente a esa fecha (6 series)",
        "ref": {
          "kind": "set",
          "id": "c-sq-B1-1-1",
          "date": "2026-02-23"
        }
      }
    ],
    "missing": ["referencia de fuerza fechada"],
    "reference": null,
    "baseline": null,
    "warnings": [],
    "metricId": "intensity_rel",
    "unit": "% de la referencia",
    "method": {
      "id": "kg-over-reference",
      "version": "v1"
    },
    "cutoff": "2026-03-10"
  }
}
```

## 8a. Recomendación (decisión principal, recortada)

Contrato de decisión: regla+versión, suficiencia, ciclo de vida.

`GET /api/athletes/:id/decisions`

```json
{
  "key": "BP|bp-primaria|R-PR|2026-03-07|reglas-v0.2-propuesta",
  "lift": "BP",
  "exposureId": "bp-primaria",
  "status": "candidato_pr",
  "ruleId": "R-PR",
  "rulesVersion": "reglas-v0.2-propuesta",
  "paramsVersion": "params-v2",
  "isPrincipal": true,
  "sufficiency": "parcial",
  "lifecycle": "detectada",
  "validity": "vigente",
  "missing": ["Chequeo actual: check-in de ≤ 2 días o revisión del coach vigente."],
  "summary": "Oportunidad potencial, pendiente validar: 102,5 kg × 5 @ RPE 9 (récord previo 100 kg)."
}
```

## 8b. Evidencia y explicación

Qué/por qué/qué revisar/límites, evidencias con origen y dependencias, registros usados.

`GET /api/athletes/:id/recommendations/:key/evidence`

```json
{
  "key": "BP|bp-primaria|R-PR|2026-03-07|reglas-v0.2-propuesta",
  "explanation": {
    "ruleId": "R-PR",
    "ruleVersion": "reglas-v0.2-propuesta",
    "paramsVersion": "params-v2",
    "context": {
      "lift": "BP",
      "exposureId": "bp-primaria",
      "cutoff": "2026-03-10",
      "period": {
        "from": "2026-02-21",
        "to": "2026-03-07"
      },
      "objective": null
    },
    "conclusion": "Oportunidad potencial, pendiente validar: 102,5 kg × 5 @ RPE 9 (récord previo 100 kg).",
    "whatHappens": "Oportunidad potencial, pendiente validar: 102,5 kg × 5 @ RPE 9 (récord previo 100 kg).",
    "why": [
      "Repeticiones del intento: 5 reps",
      "RPE objetivo del intento: 9 RPE",
      "Paso de carga: 2,5 kg",
      "Récord previo: 100 kg",
      "Carga candidata con RPE +0: 105 kg",
      "Carga candidata con RPE +0,5: 102.5 kg",
      "Carga candidata con RPE +1: 102,5 kg"
    ],
    "reviewOrTry": [
      "Evaluar 102,5 kg × 5 reps @ RPE 9 sobre un récord de 100 kg, condicionado a la respuesta del calentamiento y a la validación del coach. Aprobar la propuesta no implica ejecutarla. No es una probabilidad de éxito."
    ],
    "limits": [
      "Una oportunidad de récord no es una probabilidad de éxito ni autoriza un intento.",
      "Las lecturas con RPE desplazado son escenarios de sensibilidad, no un intervalo de confianza.",
      "Un mejor e1RM no es un récord real.",
      "Faltan datos: Chequeo actual: check-in de ≤ 2 días o revisión del coach vigente.."
    ],
    "nextCheck": {
      "when": "Antes de la sesión, con el chequeo del día.",
      "criterion": "Chequeo del día del intento (check-in o revisión del coach)."
    },
    "assessment": {
      "sufficiency": "parcial",
      "recency": "vigente",
      "comparability": "comparable",
      "independentGroups": 3,
      "items": 4,
      "correlationNote": "4 evidencias derivan de 3 grupos de datos: las que comparten series cuentan como una sola confirmación, no como varias.",
      "reasons": [
        "Faltan datos: Chequeo actual: check-in de ≤ 2 días o revisión del coach vigente.."
      ]
    },
    "evidence": [
      {
        "id": "R-PR:e1rm",
        "origin": "rendimiento",
        "label": "e1RM por curva de las exposiciones usadas (mejor serie de cada una)",
        "value": 127.22646310432572,
        "unit": "kg",
        "refs": [
          {
            "kind": "session",
            "id": "a-bp-FUERZA-1-2",
            "date": "2026-02-21"
          },
          {
            "kind": "session",
            "id": "a-bp-FUERZA-1-3",
            "date": "2026-02-28"
          },
          {
            "kind": "session",
            "id": "a-bp-FUERZA-1-4",
            "date": "2026-03-07"
          }
        ],
        "derivedFrom": [
          "series:bp-primaria"
        ],
        "independenceGroup": "rendimiento:bp-primaria"
      },
      {
        "id": "R-PR:esfuerzo",
        "origin": "carga",
        "label": "Desvío de RPE (real − objetivo), mediana",
        "value": -1,
        "unit": "RPE",
        "refs": [
          {
            "kind": "session",
            "id": "a-bp-FUERZA-1-2",
            "date": "2026-02-21"
          },
          {
            "kind": "session",
            "id": "a-bp-FUERZA-1-3",
            "date": "2026-02-28"
          },
          {
            "kind": "session",
            "id": "a-bp-FUERZA-1-4",
            "date": "2026-03-07"
          }
        ],
        "derivedFrom": [
          "series:bp-primaria"
        ],
        "independenceGroup": "rendimiento:bp-primaria"
      },
      {
        "id": "R-PR:cumplimiento",
        "origin": "cumplimiento",
        "label": "Cumplimiento de series (mínimo de las exposiciones)",
        "value": 1,
        "refs": [
  // … recortado para el documento
```

## 9. Intervención y seguimiento

Aceptar ≠ aplicar; fechas separadas; `deviatesFromProposal`; seguimiento con ventana (aquí sin datos posteriores: `null`, no cero).

`GET /api/athletes/:id/interventions`

```json
{
  "intervention": {
    "id": "83b08a47-f1f1-4ca3-911f-ba5e2bfd9880",
    "origin": "propuesta",
    "proposalKey": "BP|bp-primaria|R-PR|2026-03-07|reglas-v0.2-propuesta",
    "lift": "BP",
    "exposureId": "bp-primaria",
    "state": "seguimiento",
    "detectedOn": "2026-03-10",
    "reviewedOn": "2026-03-10",
    "decidedOn": "2026-03-10",
    "decision": "aceptada",
    "appliedOn": "2026-03-10",
    "appliedDescription": "+2,5 kg en lugar de +5",
    "deviatesFromProposal": true,
    "linkedEventId": null,
    "closedOn": null,
    "coachNote": "Inicio automático del seguimiento",
    "history": [
      {
        "on": "2026-03-10",
        "from": null,
        "to": "detectada",
        "note": "Hallazgo detectado"
      },
      {
        "on": "2026-03-10",
        "from": "detectada",
        "to": "aceptada",
        "note": ""
      },
      {
        "on": "2026-03-10",
        "from": "aceptada",
        "to": "aplicada",
        "note": ""
      },
      {
        "on": "2026-03-10",
        "from": "aplicada",
        "to": "seguimiento",
        "note": "Inicio automático del seguimiento"
      }
    ]
  },
  "followUp": {
    "eventId": "83b08a47-f1f1-4ca3-911f-ba5e2bfd9880",
    "lift": "BP",
    "blockKey": "",
    "horizonN": 3,
    "before": null,
    "after": null,
    "deltaKg": null,
    "deltaPct": null,
    "exceeds": null,
    "rpeDevAfter": null,
    "complianceAfter": null,
    "readinessBefore": null,
    "readinessAfter": null,
    "competing": [],
    "state": "pendiente",
    "coverage": "0 de 3 exposiciones comparables posteriores (0 días desde la fecha efectiva)",
    "text": "Seguimiento pendiente: 0 de 3 exposiciones comparables posteriores (0 días desde la fecha efectiva). No se evalúa todavía ni se da por positivo.",
    "interventionId": "83b08a47-f1f1-4ca3-911f-ba5e2bfd9880"
  }
}
```

## 10. Estado multidimensional de un lift

Dimensiones + principal + conflictos/diferidas (recortado).

`GET /api/athletes/:id/state`

```json
{
  "lift": "SQ",
  "objective": {
    "value": "fuerza",
    "available": true,
    "note": "Objetivo declarado del bloque."
  },
  "dimensions": [
    {
      "id": "rendimiento",
      "status": "mejora",
      "summary": "Rendimiento (e1RM por curva): mejora.",
      "signals": ["R-PROGRESS@sq-primaria"],
      "assessment": {
        "sufficiency": "suficiente",
        "recency": "vigente",
        "comparability": "comparable",
        "independentGroups": 2,
        "items": 3,
        "correlationNote": "3 evidencias derivan de 2 grupos de datos: las que comparten series cuentan como una sola confirmación, no como varias.",
        "reasons": []
      }
    },
    {
      "id": "recuperacion",
      "status": "sin_alertas",
      "summary": "Recuperación reportada: vigente (2026-03-07, disposición 8/10).",
      "signals": [],
      "assessment": null
    },
    {
      "id": "respuesta",
      "status": "respondiendo",
      "summary": "El e1RM mejora: el estímulo parece estar produciendo respuesta (observación, no causalidad).",
      "signals": ["R-PROGRESS@sq-primaria"],
      "assessment": {
        "sufficiency": "suficiente",
        "recency": "vigente",
        "comparability": "comparable",
        "independentGroups": 2,
        "items": 3,
        "correlationNote": "3 evidencias derivan de 2 grupos de datos: las que comparten series cuentan como una sola confirmación, no como varias.",
        "reasons": []
      }
    },
    {
      "id": "oportunidades",
      "status": "hay_oportunidades",
      "summary": "Oportunidades a revisar: ventana expresion, ventana expresion (no son órdenes: ver conflictos).",
      "signals": ["R-EXPRESSION-B@sq-primaria", "R-EXPRESSION-A"],
      "assessment": {
        "sufficiency": "parcial",
        "recency": "vigente",
        "comparability": "comparable",
        "independentGroups": 3,
        "items": 4,
        "correlationNote": "4 evidencias derivan de 3 grupos de datos: las que comparten series cuentan como una sola confirmación, no como varias.",
        "reasons": []
      }
    },
    {
      "id": "calidad_datos",
      "status": "completa",
      "summary": "Datos completos para las reglas evaluadas.",
      "signals": [],
      "assessment": null
    }
  ],
  "principal": {
    "key": "R-EXPRESSION-B@sq-primaria",
    "status": "ventana_expresion",
    "headline": "Ventana favorable según el motor propio (modo B): se cumplen las 5 condiciones. Es una ventana favorable observada: no es un pico fisiológico confirmado ni una predicción.",
    "action": "contexto",
    "actionText": "Considerar la ventana en la planificación del coach. No se intenta ningún máximo automáticamente.",
    "assessment": {
      "sufficiency": "parcial",
      "recency": "vigente",
      "comparability": "comparable",
      "independentGroups": 3,
      "items": 4,
      "correlationNote": "4 evidencias derivan de 3 grupos de datos: las que comparten series cuentan como una sola confirmación, no como varias.",
      "reasons": []
    }
  },
  "conflicts": [
    {
      "a": "R-EXPRESSION-B@sq-primaria",
      "b": "R-PROGRESS@sq-primaria",
      "kind": "compatible",
      "resolution": "señal de otra dimensión, compatible: se conserva como contexto"
    },
    {
      "a": "R-EXPRESSION-B@sq-primaria",
      "b": "R-EXPRESSION-A",
      "kind": "compatible",
      "resolution": "señal de otra dimensión, compatible: se conserva como contexto"
    }
  ],
  "deferred": []
}
```

## 11. Importación Hevy (dry-run) — CSV SINTÉTICO de 4 filas

Rechazos con motivo, válidos con huecos y ejercicios revisables, todo separado.

`POST /api/athletes/:id/imports/hevy`

```json
{
  "mode": "dry_run",
  "preview": {
    "newRows": 3,
    "duplicatesExisting": 0,
    "duplicatesInFile": 0,
    "rejected": 1,
    "rejectedByReason": [
      {
        "reason": "sin repeticiones ni carga",
        "count": 1
      }
    ],
    "sessions": 1,
    "dateRange": {
      "from": "2026-03-02",
      "to": "2026-03-02"
    },
    "bySetType": {
      "work": 3
    },
    "withRpe": 1,
    "withoutRpe": 2,
    "unmappedExercises": [
      {
        "title": "Mi ejercicio raro",
        "sets": 1
      }
    ],
    "exercises": [
      {
        "title": "Squat (Barbell)",
        "sets": 2,
        "lift": "SQ",
        "loadKind": "total",
        "variantKey": "barbell",
        "known": true
      },
      {
        "title": "Mi ejercicio raro",
        "sets": 1,
        "lift": null,
        "loadKind": "unknown",
        "variantKey": "sin-equipo",
        "known": false
      }
    ],
    "validWithGaps": [
      {
        "metric": "e1rm_table_rpe",
        "reason": "Sin RPE real: no hay e1RM por curva (sí por fórmulas PRG).",
        "rows": 2
      },
      {
        "metric": "tonnage",
        "reason": "Carga total desconocida (mancuernas por lado, peso corporal o tipo de carga desconocido): excluida del tonelaje.",
        "rows": 1
      },
      {
        "metric": "lift_metrics",
        "reason": "Ejercicio sin mapeo a un lift: no cuenta para métricas por lift.",
        "rows": 1
      }
    ],
    "rejectedSample": [
      {
        "line": 5,
        "reason": "sin repeticiones ni carga (¿cardio o tiempo? no es una serie de fuerza)"
      }
    ],
    "loadKinds": {
      "total": 2,
      "unknown": 1
    },
    "warnings": [
      "1 ejercicio(s) sin mapeo explícito: se importan con lift = ninguno (no se adivina). Completá `exerciseMap` si querés que cuenten para un lift."
    ],
    "token": "126542a98d02cd",
    "dateInterpretation": "start_time se toma como hora local escrita (cuenta en America/Argentina/Mendoza) y se usa su fecha civil; los instantes con offset/UTC se convierten a America/Argentina/Mendoza.",
    "fatal": [],
    "sample": [
      {
        "date": "2026-03-02",
        "exerciseName": "Squat (Barbell)",
        "setType": "work",
        "kg": 140,
        "reps": 5,
        "rpe": null,
        "loadKind": "total",
        "lift": "SQ"
      },
      {
        "date": "2026-03-02",
        "exerciseName": "Squat (Barbell)",
        "setType": "work",
        "kg": 140,
        "reps": 5,
        "rpe": 8,
        "loadKind": "total",
        "lift": "SQ"
      },
      {
        "date": "2026-03-02",
        "exerciseName": "Mi ejercicio raro",
        "setType": "work",
        "kg": 30,
        "reps": 10,
        "rpe": null,
        "loadKind": "unknown",
        "lift": null
      }
    ]
  },
  "applied": null
}
```
