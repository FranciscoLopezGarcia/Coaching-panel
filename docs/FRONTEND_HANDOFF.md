# BASE · frontend y laboratorio

Actualizado: 2026-11-06. Esta guía reemplaza los pendientes antiguos de las entregas anteriores: IDs de serie, protocolos completos, creación con preview, control de concurrencia y lectura de borradores **ya existen** y se consumen.

## Qué se puede hacer desde la interfaz

- Elegir atleta o caso ficticio; crear un atleta propio por formulario.
- Crear macro y meso; quedan seleccionados automáticamente. El código del meso se genera y se puede revisar, sin exigir identificadores manuales.
- Armar una semana agregando sesiones y segmentos de trabajo, aproximación, top y backoff. Se conservan kg, %, referencia, RPE, tope, tempo, pausa y notas.
- Revisar diferencias oficiales y publicar sesión con `add_sets`. La creación y los cambios usan preview y versión base; una publicación concurrente produce un error recuperable.
- Duplicar sesión, crear siguiente semana, repetir estructura, aplicar/guardar plantilla, cambiar protocolos por selección de series y mover sesiones. No se copian ejecuciones ni cuestionarios.
- Registrar peso, reps y RPE real por ID oficial, fecha y observaciones. Los borradores sobreviven a recargas y errores de red. El RPE real nunca se copia del objetivo.
- Completar cuestionarios, incluso parciales. Elegir la fecha de análisis y ejecutar «Actualizar evaluación».
- Ver estado por movimiento, último e1RM fechado, hallazgo y acción recibidos del backend; abrir curva, comparativas, evidencia e historial de cambios.
- Consultar versiones publicadas y abrir el contenido de borradores guardados como tablas. Esa lectura no restaura ni publica el snapshot silenciosamente.
- Mantener las importaciones Hevy/plan canónico y los formularios de parámetros/referencias existentes.

## Entrada al laboratorio

La identidad viene de `GET /api/instance`: solo una respuesta `mode=laboratory, fictitious=true` habilita la etiqueta **«Laboratorio · datos ficticios»**. La instancia personal tiene otra identificación. En cada escritura se vuelve a verificar modo e identificador de conjunto; un cambio de API/base se bloquea antes de enviar cambios. Un servidor `unspecified` queda en lectura hasta identificarlo. `VITE_BASE_MODE=laboratory` permite reservar una URL al laboratorio y rechazar una API personal accidental.

El inicio obtiene el catálogo `cases[]` de la API, con objetivos y cortes sugeridos **exactos del servidor**. No infiere resultados ni mantiene un catálogo duplicado en frontend. Permite abrir programación, registro y análisis, o crear un atleta ficticio propio. Cada caso abre la fecha de su evaluación guardada; los registros de semanas posteriores no se incluyen al analizar ese corte. No hay botón para cambiar de servidor, mezclar datos personales o borrar/reiniciar bases.

Casos de Claude:

| Caso              | Objetivo de prueba                                                      |
| ----------------- | ----------------------------------------------------------------------- |
| A · Progreso      | Datos completos y esfuerzo estable; empezar por este.                   |
| B · Deterioro     | Prescripción creciente frente a ejecución y recuperación que empeoran.  |
| C · Mantenimiento | Estabilidad interpretada según objetivo; distinguir baseline de mejora. |
| D · Incompletos   | Observar abstenciones y completar datos sin inventar faltantes.         |
| E · Frecuencia    | Redistribución con NL semanal conservado.                               |
| F · Oportunidad   | Revisar condiciones y límites sin garantizar un récord.                 |

Los objetivos son guías educativas, no resultados prometidos. Los cálculos y señales se reciben exclusivamente de la API.

### URL única del laboratorio persistente

**http://127.0.0.1:5200**

Frontend Vite → API `127.0.0.1:3200` → SQLite en archivo:

