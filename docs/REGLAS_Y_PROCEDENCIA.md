# Reglas, fórmulas y procedencia

Cada elemento está etiquetado: **[recuperado]** (comportamiento confirmado en una app), **[aproximado]** (experimentos),
**[propuesta]** (regla operativa de este proyecto) o **[desconocido]**.

## Fórmulas

| Elemento                                | Procedencia | Detalle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| e1RM de la serie `E`                    | recuperado  | `kg ÷ %curva(reps, RPE real)`, curva única de RTS `rts-curva-default-v1` (`h = reps + 10 − RPE`; dominio recomendado reps 1–15 × RPE 4–10, amplio reps 1–50 × RPE 1–10). **Corrección (2026-11-08):** la tabla anterior `rpe-proyecto-v1` coincidía con la curva solo hasta h = 10 y divergía en 107 de 195 celdas por encima (error heredado de PRG); se reemplazó por la curva, como decidía `LEEME_DECISIONES`. Sin RPE real no se calcula. Fixtures: 140×3@8 → 162,22; 145×3@8 → 168,02; 145×3@9 → 162,56. |
| Stress Index central/periférico, TRAC-R | desconocido | No se usan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Disposición del check-in                | propuesta   | Promedio de sueño, energía, ganas, 11−estrés, 10−dolor. **No es TRAC.** Vigencia 7 d. No reescribe el rendimiento.                                                                                                                                                                                                                                                                                                                                                                                             |

## Reglas activas (versión `reglas-v0.1-propuesta`) — todas **[propuesta]**

| Regla        | Dispara cuando                                                                                                                                                 | Acción propuesta                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `B-DOLOR`    | molestia máx. ≥ 4/10 en 7 días en el lift                                                                                                                      | Revisión del coach; suspende `R-LOAD`. No es diagnóstico.                                      |
| `R-PROGRESS` | mediana de `E` de las últimas 3 exposiciones comparables del slot supera a la de las 3 previas por el cambio mínimo, RPE ≤ objetivo + 0,5, cumplimiento ≥ 90 % | Mantener estructura. Con solo 3 datos: "tendencia inicial", nunca "sostenido".                 |
| `R-LOAD`     | últimas 2 exposiciones completas, reps cumplidas y RPE real ≤ objetivo − 0,5; referencia = mínimo de `E` de las últimas 3                                      | Proponer kg: `floor(E_ref × %tabla(reps, RPE obj) / paso) × paso`, máx. +1 paso. No se aplica. |
| `R-END`      | 2 exposiciones seguidas por debajo de la mediana de las 3 previas (≥ cambio mínimo), o 6 exposiciones con rango de `E` < cambio mínimo                         | Revisar bloque/contexto. Nunca "más estrés" automático. Sin TTP histórico.                     |

Parámetros iniciales (`packages/engine/src/params.ts`): N=3, ventana 21 d, previas ≤ 42 d, tolerancia RPE 0,5, cumplimiento 90 %, paso 2,5 kg.
**El cambio mínimo relevante por lift no tiene valor por defecto**: sin él el motor muestra Δ y se abstiene de clasificar (rules.md §2).

## Reglas de las etapas 2–4 — todas **[propuesta]**

