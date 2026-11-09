# Portal del atleta

Ruta del frontend: `#/atleta` (pensada para el celular). El coach la comparte; el atleta entra con el mail y la contraseña que le asignó.

## Coach

- **Configuración → Acceso del atleta:** asigna email y contraseña (mín. 6; se guarda con hash scrypt) y elige qué ve por defecto de cada serie.
- **Editar sesión → «El atleta ve en este entreno»:** cambia la vista de ese entreno. Series de calentamiento, top set y backoff se marcan escribiendo `aprox`, `top` o `backoff` al final de la línea en la carga rápida.
- Vistas: **Carga (kg) y RPE** · **Solo RPE** (sin kg ni %) · **Solo carga** (sin RPE) · **RPE y % del RM** (sin kg). Lo que no se muestra no sale del servidor.

## API

`PUT|GET|DELETE /api/athletes/:id/account` · `GET|PUT /api/athletes/:id/view-settings` (coach) ·
`POST /api/auth/login|logout` · `GET /api/me/home|plan|next|sessions/:key` · `PUT /api/me/sets` · `POST /api/me/checkins` · `POST /api/me/sessions/:key/finish` (atleta, `Authorization: Bearer`).

## Límite conocido

Las rutas del coach siguen sin autenticación (demo local). Con el token de un atleta se rechazan (403), pero no hay login de coach: no exponer la API a Internet así.