`/home/flg/Escritorio/coaching/app/apps/api/data/base-laboratorio-persistente-20261106.sqlite`

Metadata: el mismo nombre con sufijo `.instance.json`. Identidad verificada por archivo y `/api/instance`: `mode=laboratory`, `fictitious=true`, `datasetId=lab-2026-06-01-97009367`, seis casos A–F con sus cortes oficiales. El archivo es exclusivo de esta integración: no se encontró una BD de laboratorio completa existente y se creó con `lab:create`, sin sobrescribir archivos.

No hay fallback a datos en memoria: si la API no responde, la entrada muestra error y «Reintentar». Las instancias de pruebas en memoria de entregas anteriores son independientes, no forman parte de esta URL ni de su configuración. No se detuvieron otros servidores.

#### Arrancar (dos terminales, sin volver a crear la BD)

Terminal API:

```bash
cd /home/flg/Escritorio/coaching/app
test -f apps/api/data/base-laboratorio-persistente-20261106.sqlite && test -f apps/api/data/base-laboratorio-persistente-20261106.sqlite.instance.json && DB_PATH=/home/flg/Escritorio/coaching/app/apps/api/data/base-laboratorio-persistente-20261106.sqlite HOST=127.0.0.1 PORT=3200 WEB_ORIGIN=http://127.0.0.1:5200 node --import tsx apps/api/src/server.ts
```

Terminal frontend:

```bash
cd /home/flg/Escritorio/coaching/app
VITE_BASE_MODE=laboratory WEB_API_TARGET=http://127.0.0.1:3200 npm run dev -w @coaching/web -- --port 5200 --strictPort
```

Si faltan archivos, el comando de API no arranca: no crea una base vacía como sustitución. Si un puerto está ocupado, comprobar su propietario; no terminar servidores ajenos. No ejecutar `lab:create` para reiniciar el laboratorio: no es necesario y se conservará el trabajo.

#### Detener

En las terminales donde los arrancaste, **Ctrl+C**, una vez en cada una. Para los procesos activos al 2026-11-08, los PIDs comprobados son API **3560996** y Vite **3392993**:

```bash
kill -TERM 3560996 3392993
```

Estos PIDs son los de esta ejecución; tras volver a arrancar cambian. Comprobarlos antes de usar `kill`:

```bash
ss -ltnp 'sport = :3200 or sport = :5200'
```

Detener los procesos no borra SQLite ni su metadata. La API personal en 3001 y el frontend preexistente en 5173 no se reiniciaron.

## Guardar no significa evaluar

Tras guardar ejecución, cuestionario, programación, parámetros o referencias se muestra **«Datos guardados · evaluación pendiente de actualizar»**. El aviso persiste al recargar y solo se limpia después de un `POST /evaluate` exitoso. Si falla, el aviso queda.

La fecha seleccionada está en la URL (`cutoff`). Se envía a evaluación, rendimiento, series, carga semanal, marcas, comparativa semanal y proyección. La evaluación guardada indica su propio corte; seleccionar otra fecha no genera una evaluación sin acción del coach.

`GET /state.freshness` es la fuente oficial para la vigencia: detecta también cambios hechos por otros clientes en las entradas conocidas al corte. La UI la consulta al cargar, guardar y recuperar foco. El indicador local se conserva como respaldo mientras carga o para evaluaciones anteriores sin huella. Un dato posterior al corte no se presenta como modificación de esa evaluación; se invita a elegir otra fecha para analizarlo. No se promete sincronización en tiempo real ni funcionamiento offline.

## Curva y proyección

El adaptador `apps/web/src/performance/adapter.ts` usa `PerformanceProjection` de contracts. Observaciones, ajuste, proyección y rango se dibujan según disponibilidad. No hay regresión, probabilidades o intervalos calculados en frontend.

