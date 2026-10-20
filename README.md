# FieldConnect Group

Plataforma web de gestión de operaciones de ingeniería de campo.

## Stack

- Node.js 20+
- Express
- PostgreSQL
- JWT + bcrypt
- Interfaz web responsive en español

## Funciones

- Roles: administración (`admin`), ingeniería de apoyo (`logistics`) e IDC (`idc`).
- Creación y consulta de tickets de servicio.
- Coordinación logística previa y liberación del servicio.
- Reserva exclusiva de tickets mediante una actualización atómica en PostgreSQL.
- Seguimiento de ejecución, espera, notas técnicas e incidencias.
- Checklist de cierre de seis puntos, resultado escrito y al menos una evidencia.
- Historial de auditoría.
- Información económica restringida a administración.
- Configuración inicial de despliegue en Render (`render.yaml`).

## Requisitos

Node.js 20+, npm y PostgreSQL 14+.

## Ejecución local

1. Instala dependencias: `npm install`.
2. Copia `.env.example` a `.env` y configura `DATABASE_URL`, `JWT_SECRET` (mínimo 32 caracteres) y una contraseña administrativa segura.
3. Inicializa el esquema: `npm run db:init`.
4. Inicia: `npm start`.
5. Abre `http://localhost:3000`.

Genera un secreto JWT con `openssl rand -hex 32`. El administrador inicial se crea si `SEED_ADMIN_PASSWORD` tiene al menos 12 caracteres y no utiliza la contraseña de ejemplo.

## Despliegue

1. Conecta el repositorio en Render mediante **New → Blueprint**.
2. Revisa el PostgreSQL gestionado creado por `render.yaml`.
3. Establece `SEED_ADMIN_PASSWORD` como secreto seguro en las variables del servicio.
4. Despliega y comprueba `/api/health`.
5. Inicia sesión usando `SEED_ADMIN_EMAIL` y la contraseña configurada.

No subas archivos `.env` ni credenciales a GitHub.

## Endpoints principales

| Método | Ruta | Acceso | Función |
|---|---|---|---|
| GET | `/api/health` | Público | Estado del servidor |
| POST | `/api/auth/login` | Público | Iniciar sesión |
| GET | `/api/auth/me` | Autenticado | Usuario actual |
| GET | `/api/tickets` | Autenticado | Listar tickets según rol |
| POST | `/api/tickets` | Admin | Crear ticket |
| GET | `/api/tickets/:id` | Autenticado | Consultar detalle e historial |
| POST | `/api/tickets/:id/claim-logistics` | Logística | Reclamar coordinación |
| POST | `/api/tickets/:id/release` | Logística/Admin | Liberar para IDC |
| POST | `/api/tickets/:id/claim-idc` | IDC | Reservar servicio |
| POST | `/api/tickets/:id/status` | Según transición | Cambiar estado |
| PUT | `/api/tickets/:id/checklist` | IDC asignado | Actualizar checklist |
| POST | `/api/tickets/:id/notes` | Según asignación | Nota, incidencia o bloqueo |
| POST | `/api/tickets/:id/evidence` | IDC asignado/Admin | Registrar evidencia por URL |
| GET | `/api/users` | Admin/Logística | Consultar usuarios |
| POST | `/api/users` | Admin | Crear usuario |

## Limitaciones de esta versión

- La evidencia se registra mediante URL HTTP/HTTPS; no hay almacenamiento de archivos binarios.
- No incluye recuperación de contraseña ni MFA.
- La validación integral, pruebas automatizadas contra una base de datos real y revisión de seguridad son necesarias antes de utilizar datos productivos.
- Revisar los planes y costos de Render antes de desplegar.
