# Validación histórica y replay

## Mecanismo (`packages/engine/src/replay.ts`, CLI `npm run replay -w @coaching/api`)

- Reevalúa con **solo lo conocido en cada corte**: registros con fecha ≤ corte, `planKnownAt` (versión de plan vigente entonces),
  referencias de fuerza con fecha ≤ corte, sin marcas futuras.
- Salida: cobertura, abstenciones, frecuencia/persistencia de alertas y cambios de estado, versión de reglas/parámetros.
- Un resultado observado posterior **no es exactitud causal**. Se compara contra una línea base simple (persistencia/último valor).
  Un PR no intentado **no** se llama falso positivo.
- Uso: `npm run replay -w @coaching/api -- --athlete <id> --from AAAA-MM-DD --to AAAA-MM-DD [--step weekly|sessions] [--out f.json]`.

## Revisión de los scripts exploratorios previos (`panel.py`, `pronostico.py`) — hallazgos

1. `panel.py` (líneas ~40–42): el relleno `expanding().max().shift(-1)` usa información **futura** → fuga (leakage). Los resultados que dependan de ese relleno no son válidos como validación.
2. `pronostico.py`: `banister()` (constantes 42/7 días aplicadas a filas **semanales**, no diarias) está definida pero **no se invoca** en el bucle del backtest; solo corren naive, deriva, Holt y ridge.
3. El objetivo B es un máximo móvil de 4 semanas: los horizontes 1–2 se solapan y favorecen al modelo naive.
   Conclusión: estos hallazgos exploratorios **no validan NL80 ni invalidan ACWR**; son [aproximado]/[desconocido] hasta repetir con replay sin fuga.
   Con los datos disponibles se entrega el mecanismo y su limitación; no se afirma validación estadística.

## Excel de programación (`Macro (2).xlsx`)

Hojas came-back, dev1, dev2, Meetlock1, offSeason, offseason2: tarjetas por movimiento (Series/Reps/Carga/RPE/%1RM/NL/Tonelaje/INOL/SI por semana w1..w4)
y una lista lateral de sesiones (Tier/Movimiento). **Bloqueo**: no hay fechas, la relación tarjeta↔sesión y la semántica de la celda 1RM son ambiguas.
No se inventó formato: se entrega el contrato canónico `plan-canonical-v1` (CSV, `POST /api/athletes/:id/imports/plan-csv`) y el mapeo queda pendiente de confirmar.
`Macro (1).xlsx` (Dashboard/Data/Bloque1-4) es otra estructura.