- Baseline seleccionado: **«Proyección de mantenimiento del nivel reciente»**. Se dibuja exactamente la proyección del servidor, sin inclinarla para mostrar mejora.
- Estado descriptivo: observaciones/ajuste, sin futuro ni banda.
- Estado indisponible: motivos del backend, sin puntos residuales.
- Banda solo si está disponible; si el rango se entrega únicamente en el horizonte, se representa como rango puntual, sin interpolarlo a otros días.
- Métodos y variantes separados; marcas reales aparte. Método desconocido no se sustituye por otro.
- Los avisos de calibración y cobertura que entregue Claude se muestran siempre; el rango se identifica como empírico no calibrado, sin prometer un porcentaje de cobertura.
- La fecha del corte, los períodos de vista/entrenamiento, calidad y limitación principal son consultables. Un 404 conserva el histórico; otros fallos permiten reintentar.

Fixture sintético de pruebas en `apps/web/test/fixtures`; no se importa desde producción. El fixture y los tipos del adaptador pasan los checks actuales.

## Validación reproducible sin tocar BD reales

Desde `app/`, terminales separadas (preparación del entorno una sola vez; las operaciones del usuario son formularios):

```bash
INSTANCE_MODE=laboratory INSTANCE_ID=frontend-lab-memory BASE_UI_TEST_PORT=3127 BASE_UI_TEST_ORIGIN=http://127.0.0.1:5198 node --import tsx apps/web/test/browser-server.ts
VITE_BASE_MODE=laboratory WEB_API_TARGET=http://127.0.0.1:3127 npm run dev -w @coaching/web -- --port 5198 --strictPort
python3 apps/web/test/browser-laboratory.py
```

El servidor de pruebas usa la API real con SQLite en memoria y un fixture propio. No ejecuta seeds ni abre archivos SQLite. Los casos persistentes de Claude se preparan por separado.

La prueba de navegador verifica también que una modificación desde otro cliente invalida la evaluación mediante la huella del servidor.

La prueba de navegador verifica: entrada identificada, alta de atleta ficticio, macro/meso sin IDs manuales, sesión con preview, recarga, duplicación, cambio de protocolo, borrador de registro tras recarga, error de red/reintento, cuestionario, fecha/evaluación y análisis móvil. Consulta la API para comprobar que la copia no llevó resultados y que los cambios persistieron. Capturas/resultados: `docs/frontend-captures/laboratorio/`.

Checks específicos:

```bash
npm exec eslint -- apps/web
npm run typecheck -w @coaching/web
npm test -w @coaching/web
npm run build -w @coaching/web
```

No se instalaron dependencias ni se modificaron raíz, lockfiles, motor, contratos, API o migraciones. Sin commit, push ni deploy.

## Recorrido sugerido para el coach

1. Abrir **http://127.0.0.1:5200**, comprobar «Laboratorio · datos ficticios» y elegir **LAB-A · Progreso**, corte **2026-08-09** (semana 10).
2. Abrir Resumen y Evidencia. Alternar PROGRAMAR, REGISTRAR y ANALIZAR: la fecha se conserva y la curva usa ese corte.
3. Para modificar sin alterar los casos canónicos, volver al inicio y crear un atleta ficticio propio. Crear macro/meso/sesión, publicar, duplicar y registrar desde formularios.
4. Guardar registros o cuestionarios; el aviso distingue datos guardados de evaluación actualizada. Elegir fecha y pulsar Actualizar evaluación.
5. Recargar: los datos se leen de SQLite. Puede cerrarse y volver a arrancarse API/web con los comandos anteriores sin perder el trabajo.
6. Probar después LAB-C para mantenimiento y LAB-D para faltantes. Los casos son ficticios y las recomendaciones no son resultados garantizados.

## Validación de integración persistente

