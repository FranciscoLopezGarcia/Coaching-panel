# Simulación de demostración (5 atletas)

La base `apps/api/data/base-5-atletas-20261108.sqlite` tiene el **plan real** de los Excel del coach, completado y con una **ejecución SIMULADA**.

- **1RM informados por el coach** (SQ-BP-DL): Juli 210-125-235 · Estefi 155-90-175,5 · Dylan 210-115-220 · Marian 225-135-245 · Lueto 140-100-180. Se guardaron como referencias `decision_del_coach`, vigentes desde el primer día del plan.
- **Plan completado:** kg desde RPE (curva RTS) y RPE desde kg/1RM. Los ejercicios que no son los tres movimientos usan un 1RM de referencia supuesto (fracción del movimiento principal según patrón): es un supuesto de la demo.
- **Ejecución simulada** hasta hoy (2026-11-09): reps dentro del rango con caída por fatiga, RPE = objetivo + deriva + ruido, ~2 % de series omitidas, fatiga de fin de sesión y check-ins. Semilla fija (repetible). En el historial de ediciones cada serie dice «SIMULADO».
- **No es lo que levantaron los atletas.** Para volver a datos reales hay que borrar las series ejecutadas y los check-ins de estos atletas.

Regenerar: `npx tsx apps/api/src/seed/simulacion-demo.ts <carpeta-con-csv> --today AAAA-MM-DD` (con la API corriendo).
