# FieldConnect Group en Supabase y GitHub Pages

La aplicación publicada usa **GitHub Pages** para la interfaz y **Supabase Edge Functions** para la API. Los tickets se guardan en PostgreSQL, dentro del esquema privado `fieldconnect` del proyecto existente.

- Web: https://mrp4blomanzo.github.io/FieldConnect/
- Proyecto: https://supabase.com/dashboard/project/yyueagefcfoqesmegvtd
- API: https://yyueagefcfoqesmegvtd.supabase.co/functions/v1/fieldconnect-api/api/health
- Código de la función: `supabase/functions/fieldconnect-api/`
- Configuración pública de la interfaz: `public/config.js`

## Acceso

Las cuentas iniciales son `admin@fieldconnect.local` y `directivo@fieldconnect.local`. Sus contraseñas aleatorias están únicamente en `.local/ACCESOS.txt` del equipo donde se preparó el despliegue. La carpeta `.local/` está excluida de Git. Puedes cambiarlas con el botón **Contraseña** dentro de la aplicación. Cambiar la contraseña invalida las sesiones anteriores.

El correo se utiliza como identificador. Estas direcciones iniciales no reciben mensajes. Esta versión no incluye restablecimiento de contraseña por correo.

Solo Administrador y Directivo pueden iniciar sesión. Ingenieros de apoyo e IDC se seleccionan desde un directorio independiente, sin login. No existe registro público de cuentas. Los intentos de login fallidos se limitan a diez por identificador durante quince minutos.

## Datos y seguridad

El esquema `fieldconnect` conserva separadas las tablas anteriores de `public`. Contiene empresas, personal, tickets, eventos, notas, evidencias, cuentas y control de intentos de acceso. Las tablas tienen RLS habilitado y no permiten acceso directo desde el navegador.

La función usa `SUPABASE_DB_URL`, disponible dentro del entorno de Supabase, para acceder a PostgreSQL. La firma de sesiones utiliza un secreto disponible únicamente en el servidor. La web recibe solamente la URL pública de la API; no contiene la contraseña PostgreSQL ni claves privilegiadas.

La función comprueba su propio token JWT y vuelve a consultar en cada petición que la cuenta siga activa, tenga rol permitido y conserve la versión de sesión. Por ello la validación de JWT del gateway de Supabase está desactivada y la autenticación se realiza dentro de la función. Esto también permite recibir la petición inicial de login sin sesión.

El SITE ID se genera atómicamente por empresa (`000001`, `000002`, etc.). La combinación empresa/SITE ID es única y queda fija. El folio global del ticket es independiente. El ID de acceso / folio de entrada lo captura el usuario.

## Cobertura y reportes

`mexico_states` contiene las 32 entidades federativas. `employee_coverage` relaciona un IDC con uno o varios estados, sin darle acceso al sistema. El directorio permite modificar esa cobertura. Los ejemplos de cobertura se asignan únicamente al personal ficticio del seed; un registro anterior sin datos muestra “Cobertura por definir”.

La empresa se escribe en el formulario. La API busca su nombre normalizado (espacios y mayúsculas) dentro de la misma transacción que crea el ticket y registra una empresa nueva si hace falta. Un bloqueo de transacción impide duplicarla durante altas simultáneas por la API.

`GET /api/analytics` agrega todos los registros del periodo, independientemente del límite de la lista de tickets. Acepta `period=week|month|custom|all`, `from` y `to` para un rango personalizado y `group=day|week|month` opcional. Las fechas usan Ciudad de México y la fecha final se incluye completa. El máximo por consulta es diez años.

`PUT /api/tickets/:id/satisfaction` guarda o actualiza la evaluación de un ticket completado y registra un evento de auditoría. Los estados disponibles son `satisfied`, `neutral`, `unsatisfied` y `null` (sin evaluación). Al completar el servicio también se puede enviar `satisfaction` y `satisfaction_notes`.

Los índices de `created_at` y `closed_at` apoyan los reportes. `src/migration-analytics.sql` conserva los tickets históricos y deja sin estado o evaluación los datos que no se hayan registrado. No infiere satisfacción a partir de un cierre.

El PNG oficial recibido se conserva sin alterar; su fondo cuadriculado está integrado en los píxeles del archivo y no es transparencia real. Los colores de interfaz corresponden a la paleta corporativa solicitada.

## Publicación y mantenimiento

Un cambio en `main` ejecuta las pruebas y publica `public/` en GitHub Pages. `npm run build:web` prepara ese sitio en `dist/` y sincroniza la entrada de la raíz para que la publicación desde una rama también muestre la aplicación conectada.

Los controladores de API se comparten entre Express y Supabase:

- `src/api.js`: reglas y endpoints.
- `src/fetch-router.js`: adaptación a solicitudes Fetch.
- `npm run build:edge`: actualiza las copias ESM dentro de la función.
- `supabase/functions/fieldconnect-api/index.ts`: PostgreSQL, sesiones y CORS del entorno remoto.

Para cambiar la API, ejecuta `npm run build:edge`, pasa las pruebas y despliega `fieldconnect-api` en el mismo proyecto usando el conector o CLI de Supabase. El despliegue de la API se realiza por separado del workflow de Pages. Al usar el conector indica `index.ts` como entrada, `deno.json` como import map y conserva la autenticación propia del código.

## Ejecución local con Express

1. Ejecuta `npm ci`.
2. Copia `.env.example` a `.env` y configura la conexión **Session pooler** del panel, `DATABASE_SCHEMA=fieldconnect`, TLS y un secreto JWT de 32+ caracteres.
3. Si necesitas inicializar una instalación nueva, ejecuta `npm run db:init`; `npm run db:demo` carga datos ficticios de manera opcional.
4. Inicia con `npm start` y abre `http://localhost:3000`.

No es necesario configurar `.env` para utilizar la web publicada. La API desplegada usa el entorno privado de Supabase. [Conexiones PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres) y [variables de Edge Functions](https://supabase.com/docs/guides/functions/secrets).

`npm test` verifica migraciones, permisos, sesiones, numeración, asignaciones y cierre. `node scripts/smoke-live.js` realiza una prueba con un ticket ficticio en la base real y guarda el resultado en `.local/smoke-result.json`; necesita los accesos privados del equipo de despliegue.
