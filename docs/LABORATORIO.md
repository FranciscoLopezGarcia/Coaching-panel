# Laboratorio de pruebas (atletas FICTICIOS)

Seis casos inventados, reproducibles y aislados para abrir y modificar desde la aplicación. **No hay datos reales.** Los casos describen condiciones a explorar: no están ajustados para producir una etiqueta, y las conclusiones que se muestran abajo son lo que el motor (`reglas-v0.2-propuesta`, todas **[propuesta]**) devolvió al generar este documento, no un resultado esperado ni validado.

## Levantar el laboratorio (BD nueva, nunca una existente)

```bash
npm run lab:create -w @coaching/api -- ./data/laboratorio.sqlite            # se niega si el archivo existe o si parece la BD de trabajo
DB_PATH=./data/laboratorio.sqlite PORT=3200 npm run dev -w @coaching/api   # API del laboratorio: http://127.0.0.1:3200 (health/instance lo identifican)
WEB_API_TARGET=http://127.0.0.1:3200 npm run dev -w @coaching/web -- --port 5200 --strictPort
```

- Fechas fijas: arranca el lunes `2026-06-01` (cambiable con `--start AAAA-MM-DD` si es lunes). Dos creaciones dan datos idénticos.
- `--only A,C` crea solo algunos casos. Para rehacer el laboratorio, borrá vos el archivo y volvé a crearlo: el comando no borra nada.
- Los nombres empiezan con `LAB-` y terminan en `(ficticio)`. Cada caso queda evaluado en su segundo corte sugerido para que el tablero tenga algo que mostrar; podés **re-evaluar a cualquier fecha**.
- La programación se publicó por bloques de 4 semanas con fecha de publicación propia (el viernes anterior), con referencias fechadas, macro, mesos, protocolos, ejecución y cuestionarios. Hay semanas **posteriores** a los cortes sugeridos a propósito.

## Cómo usar el laboratorio (prueba manual libre)

Todo con operaciones reales de la API (la UI usa las mismas):

| Quiero…                               | Operación                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Crear un atleta ficticio              | `POST /api/athletes`                                                                                                                                                     |
| Crear programación                    | `POST /macros`, `PUT /mesos`, `PUT /microcycles`, `POST /plan` o `POST /program` (`add_sets`, `repeat_week`, `duplicate_session`, `change_protocol`, …) con vista previa |
| Registrar series y cuestionarios      | `POST /sets`, `POST /checkins`, `POST /session-feedback`                                                                                                                 |
| Evaluar a una fecha elegida           | `POST /evaluate {"cutoff":"AAAA-MM-DD"}`                                                                                                                                 |
| Ver evidencias                        | `GET /recommendations/:key/evidence?cutoff=…`                                                                                                                            |
| Registrar una intervención y seguirla | `POST /interventions` → `…/transition` (aceptada → aplicada) → `GET /interventions?cutoff=…`                                                                             |
| Agregar semanas                       | `POST /program {op: repeat_week / repeat_structure / add_sets}` y volver a evaluar                                                                                       |

### Qué significa "respetar el corte"

`POST /evaluate` con un corte pasado usa **solo lo conocido a esa fecha**:

- Programación: la última versión **aplicada** con fecha de publicación ≤ corte (cada serie con su contenido de entonces). Una prescripción agregada hoy con fecha anterior no cuenta. Las series ya ejecutadas ≤ corte se conservan aunque su versión sea posterior (se asume que existían).
- Ejecución, cuestionarios, fatiga de sesión, revisiones técnicas y cambios detectados: solo con fecha ≤ corte.
- Limitación: ejecución y cuestionarios se filtran por la fecha del _evento_; solo la programación tiene fecha de publicación. Si un dato se cargó tarde con fecha vieja, se usará al evaluar ese corte (el sistema no guarda cuándo se cargó cada cuestionario para este filtro). Está cubierto por un test que falla si se quita el filtro (`apps/api/test/lab.test.ts`).
- **Cambio de comportamiento** respecto de versiones anteriores: antes la evaluación a un corte pasado tomaba la programación completa actual. Evaluaciones guardadas antes no se reescriben; se pueden re-evaluar.