- Script: `apps/web/test/persistent-laboratory.py` (`before`, `offline`, `after`); evidencia en `docs/frontend-captures/persistente/`.
- Confirmados A–F y todos los cortes del catálogo oficial en la interfaz.
- LAB-A al `2026-08-09`: evaluación vigente, programación, ejecución, curva observada/proyectada y evidencia accesibles; navegación conserva `cutoff`.
- Atleta ficticio separado creado por UI. Se guardó un cuestionario, se evaluó, se modificó sueño a **9** y se comprobó tras recarga. Ningún caso canónico A–F fue modificado.
- API detenida deliberadamente: la UI muestra error/Reintentar y ningún catálogo de sustitución en memoria.
- Reiniciadas únicamente API 3200 y Vite 5200 levantadas por este agente. Tras reiniciar: mismo `datasetId`, atleta y valor **9**; evaluación marcada obsoleta por huella. Re-evaluar desde UI limpió el aviso.
- Verificado archivo SQLite en modo de solo lectura con `PRAGMA quick_check`: **ok**; seis casos y un atleta ficticio de prueba.
- Checks de frontend: TypeScript, **16 tests** y build aprobados. No se alteraron fórmulas, motor, contratos, API o migraciones; no se tocaron datos reales, no hubo commit/push/deploy.

Comandos del test (solo sobre esta BD identificada; `before` crea un atleta ficticio nuevo, no reinicia datos):

```bash
python3 apps/web/test/persistent-laboratory.py before
# Detener solo API 3200; conservar frontend 5200 para observar el fallo.
python3 apps/web/test/persistent-laboratory.py offline
# Detener frontend; volver a arrancar API y frontend con los comandos documentados.
python3 apps/web/test/persistent-laboratory.py after
```

Las fases preservan un comprobante sintético en `docs/frontend-captures/persistente/proof.json`; no contiene datos personales ni una copia de la BD.

## Simplificación del análisis · 2026-11-08

El Resumen y la pestaña Análisis abren ahora **Entrenamiento en números**, centrado en SI, NL, tonelaje, volumen muscular, singles realizados y e1RM. No se eliminaron otras métricas: el análisis anterior completo se monta al abrir **Análisis avanzado**; las conclusiones del motor, recomendaciones y resumen de semana están en **Estado del atleta, recomendaciones y semana actual**.

- **Carga:** selector SI/NL/tonelaje; barras y tabla con previsto/realizado por semana. Selector de ejercicio y variante; semanas parciales identificadas.
- **Sesión a sesión:** detalle de prescripción y ejecución de las series; acceso al registro. Dosis realizadas oficiales desde `GET /core?view=sessions`, filtradas por ejercicio y variante sin combinar entrenamientos del mismo día. Incluye e1RM y volumen muscular por sesión, también para registros importados. La prescripción se consulta en las series; no se calcula un total planificado por sesión en el cliente.
- **Volumen muscular:** series equivalentes realizadas por grupo; directas, indirectas y convención desplegables. No se suman grupos superpuestos; ejercicios sin mapeo visibles.
- **Fuerza:** e1RM observado con método explícito, o cargas de singles realizados. El mejor single hasta el corte se distingue del último e1RM del período; no se afirma que un single sea un test máximo validado. Referencias de prescripción en detalle. La vista básica no presenta proyecciones ni leyendas de curvas inexistentes.
- **Contexto:** período, corte, ejercicio/variante y escala semanal/sesión se conservan en URL. Detalles del cálculo y catálogo bajo demanda. No se agregaron dependencias ni se cambiaron fórmulas, contratos, API o datos.

Archivos: `apps/web/src/workspace/EssentialAnalysis.tsx`, `Analysis.tsx`, `pages/AthletePage.tsx`, `performance/PerformanceCurve.tsx`, `workspace/core.ts`, `experience.css`.

Para probar: abrir `http://127.0.0.1:5200`, LAB-A al corte **2026-08-09**. En Resumen elegir ejercicio, alternar SI/NL/tonelaje, cambiar entre semanas y sesiones y consultar volumen muscular y fuerza debajo. **Ver datos** abre los datos oficiales; el resto del análisis permanece desplegable.