| Regla            | Dispara cuando                                                                                                                                                                                          | Acción propuesta                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `B-TECNICA`      | el coach marcó la técnica «no comparable» (≤ 28 d)                                                                                                                                                      | Revisión; suspende las propuestas ofensivas                                                                                                                                                            |
| `R-PR`           | 3 benchmarks recientes favorables/estables, sin fallos ni overshoot; `W = floor(E_cons × %tabla(reps, RPE obj) / paso) × paso`, con `E_cons` = mínimo de `E` calculado con RPE+0,5; `W ≥ récord + paso` | Candidato a récord de **peso para reps** @ RPE 9. Sin chequeo de ≤ 48 h o revisión del coach: «oportunidad potencial, pendiente validar». Single máximo apagado salvo habilitación. Sin probabilidades |
| `R-EXPRESSION-A` | FR ≥ 1, tendencia estable/ascendente, ACWR 0,8–1,3 y PeakIndex ≥ 15 % (reglas del Glosario de PRG, **reconstruidas desde texto**; e1RM de tabla en lugar del promedio de 6 fórmulas)                    | «Señal de expresión según la regla de PRG». Requiere referencia fechada y calendario completo                                                                                                          |
| `R-EXPRESSION-B` | favorable/estable + sin deterioro + RPE ≤ objetivo + recuperación vigente no empeorada + cumplimiento ≥ 90 %                                                                                            | «Ventana favorable observada». Si A y B discrepan se muestra. Nunca «pico confirmado»                                                                                                                  |
| `R-VOLUME`       | 6 benchmarks estables (sin cambio relevante), adherencia, ≥ 3 respuestas de recuperación estables, sin deterioro, y dosis histórica productiva mayor **o** ensayo exploratorio confirmado por el coach  | Experimento propuesto: +1 serie semanal a UN slot, N semanas, con salida definida de antemano. Si ya progresa, no                                                                                      |
| `R-FREQUENCY`    | deterioro no programado (RPE ≥ +1 contra el objetivo a igual carga, o reps no completadas) + fatiga de final de sesión ≥ 7 en ≥ 2 sesiones, y la siguiente vuelve a la referencia                       | Redistribuir el **mismo** volumen semanal en más días; no atribuye causalidad                                                                                                                          |

**TTP y golden:** «mejor observado al cierre» ≠ TTP delimitado; si el bloque cierra mejorando, queda «no delimitado»; una pausa > 14 días da «no concluyente». Con 1 ciclo delimitado: observación preliminar; con ≥ 2: patrón repetido (sin porcentajes). Golden = candidato con respuesta favorable, cumplimiento y esfuerzo aceptables; «replicado» solo con ≥ 2 ciclos favorables de la misma familia; lo confirma el coach.

**Historial automático:** el evento es la modificación del programa (una versión), con deltas hijos. NL = Σ repeticiones (nunca series). Clases: volumen ↑/↓, redistribución de frecuencia, perfil de estímulo, intensidad/esfuerzo, referencia/modelo, duración, ejercicio, mixto. Igual NL o igual SI no implica el mismo estímulo. El SI planificado solo se calcula con todos los RPE objetivo (modelo `rts-aprox-v1`, nombrado en cada fila). La intención del coach nunca se infiere; el seguimiento usa «se observó…/coincidió con…».

## Prioridad (menor = primero)

1 revisión del coach · 2 posible fin con esfuerzo excesivo · 3 posible fin · 4 datos insuficientes · 5 candidato a PR · 6 ventana de expresión · 7 margen de carga · 8 progreso sostenido · 9 tendencia inicial · 10 ensayo de volumen · 11 redistribuir frecuencia · 12 sin señal. Si hay varias señales ofensivas plausibles, la principal lleva las demás como «alternativas a revisar».
"Datos insuficientes" solo manda en un lift si ningún slot produjo otra evaluación.

## Límites declarados

- No hay probabilidades de PR, fechas de pico ni predicción de lesión.
- Igual NL o igual SI no implica el mismo estímulo; el RPE objetivo nunca se infiere de kg ni el real del objetivo.
- Técnica: no hay revisión en la app → "técnica no validada en la app".
- La confianza (Insuficiente / Inicial / Moderada) es cualitativa, no estadística.

## Consolidación (`reglas-v0.2-propuesta`, `params-v2`) — todas **[propuesta]**

- e1RM `table-rpe` (requiere RPE real, [recuperado] tabla `rpe-proyecto-v1`) vs `prg-6-formulas` ([recuperado], verificado contra `prg_referencia.py`, dominio 2–10 reps). No se mezclan.
- SI separados: `rts-aprox-v1` [aproximado], `prg-si-v1` (RPE real), `efort-xl-v1` (RIR=10−RPE). CTL/ATL: evidencia contradictoria, marcada.
- R-END distingue caída de estabilidad según objetivo; R-PR tipado (`load_for_reps`) con escenarios de sensibilidad al RPE y estado `oportunidad_pendiente`.
- Umbrales: todos en `PARAM_REGISTRY` (default/alcance/versión); paso de carga ≠ cambio mínimo relevante ≠ sensibilidad del método; faltante esencial → `missingConfig` suspende solo esa interpretación.
- Convención muscular: directo 1.0 / indirecto 0.5 (convención del proyecto, no de Hevy); NL ≠ series musculares.