## Casos

### Caso A — LAB-A · Progreso (ficticio)

Prescripción y ejecución comparables; el peso sube de forma gradual con esfuerzo estable y cuestionarios favorables.

- **Qué datos contiene:** SQ 2 sesiones/semana (lunes pesada con aproximación; jueves volumen con protocolo 75 % de la referencia), 12 semanas ejecutadas + 4 planificadas, referencia 150 kg (test) y 157,5 kg desde la semana 9, check-ins semanales favorables.
- **Qué explora:** Cómo se ve una mejora real con datos completos: progreso, tendencia, protocolo por porcentaje de una referencia fechada y recuperación favorable.
- **Salidas incompatibles con los datos:** Revisión técnica, deterioro/fin de respuesta o "datos insuficientes" con el corte sugerido (hay 8+ exposiciones con RPE real).
- **Puede quedar indeterminado:** Si hay candidato a PR o ventana de expresión depende de parámetros que el coach debe definir; puede quedar sin señal.
- **Qué podés cambiar para explorar:** Cambiá RPE/kg de una semana (POST /sets), borrá un check-in, cambiá la referencia fechada, evaluá a distintos cortes, agregá semanas con "repetir semana".
- **Qué debería permanecer invariable:** Los kg y RPE de las semanas ya ejecutadas hasta el corte, y el hecho de que evaluar a un corte pasado no usa las semanas posteriores.
- **Limitaciones:** Una sola barra, sin cambios de estímulo ni competencia. Los umbrales de cambio mínimo (1,5 % / 2,5 kg) son del laboratorio, no una recomendación.
- **Cortes sugeridos** (el laboratorio contiene datos posteriores a estos cortes, que NO deben usarse):

| Corte                  | Nota                                                       | Conclusión principal observada al generar este documento |
| ---------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| 2026-07-12 (semana 6)  | a mitad de camino                                          | SQ: ventana_expresion                                    |
| 2026-08-09 (semana 10) | con ejecución posterior (semanas 11–12) que NO debe usarse | SQ: ventana_expresion                                    |
| 2026-08-23 (semana 12) | toda la ejecución                                          | SQ: ventana_expresion                                    |

### Caso B — LAB-B · Deterioro (ficticio)

La prescripción sigue subiendo, pero el atleta carga menos y con más esfuerzo; los cuestionarios empeoran en paralelo.

- **Qué datos contiene:** SQ 2 sesiones/semana, 12 semanas ejecutadas; plan 130→157,5 kg, ejecutado 125–137,5 kg con RPE 8→9,5; check-ins que bajan (sueño, energía) y suben (estrés, molestia); fatiga de sesión 7→9; molestia por serie ≤ 3.
- **Qué explora:** Divergencia entre previsto y realizado, exceso de RPE sobre el objetivo, caída del e1RM y recuperación desfavorable (cuestionario y fatiga de sesión).
- **Salidas incompatibles con los datos:** Progreso o candidato a PR como conclusión principal en los cortes de las semanas 8 y 12 (en el corte de la semana 4 todavía no hay deterioro y una lectura favorable es coherente).
- **Puede quedar indeterminado:** La causa (fatiga, técnica, estrés externo) NO se puede inferir de estos datos; el sistema solo describe.
- **Qué podés cambiar para explorar:** Bajá el RPE real de las últimas semanas o mejorá los check-ins y re-evaluá; agregá una semana de descarga con "repetir semana" y mirá el seguimiento de una intervención.
- **Qué debería permanecer invariable:** El plan publicado y las semanas previas a la 5 (ejecutadas según plan).
- **Limitaciones:** La molestia no llega a un valor de alerta propio; el laboratorio no define umbrales de dolor. No hay diagnóstico ni causa.
- **Cortes sugeridos** (el laboratorio contiene datos posteriores a estos cortes, que NO deben usarse):

