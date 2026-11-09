# Arquitectura

## Capas y dependencias (solo hacia abajo)

```
apps/web ──HTTP──▶ apps/api ──▶ packages/engine      (dominio puro)
     └──tipos──▶ packages/contracts ◀────┘
apps/api:  routes ▶ services ▶ repositories ▶ db
```

- **engine** no conoce HTTP, SQL ni UI. Recibe series previstas y ejecutadas, un corte y parámetros, y devuelve una evaluación determinista.
- **contracts** valida entradas con zod; el front solo importa tipos (no lleva lógica del motor).
- **api** no contiene reglas: orquesta (`EvaluationService`) y persiste. `buildContext` compone dependencias sin estado global (tests con DB en memoria y reloj fijo).
- **web** solo presenta y envía acciones del coach.

## Pipeline del motor (por lift)

`calidad → métricas → reglas → prioridad → explicación → revisión del coach`

1. **Calidad** (`exposures.ts`): ignora registros posteriores al corte, descarta series sin fecha o sin RPE, cuenta lo que falta. Ausente ≠ 0.
2. **Métricas**: E = kg ÷ %tabla(reps, RPE real) por serie; E de la exposición = mejor serie. Cumplimiento, desvío de RPE vs objetivo.
3. **Reglas** (`rules/`): `B-DOLOR`, `R-PROGRESS`, `R-LOAD`, `R-END`.
4. **Prioridad** (`priority.ts`, `pipeline.ts`): una recomendación principal por lift; el resto, señales secundarias (alternativas, no órdenes).
5. **Persistencia** (`decisions.ts`): clave `lift|slot|regla|datos-hasta|versión`; fusión idempotente que conserva la decisión del coach y expira lo que ya no aplica.

## Módulos del motor (`packages/engine/src`)

| Módulo                          | Responsabilidad                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `e1rm`, `si`                    | e1RM de tabla [recuperado]; Stress Index `rts-aprox-v1` [aproximado]                                                |
| `exposures`, `views`, `metrics` | exposiciones por sesión; NL, series, tonelaje, frecuencia, intensidad y SI por semana/bloque (previsto y realizado) |
| `rules/*`, `pipeline`           | reglas por lift, prioridad y alternativas                                                                           |
| `prg`                           | ACWR, FR, PeakIndex y tendencia reconstruidos de PRG (solo modo A de expresión)                                     |
| `snapshot`, `diff`, `outcomes`  | versiones del plan, clasificador de cambios, desviaciones de ejecución y seguimiento posterior                      |
| `blocks`                        | resumen por bloque, TTP observado y familias/golden                                                                 |
| `compare`                       | comparativas A/B normalizadas por semana                                                                            |
| `decisions`                     | fusión idempotente con la decisión del coach                                                                        |

## Modelo de datos (SQLite)

`athletes`, `planned_sets` (prescripción, con bloque/semana/día/familia y referencia 1RM fechada; `retired` conserva el historial), `actual_sets` (ejecución, FK a la prescripción), `checkins`,
`evaluations`, `decisions`, `plan_versions` (snapshots), `change_events` (eventos compuestos, con motivo opcional), `session_feedback`, `coach_reviews`, `competitions`.
Prescripción y ejecución están separadas; ausencia = `NULL`. Migraciones `NNN_*.sql` aplicadas una sola vez (`schema_migrations`).

## Decisiones técnicas

- Monorepo con npm workspaces y TypeScript estricto; los paquetes se consumen como código fuente (la API los empaqueta con `tsup`).
- `node:sqlite` (builtin, experimental) para evitar módulos nativos en un entorno local; la capa `repositories` aísla el cambio a otro motor.
- Sin ORM ni framework de estado en el front: poca superficie mientras el producto se define.

## Fuera de alcance

Autenticación/roles y despliegue. No hay bandeja de videos ni integración con WhatsApp (decisión del usuario): la revisión técnica es un campo opcional del coach.

## Módulos añadidos en la consolidación

`evidence*`, `explain`, `state`, `pr-candidate`, `intervention`, `catalog`/`metric-result`/`metrics-observed`/`records`/`e1rm-methods`/`references`,
`muscles`, `program`, `queries`, `replay`, `import/{csv,hevy,plan-canonical,hash}`, `params` (registro). API: `routes/consolidation.ts`, servicios `imports/interventions/programming/queries/replay`, repos nuevos y `legacy.ts`.