Validación de lectura (no escribe en API/SQLite): `python3 apps/web/test/essential-analysis.py`. Comprueba valores del endpoint, detalle, sesiones oficiales y variantes, curva, ausencia honesta de singles, avanzado, retorno, recarga, celular de 390 px y error de red/Reintentar. También contrasta las sesiones de LAB-E con `/core` y consulta faltantes de LAB-D sin rellenarlos. Capturas y comprobantes: `docs/frontend-captures/esencial/`.

Validaciones de la entrega anterior (referencia histórica; ver los checks de planillas al final):

- ESLint de `apps/web`, TypeScript y build frontend: aprobados; **16 tests frontend** aprobados.
- Typecheck general y **419 tests combinados** (contracts 4, engine 290, API 109, web 16): aprobados sobre el estado compartido observado.
- `npm run ci` se detuvo en formato por archivos no cambiados en esta entrega: `docs/frontend-captures/persistente/offline-checks.json`, `docs/frontend-handoff/DOMAIN.md`, `docs/REGLAS_Y_PROCEDENCIA.md`. Lint general, ejecutado aparte, detectó `packages/engine/src/core.ts:243`: `addDays` declarado sin uso. No se modificó el trabajo de Claude para resolver estos avisos.
- El build general fue interrumpido con señal 143; build frontend repetido y aprobado. No se informa CI general verde.
- La API de laboratorio 3200 no estaba escuchando durante la comprobación posterior: se volvió a arrancar solo esa instancia propia con el comando documentado, mismo SQLite y `datasetId`, sin regenerar datos. Vite 5200 se conservó. El nuevo endpoint `/core` quedó accesible y conectado.

## Plantel, gráficos simultáneos y planillas · 2026-11-08

Esta sección sustituye el recorrido por selectores del resumen anterior. La URL de uso sigue siendo **http://127.0.0.1:5200**; no cambió su SQLite ni se modificaron los casos de esa instancia durante estas pruebas.

- **Atletas corregido:** el enlace lateral siempre abre el plantel, también desde un perfil. Enfoca el listado después de cargar y conserva sus filtros.
- **Análisis simultáneo:** SI, NL y tonelaje se muestran a la par en escritorio, sin alternar una métrica por vez. Debajo aparecen los gráficos por movimiento/patrón, todos los grupos musculares presentes (más cuádriceps, isquios y core con vacío honesto) y fuerza por ejercicio/variante. Período y escala semanal/sesión compartidos y conservados en URL; mismos extremos temporales en todos los gráficos. En celular los paneles se apilan.
- **SI oficial:** totales SQ/BP/DL de `/core` filtrado por lift. Las curvas se ubican inicialmente con `exercises[].pattern` (`patrones-v1`) del motor y se pueden reorganizar localmente en tracción/empuje horizontal/vertical; no se suman ni reclasifican en el motor. **El SI por músculo todavía no existe en la respuesta del backend**: se muestra volumen muscular y se informa ese límite. Necesidad concreta en `FRONTEND_BACKEND_REQUESTS.md`.
- **Fuerza:** observaciones por método, con trazos y leyendas separados; singles realizados de sesiones programadas como puntos distintos. No se fabrica un 1RM validado ni se unen métodos en una misma serie. El análisis anterior, sus tablas de previsto/realizado, evidencias y otras métricas siguen bajo detalle por ejercicio y análisis avanzado.
- **Programación:** al abrir una semana se ofrece planilla editable y, alternativamente, sesiones en columnas. Una fila por serie conserva aproximaciones/top/backoffs. Edición directa de ejercicio, reps, kg, RPE, modo, porcentaje, tope, tempo, pausa, instrucciones/descanso y variante. La referencia ya guardada se preserva; el contrato de `change_protocol` no admite cambiar `refKg`.
- **Crear sesión:** planilla de segmentos en escritorio (series/reps/kg/RPE/tipo/modo/referencia/notas), con agregar/quitar segmentos, preview real y publicación. El formulario anterior sigue disponible y es la opción inicial en celular. Descanso sigue siendo una instrucción, tal como permite el backend.
- **Registro:** planilla con prescripción al lado de carga/reps/RPE realizados, estado y fecha. En celular inicia por fichas y permite alternar a planilla. Marcar filas cargadas como realizadas es una acción explícita. Nunca se rellena el RPE real con el objetivo.
- **Interacción:** pegado rectangular desde Excel, decimales con coma, validación completa del rango antes de editar, Tab/Enter/flechas y etiquetas por celda. Borradores locales conservados ante error y recarga. Programación requiere «Revisar cambios» y una publicación conjunta explícita; cada operación real tiene su propia versión, no se promete transacción batch. En conflictos se puede recargar el plan conservando el borrador. Ningún resultado se copia al editar o duplicar programación.