| Corte                  | Nota                                           | Conclusión principal observada al generar este documento |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| 2026-06-28 (semana 4)  | antes del deterioro (debería verse comparable) | SQ: ventana_expresion                                    |
| 2026-07-26 (semana 8)  | deterioro en curso                             | SQ: posible_fin_respuesta                                |
| 2026-08-23 (semana 12) | deterioro sostenido                            | SQ: posible_fin_respuesta                                |

### Caso C — LAB-C · Estabilidad con objetivo de mantenimiento (ficticio)

Carga y esfuerzo constantes durante 12 semanas, con objetivo declarado de mantenimiento y cuestionarios favorables.

- **Qué datos contiene:** SQ 2 sesiones/semana, 12 semanas ejecutadas, 130 kg × 5 a RPE 7 (pesada) y 100 kg × 8 a RPE 6,5 (volumen); objetivo "mantenimiento" en macro, meso y familia; referencia 160 kg.
- **Qué explora:** Que la estabilidad se interprete según el objetivo: con mantenimiento declarado, estable NO es "fin de respuesta".
- **Salidas incompatibles con los datos:** Fin de respuesta / meseta presentada como problema, o una orden de "más estímulo".
- **Puede quedar indeterminado:** Si el atleta podría progresar con otro estímulo: los datos no lo dicen. Con RPE 7 sostenido puede aparecer un candidato a PR (el margen de esfuerzo existe), aunque en mantenimiento intentarlo quizá no corresponda: el sistema no distingue esa intención. Cambiar el objetivo cambia la lectura de la estabilidad (probalo).
- **Qué podés cambiar para explorar:** Cambiá el objetivo de la familia a "fuerza" (PUT /params, families.mant.objective) y re-evaluá al mismo corte; subí el RPE de las últimas semanas.
- **Qué debería permanecer invariable:** Kg y reps de las semanas ejecutadas (la lectura cambia solo por objetivo/parámetros, no por los datos).
- **Limitaciones:** No hay cambio de estímulo ni competencia. "Estable" depende del cambio mínimo configurado en el laboratorio.
- **Cortes sugeridos** (el laboratorio contiene datos posteriores a estos cortes, que NO deben usarse):

| Corte                  | Nota                | Conclusión principal observada al generar este documento |
| ---------------------- | ------------------- | -------------------------------------------------------- |
| 2026-07-26 (semana 8)  | 8 semanas estables  | SQ: candidato_pr                                         |
| 2026-08-23 (semana 12) | 12 semanas estables | SQ: candidato_pr                                         |

### Caso D — LAB-D · Datos incompletos (ficticio)

Progreso moderado con RPE faltante la mayor parte del tiempo, cuestionarios solo al inicio, sesiones registradas a medias y una semana sin registro.

- **Qué datos contiene:** SQ 2 sesiones/semana, 10 semanas con ejecución parcial: RPE solo en pesadas desde la semana 7; semana 4 con la tercera serie sin registrar; jueves de la semana 6 omitido; semana 8 sin ningún registro; check-ins solo semanas 1–3; la referencia fechada recién existe desde la semana 6.
- **Qué explora:** Abstención parcial: qué métricas y reglas siguen disponibles, cuáles no, y que los faltantes nunca se rellenan (ni RPE con el objetivo ni check-ins con el último valor).
- **Salidas incompatibles con los datos:** Un e1RM por curva en semanas sin RPE real, una conclusión de recuperación sin cuestionario vigente, o ceros inventados en semanas sin registro.
- **Puede quedar indeterminado:** Casi todo lo que dependa de esfuerzo o recuperación. Es el resultado esperado, no un error.
- **Qué podés cambiar para explorar:** Cargá el RPE de una semana, un check-in reciente o la serie faltante y mirá qué se habilita; agregá la referencia antes de la semana 6.
- **Qué debería permanecer invariable:** Lo que no se registró sigue como "sin registro" (no se convierte en 0 ni en "omitida" automáticamente).
- **Limitaciones:** El caso mezcla varias carencias a propósito; no sirve para aislar el efecto de una sola.
- **Cortes sugeridos** (el laboratorio contiene datos posteriores a estos cortes, que NO deben usarse):

