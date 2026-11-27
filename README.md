# FieldConnect Group

Plataforma de seguimiento de servicios de ingeniería de campo con el logo oficial de FieldConnect Group.

**Aplicación:** [FieldConnect Group](https://mrp4blomanzo.github.io/FieldConnect/). La interfaz se publica en GitHub Pages y la API se ejecuta en Supabase Edge Functions, con datos compartidos en PostgreSQL.

## Accesos y tickets

Solo hay dos perfiles de acceso: **Administrador** y **Directivo**. Ambos crean y supervisan tickets y administran los catálogos. Los ingenieros de apoyo y los IDC son personal del directorio, sin login.

Al crear un ticket se escribe libremente el nombre de la empresa y se seleccionan **ingeniero de base de proyecto / apoyo** e **IDC** del directorio, con sus estados de cobertura en México. También se registra el estado del servicio y el **ID de acceso / folio de entrada**. El **SITE ID** se genera al guardar como consecutivo por empresa (`000001`, `000002`, …). Cambiar mayúsculas o espacios en el nombre reutiliza la misma empresa y su consecutivo.

Administrador y Directivo completan la coordinación y registran el inicio, las incidencias, el checklist, las evidencias y el cierre. El cierre requiere seis puntos del checklist, resultado escrito y al menos una evidencia HTTP/HTTPS.

Los accesos iniciales y contraseñas están en `.local/ACCESOS.txt` del equipo donde se preparó el despliegue. Ese archivo no se publica. El botón **Contraseña** permite cambiarlas e invalida las sesiones anteriores.

## Analítica

**Analítica y reportes** ofrece semana actual (lunes a domingo), mes actual, rango de fechas y todo el historial, con exportación CSV. Los días se interpretan en `America/Mexico_City` e incluyen la fecha final completa.

Los reportes muestran creados, abiertos, completados, estados, tipos de servicio, prioridades, empresas, estados de México, asignaciones IDC y tiempos medios de cierre. Las distribuciones se basan en los tickets creados dentro del rango; los cierres y tiempos usan la fecha real de finalización. La tasa de cierre corresponde a los completados de la cohorte creada en el periodo.

La satisfacción se registra al cerrar o después en el detalle del ticket: satisfecho, neutral, insatisfecho o sin evaluar. Su porcentaje se calcula sobre las evaluaciones registradas de los cierres del periodo; los tickets sin evaluación no se consideran satisfechos.

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

La raíz se sincroniza con `public/` al construir para que también funcione la publicación de Pages desde una rama. Las evidencias se registran por URL; no hay carga de archivos binarios, MFA ni recuperación de contraseña por correo en esta versión.