Archivos nuevos: `workspace/AnalysisOverview.tsx`, `OverviewChart.tsx`, `DataSheet.tsx`, `sheetModel.ts`, `ProgrammingSheet.tsx`. Se modificaron exclusivamente frontend, tests frontend y esta documentación.

### Validación de escritura aislada

No se usó la BD persistente del coach ni la del laboratorio 5200 para las pruebas de escritura. Se creó un laboratorio exclusivo con el comando existente, que rechaza sobrescrituras:

```bash
npm run lab:create -w @coaching/api -- /tmp/base-planilla-pruebas-20261108-785421.sqlite
DB_PATH=/tmp/base-planilla-pruebas-20261108-785421.sqlite HOST=127.0.0.1 PORT=3298 WEB_ORIGIN=http://127.0.0.1:5298 node --import tsx apps/api/src/server.ts
VITE_BASE_MODE=laboratory WEB_API_TARGET=http://127.0.0.1:3298 npm run dev -w @coaching/web -- --host 127.0.0.1 --port 5298 --strictPort
python3 apps/web/test/overview-sheet.py
```

El script valida la identidad ficticia contra la metadata de esa ruta y solo escribe en 5298/3298. Comprueba: acceso a Atletas desde inicio/perfil; tres gráficos en paralelo; edición/pegado y teclado; borrador al recargar; preview y publicación de dos cambios sin modificar ejecución; error de red y reintento en programación y registro; RPE real opcional sin relleno; persistencia; celular; creación de una sesión con dos top sets y tres backoffs sin resultados. Capturas y comprobantes en `docs/frontend-captures/planilla/`.

El script anterior `essential-analysis.py` ahora despliega el detalle por ejercicio antes de comprobar el recorrido detallado; `persistent-laboratory.py` también abre los detalles necesarios. No se volvieron a ejecutar sus fases de escritura sobre el laboratorio persistente.

### Resultado de la validación final de planillas

- `npm run ci` general: **aprobado**, con **434 tests** combinados (4 contracts, 299 engine, 111 API, 20 frontend), formato, lint, tipos y builds. Se corrigió únicamente el formato de `docs/frontend-captures/persistente/offline-checks.json`, un comprobante frontend anterior; no hubo cambios de fuentes fuera del alcance.
- Tras integrar `exercises[].pattern`: ESLint frontend, TypeScript y los 20 tests frontend aprobados; comprobación en navegador del patrón oficial de un accesorio real de la base sintética.
- `overview-sheet.py`: **10 escenarios aprobados** con escrituras exclusivamente en la BD temporal. `essential-analysis.py`: **9 escenarios de lectura aprobados** sobre el laboratorio persistente, conservando detalle, avanzado, fechas, errores recuperables y faltantes.
- Los procesos propios de API se reiniciaron de forma controlada, después de terminar los tests activos, para incorporar los patrones nuevos de Claude. La API persistente sigue en 3200 con la misma ruta e identidad; Vite 5200 no se detuvo. No se volvieron a generar sus datos ni se ejecutaron evaluaciones de escritura.
- Los procesos temporales 3298/5298 se detuvieron al finalizar. El archivo SQLite temporal queda en `/tmp/base-planilla-pruebas-20261108-785421.sqlite`; para repetir, iniciar la API y Vite de prueba sobre ese archivo existente, **sin repetir `lab:create`**. Para una ejecución nueva, elegir otra ruta exclusiva y actualizar el script de identidad.
- No hubo commit, push ni deploy; ningún dato real se usó en las pruebas.