| Corte                  | Nota                                               | Conclusión principal observada al generar este documento |
| ---------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| 2026-07-05 (semana 5)  | antes de la referencia y con un cuestionario viejo | SQ: datos_insuficientes                                  |
| 2026-08-09 (semana 10) | con RPE parcial y cuestionario antiguo             | SQ: datos_insuficientes                                  |

### Caso E — LAB-E · Redistribución de frecuencia (ficticio)

La frecuencia pasa de 2 a 3 sesiones por semana manteniendo el NL semanal (50 repeticiones), con cargas y distribución distintas.

- **Qué datos contiene:** SQ semanas 1–6: lunes y jueves 5×5 a 125 kg; semanas 7–12: lunes, miércoles y viernes (3×6 a 120, 3×6 a 120, 2×7 a 115), NL 50 en ambos esquemas; publicado en dos versiones (la segunda al inicio de la semana 7).
- **Qué explora:** Que el sistema distinga NL semanal igual de distribución distinta; identidad de exposición vs ubicación; si el cambio de frecuencia se trata como cambio de estímulo.
- **Salidas incompatibles con los datos:** Un aumento o descenso de "dosis semanal" (el NL no cambia), o confundir las nuevas sesiones con otros ejercicios (es la misma exposición).
- **Puede quedar indeterminado:** Si la nueva distribución rinde mejor o peor: con 6 semanas por esquema no se puede concluir.
- **Qué podés cambiar para explorar:** Movela a otra frecuencia con "mover sesión" o "repetir estructura", compará semanas con week-compare y mirá NL/series/tonelaje por semana.
- **Qué debería permanecer invariable:** NL semanal = 50 en las 12 semanas; exposición `sq-primaria` en todas.
- **Limitaciones:** El tonelaje y la intensidad media sí cambian (carga menor por serie). No hay cuestionarios de contraste.
- **Cortes sugeridos** (el laboratorio contiene datos posteriores a estos cortes, que NO deben usarse):

| Corte                  | Nota                          | Conclusión principal observada al generar este documento |
| ---------------------- | ----------------------------- | -------------------------------------------------------- |
| 2026-07-12 (semana 6)  | solo el esquema de 2 sesiones | SQ: ventana_expresion                                    |
| 2026-08-02 (semana 9)  | esquema nuevo, 3 semanas      | SQ: ventana_expresion                                    |
| 2026-08-23 (semana 12) | ambos esquemas completos      | SQ: ventana_expresion                                    |

### Caso F — LAB-F · Posible oportunidad (ficticio)

Progresión de 9 semanas seguida de 3 semanas con carga sostenida, menos series, esfuerzo menor y cuestionarios favorables.

- **Qué datos contiene:** SQ semanas 1–9 progresivas (125→137,5) y semanas 10–12 con 3→2 series; BP semanal (90→100 kg) con RPE de 8,5–9 que baja a 7 en las últimas 4 semanas; referencias 160 (SQ) y 125 (BP); revisión técnica válida; competencia ficticia en la semana 16.
- **Qué explora:** Si el historial alcanza para evaluar una ventana de expresión y un candidato a PR, y cómo se explican sus límites (extrapolación, sensibilidad al RPE).
- **Salidas incompatibles con los datos:** Una garantía ("PR asegurado", "pico confirmado") o una predicción de fecha: el sistema no hace ninguna de las dos.
- **Puede quedar indeterminado:** Que haya oportunidad real: el estado puede quedar "pendiente de evaluación" o sin señal. Mirá los límites declarados antes de decidir.
- **Qué podés cambiar para explorar:** Subí el RPE de las últimas semanas de BP, cambiá la referencia o el RPE de PR en parámetros y re-evaluá; probá cortes anteriores.
- **Qué debería permanecer invariable:** Las semanas 1–8 de ambas barras.
- **Limitaciones:** El historial de BP es corto para extrapolar; ninguna señal es una predicción validada.
- **Cortes sugeridos** (el laboratorio contiene datos posteriores a estos cortes, que NO deben usarse):

