# FieldConnect Group

Plataforma de seguimiento de servicios de ingeniería de campo con el logo oficial de FieldConnect Group.

**Aplicación:** [FieldConnect Group](https://mrp4blomanzo.github.io/FieldConnect/). La interfaz se publica en GitHub Pages y la API se ejecuta en Supabase Edge Functions, con datos compartidos en PostgreSQL.

## Accesos y tickets

Solo hay dos perfiles de acceso: **Administrador** y **Directivo**. Ambos crean y supervisan tickets y administran los catálogos. Los ingenieros de apoyo y los IDC son personal del directorio, sin login.

Al crear un ticket se seleccionan empresa, **ingeniero de base de proyecto / apoyo** e **IDC** del directorio, y se captura el **ID de acceso / folio de entrada**. El **SITE ID** se genera al guardar como consecutivo por empresa (`000001`, `000002`, …), protegido contra duplicados por PostgreSQL.

Administrador y Directivo completan la coordinación y registran el inicio, las incidencias, el checklist, las evidencias y el cierre. El cierre requiere seis puntos del checklist, resultado escrito y al menos una evidencia HTTP/HTTPS.

Los accesos iniciales y contraseñas están en `.local/ACCESOS.txt` del equipo donde se preparó el despliegue. Ese archivo no se publica. El botón **Contraseña** permite cambiarlas e invalida las sesiones anteriores.

## Desarrollo y despliegue

Consulta [la guía de Supabase y GitHub Pages](docs/SUPABASE.md).

- `npm ci`: instala dependencias.
- `npm test`: pruebas de migración, API, sesiones y adaptación Fetch.
- `npm run build:web`: prepara `public/` en `dist/` para Pages.
- `npm run build:edge`: sincroniza los controladores compartidos de la función Supabase.
- `npm start`: servidor Express local, con las variables de `.env.example`.
- `npm run db:init`: inicializa/migra la base seleccionada.
- `npm run db:demo`: carga catálogos y un ticket ficticios, de forma opcional.

El workflow de GitHub publica la interfaz al actualizar `main`. La API se despliega en Supabase por separado. La versión de Express y la función remota comparten `src/api.js`.

Las tablas están en el esquema privado `fieldconnect`, con RLS habilitado. La API usa credenciales del entorno de Supabase y comprueba cuenta, rol y versión de sesión en cada petición. La interfaz no contiene secretos de base de datos. Se conservan intactas las tablas anteriores de `public`.

El demo estático anterior permanece en la raíz del repositorio; usa datos locales del navegador y no es la aplicación publicada. Las evidencias se registran por URL; no hay carga de archivos binarios, MFA ni recuperación de contraseña por correo en esta versión.