## Adaptación posterior a los cambios de Claude · 2026-11-08

Se revisaron `VARIABLES_NUCLEO.md`, migración/compatibilidad, contratos, implementación de `/core` y respuestas reales. No hubo otro rediseño ni cambios de motor/API/contratos/BD real.

- **Rangos de repeticiones:** creación y edición de planillas aceptan `Reps máx`. El mínimo sigue siendo `reps`; dejar el máximo vacío conserva una prescripción fija (al editar un rango lo limpia con `null`). Se valida que máximo ≥ mínimo. Registro por planilla/fichas, sesiones en columnas, detalle de análisis y exposición anterior muestran `8–10`, sin cambiar los resultados reales.
- **Respuesta entre series:** en Registro, desplegar **Comparar series con lo previsto**. Consulta `fatiga-v2` de `/core` para esa sesión, muestra objetivo/rango, reps y RPE real, posición respecto del rango y diferencias de RPE frente al objetivo y la serie anterior. Todos los deltas y posiciones vienen del backend. Se informa el corte y que los borradores aún no se analizan; una sesión posterior al corte no se presenta como observada.
- **Patrones:** en análisis, desplegar **Volumen oficial por patrón · series, NL y tonelaje** para ver `patterns` y `patrones-v1`, por semana o sesión. Estos totales no son una suma del frontend ni un SI muscular.
- **Músculos:** cada gráfico permite abrir repeticiones y tonelaje equivalentes oficiales. Los pesos y versión de la convención se leen del backend, sin fijarlos en el cliente.
- **SI:** el botón de datos del gráfico consulta bajo demanda modelo/revisión/tablas de `/api/tables/si/rts`, incluyendo `rts-si-r2`. La curva y las recomendaciones siguen usando únicamente resultados de API. No se reevalúa automáticamente ni se reescriben evaluaciones guardadas.
- **Compatibilidad:** `SessionRow` todavía tiene un protocolo manual sin `repsMax` en contracts. Se agregó un lector seguro solo en frontend; el desajuste está documentado para Claude en `FRONTEND_BACKEND_REQUESTS.md`.

Archivos principales: `workspace/prescription.ts`, `SessionResponse.tsx`, `core.ts`, `ProgrammingSheet.tsx`, `Programming.tsx`, `Registration.tsx`, `AnalysisOverview.tsx`, `EssentialAnalysis.tsx`, `ExposureHistory.tsx`. Las demás métricas siguen disponibles bajo demanda.

Validación reproducible: `overview-sheet.py` sobre la base temporal exclusiva documentada arriba; se ampliaron los casos para edición y creación de rangos, persistencia, respuesta oficial `fatiga-v2`, volumen por patrón y revisión SI. Las escrituras no se ejecutan sobre el laboratorio persistente 5200. Las capturas se guardan en `docs/frontend-captures/planilla/`, incluida `respuesta-series.png`.

Validaciones de esta adaptación: **`npm run ci` completo aprobado, 436 tests** (4 contracts, 299 motor, 111 API, 22 frontend), lint, formato, tipos y builds. **13 escenarios de navegador** en el laboratorio temporal, más lectura del detalle muscular en 5200 (10 semanas y móvil sin desborde). Se verificaron rangos persistidos y consulta de la revisión SI real. Los servidores temporales 3298/5298 se cerraron al terminar; 3200/5200 se conservaron sin reinicios.