| Corte                  | Nota                                                               | Conclusión principal observada al generar este documento |
| ---------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| 2026-07-26 (semana 8)  | antes del sostenimiento                                            | SQ: ventana_expresion · BP: sin_senal                    |
| 2026-08-09 (semana 10) | inicio del sostenimiento (semanas 11–12 existen y no deben usarse) | SQ: ventana_expresion · BP: ventana_expresion            |
| 2026-08-23 (semana 12) | historial completo                                                 | SQ: oportunidad_pendiente · BP: candidato_pr             |

## Limitaciones generales

- Los umbrales de cambio mínimo (1,5 % / 2,5 kg) y el paso de carga (2,5 kg) son del laboratorio; el coach debe decidir los suyos.
- Las conclusiones son reglas **[propuesta]**; no hay validación predictiva.
- En el caso C (mantenimiento) el motor puede mostrar un candidato a PR por el margen de esfuerzo, sin saber que en mantenimiento no se intentaría: queda a criterio del coach.
- BP y DL de los casos sin esas barras aparecen como "datos insuficientes": es el resultado esperado para un movimiento sin datos.
- Las fechas de los cuestionarios y ejecuciones del laboratorio son las del evento; no simulan cargas tardías.

## Contratos nuevos o modificados que debe consumir Codex

Todo es aditivo salvo lo marcado.

- `POST /api/athletes/:id/evaluate {cutoff}` — **semántica del corte** como arriba (misma forma de respuesta).
- `GET /api/athletes/:id/macros/active[?macroId=]` — suma `selection` (`unico_activo` | `mas_reciente_entre_varios_activos` | `explicita`) y `otherActiveMacros[]`; con `macroId` inexistente, 404. (Resuelve la necesidad 7 de `FRONTEND_BACKEND_REQUESTS.md`.)
- `GET /api/athletes/:id/mesos/:blockKey` — un meso creado y sin series devuelve resumen vacío (200) en lugar de 404; 404 solo si no existe ni meso ni series.
- `GET /performance-projection` → `forecastRange` suma `label` (`"rango empírico no calibrado"`), `calibration {status: not_evaluable|below_nominal|at_or_above_nominal, nominal, observed, sample, minSample, shortfall, method}` y `warnings[] {code: coverage_below_nominal|coverage_not_evaluable|range_unavailable, message}` (campos opcionales en el tipo). Mostrar siempre el aviso cuando exista; **no** presentar el rango como "80 %". Ver `docs/PERFORMANCE_PROJECTION_API.md`.
- `GET /api/health` → suma `instance {mode: laboratory|personal|unspecified, fictitious, datasetId, label}`; `GET /api/instance` → lo mismo más `createdAt` y `cases[]` (clave, nombre, `athleteId`, resumen, qué explora, objetivo y cortes sugeridos con su nota). `lab:create` escribe `<bd>.instance.json` junto a la BD (sin migración); también se puede declarar con `INSTANCE_MODE=laboratory|personal`. **Sin archivo ni variable el modo es `unspecified`: el sistema no deduce si los datos son reales.**
- `GET /api/athletes/:id/state` → suma `freshness {evaluatedCutoff, storedFingerprint, currentFingerprint, inputsChangedSinceEvaluation}`. La huella cubre las entradas **conocidas al corte** de la última evaluación (programación, ejecución, cuestionarios, revisiones, cambios, referencias, parámetros): `true` = alguien (cualquier cliente) cambió datos de ese corte después de evaluar; un dato posterior al corte no la invalida; `null` = evaluación guardada antes de existir la huella. Re-evaluar la limpia. La evaluación (`POST /evaluate`) incluye `inputFingerprint`.
- Configuración de proyección: `minCoverageSample` (10) en `config`.
- Nuevas utilidades de línea de comandos (backend): `lab:create`, `import:plan`, `pilot:check`.
