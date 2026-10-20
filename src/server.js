require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
const { pool } = require("./db");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET debe tener al menos 32 caracteres.");
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const ADMIN = "admin";
const LOGISTICS = "logistics";
const IDC = "idc";
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const required = (v) => typeof v === "string" && v.trim().length > 0;
const roles = (...allowed) => (req, res, next) => allowed.includes(req.user.role)
  ? next()
  : res.status(403).json({ error: "No tienes permisos para esta operación." });

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Inicia sesión para continuar." });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Sesión inválida o expirada. Inicia sesión nuevamente." });
  }
}
function event(client, ticketId, actorId, eventType, details) {
  return client.query(
    "INSERT INTO ticket_events(ticket_id,actor_id,event_type,details) VALUES($1,$2,$3,$4)",
    [ticketId, actorId, eventType, JSON.stringify(details || {})]
  );
}
const ticketSelect = "SELECT t.*, creator.name AS creator_name, logistics.name AS logistics_owner_name, idc.name AS idc_owner_name " +
  "FROM tickets t LEFT JOIN users creator ON creator.id=t.created_by " +
  "LEFT JOIN users logistics ON logistics.id=t.logistics_owner LEFT JOIN users idc ON idc.id=t.idc_owner";

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "FieldConnect Group" }));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const body = req.body || {};
  if (!required(body.email) || !required(body.password)) {
    return res.status(400).json({ error: "Correo y contraseña son obligatorios." });
  }
  const result = await pool.query(
    "SELECT id,name,email,password_hash,role,active FROM users WHERE email=LOWER($1)",
    [body.email.trim()]
  );
  const user = result.rows[0];
  if (!user || !user.active || !(await bcrypt.compare(body.password, user.password_hash))) {
    return res.status(401).json({ error: "Credenciales incorrectas." });
  }
  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

app.get("/api/auth/me", authenticate, asyncRoute(async (req, res) => {
  const result = await pool.query(
    "SELECT id,name,email,role,active FROM users WHERE id=$1",
    [req.user.id]
  );
  if (!result.rows[0] || !result.rows[0].active) return res.status(401).json({ error: "Usuario inactivo." });
  res.json({ user: result.rows[0] });
}));

app.get("/api/users", authenticate, roles(ADMIN, LOGISTICS), asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT id,name,email,role,active FROM users WHERE active=TRUE ORDER BY name");
  res.json({ users: result.rows });
}));

app.post("/api/users", authenticate, roles(ADMIN), asyncRoute(async (req, res) => {
  const b = req.body || {};
  if (!required(b.name) || !required(b.email) || !required(b.password) || b.password.length < 12 ||
      ![ADMIN, LOGISTICS, IDC].includes(b.role)) {
    return res.status(400).json({ error: "Nombre, correo, contraseña de al menos 12 caracteres y rol válido son obligatorios." });
  }
  const hash = await bcrypt.hash(b.password, 12);
  try {
    const result = await pool.query(
      "INSERT INTO users(name,email,password_hash,role) VALUES($1,LOWER($2),$3,$4) RETURNING id,name,email,role,active,created_at",
      [b.name.trim(), b.email.trim(), hash, b.role]
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Ya existe un usuario con ese correo." });
    throw err;
  }
}));

app.get("/api/tickets", authenticate, asyncRoute(async (req, res) => {
  const params = [];
  const conditions = [];
  if (req.user.role === IDC) {
    params.push(req.user.id);
    conditions.push("(t.idc_owner=$" + params.length + " OR (t.status='available' AND t.logistics_status='ready'))");
  } else if (req.user.role === LOGISTICS) {
    params.push(req.user.id);
    conditions.push("(t.logistics_owner=$" + params.length + " OR (t.logistics_status='pending' AND t.status='available'))");
  }
  if (req.query.status) {
    params.push(String(req.query.status));
    conditions.push("t.status=$" + params.length);
  }
  if (req.query.q) {
    params.push("%" + String(req.query.q).slice(0, 100) + "%");
    const n = params.length;
    conditions.push("(t.folio ILIKE $" + n + " OR t.client ILIKE $" + n + " OR t.site_id ILIKE $" + n + " OR t.project ILIKE $" + n + ")");
  }
  const sql = ticketSelect + (conditions.length ? " WHERE " + conditions.join(" AND ") : "") +
    " ORDER BY t.updated_at DESC LIMIT 300";
  const result = await pool.query(sql, params);
  res.json({ tickets: result.rows });
}));

app.post("/api/tickets", authenticate, roles(ADMIN), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const requiredFields = ["client","project","site_id","service_type","site_name","region","address","scope"];
  if (requiredFields.some((k) => !required(b[k]))) {
    return res.status(400).json({ error: "Completa cliente, proyecto, SITE ID, tipo de servicio, sitio, región, domicilio y alcance." });
  }
  const priority = b.priority || "normal";
  if (!["low","normal","high","urgent"].includes(priority)) return res.status(400).json({ error: "Prioridad inválida." });
  const paymentStatus = b.payment_status || "pending";
  if (!["pending","partial","paid","not_applicable"].includes(paymentStatus)) return res.status(400).json({ error: "Estado de pago inválido." });
  const amounts = ["agreed_amount","travel_expenses","other_expenses"].map((k) => b[k] === undefined ? 0 : Number(b[k]));
  if (amounts.some((n) => !Number.isFinite(n) || n < 0)) return res.status(400).json({ error: "Los importes deben ser números no negativos." });
  let scheduledAt = null;
  if (b.scheduled_at) {
    scheduledAt = new Date(b.scheduled_at);
    if (Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: "La fecha programada no es válida." });
  }
  const folio = "FC-" + new Date().toISOString().slice(0,10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2,7).toUpperCase();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await c.query(
      "INSERT INTO tickets(folio,client,project,site_id,service_type,site_name,region,address,contact_name,contact_phone," +
      "access_instructions,scheduled_at,priority,scope,activities,tools,materials,prerequisites,technical_notes," +
      "agreed_amount,travel_expenses,other_expenses,payment_status,financial_notes,created_by) " +
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING *",
      [folio,b.client.trim(),b.project.trim(),b.site_id.trim(),b.service_type.trim(),b.site_name.trim(),b.region.trim(),
       b.address.trim(),b.contact_name || "",b.contact_phone || "",b.access_instructions || "",scheduledAt,
       priority,b.scope.trim(),b.activities || "",b.tools || "",b.materials || "",b.prerequisites || "",
       b.technical_notes || "",amounts[0],amounts[1],amounts[2],paymentStatus,b.financial_notes || "",req.user.id]
    );
    await event(c, result.rows[0].id, req.user.id, "ticket_created", { folio: folio });
    await c.query("COMMIT");
    res.status(201).json({ ticket: result.rows[0] });
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally { c.release(); }
}));

app.get("/api/tickets/:id", authenticate, asyncRoute(async (req, res) => {
  const result = await pool.query(ticketSelect + " WHERE t.id=$1", [req.params.id]);
  const ticket = result.rows[0];
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado." });
  if (req.user.role === IDC && ticket.idc_owner != req.user.id &&
      !(ticket.status === "available" && ticket.logistics_status === "ready")) {
    return res.status(403).json({ error: "No tienes acceso a este ticket." });
  }
  if (req.user.role === LOGISTICS && ticket.logistics_owner != req.user.id &&
      !(ticket.status === "available" && ticket.logistics_status === "pending")) {
    return res.status(403).json({ error: "No tienes acceso a este ticket." });
  }
  const ticketId = ticket.id;
  const results = await Promise.all([
    pool.query("SELECT n.*,u.name AS author_name FROM ticket_notes n LEFT JOIN users u ON u.id=n.author_id WHERE n.ticket_id=$1 ORDER BY n.created_at DESC", [ticketId]),
    pool.query("SELECT e.*,u.name AS actor_name FROM ticket_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.ticket_id=$1 ORDER BY e.created_at DESC", [ticketId]),
    pool.query("SELECT ev.*,u.name AS added_by_name FROM ticket_evidence ev LEFT JOIN users u ON u.id=ev.added_by WHERE ev.ticket_id=$1 ORDER BY ev.created_at DESC", [ticketId])
  ]);
  if (req.user.role !== ADMIN) {
    delete ticket.agreed_amount;
    delete ticket.travel_expenses;
    delete ticket.other_expenses;
    delete ticket.payment_status;
    delete ticket.financial_notes;
  }
  res.json({ ticket: ticket, notes: results[0].rows, events: results[1].rows, evidence: results[2].rows });
}));

app.post("/api/tickets/:id/claim-logistics", authenticate, roles(LOGISTICS), asyncRoute(async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await c.query(
      "UPDATE tickets SET logistics_owner=$1,logistics_status='in_coordination',updated_at=NOW() " +
      "WHERE id=$2 AND status='available' AND logistics_status='pending' RETURNING id",
      [req.user.id, req.params.id]
    );
    if (!result.rowCount) {
      await c.query("ROLLBACK");
      return res.status(409).json({ error: "El ticket ya fue reclamado o no está disponible para coordinación." });
    }
    await event(c, req.params.id, req.user.id, "logistics_claimed", {});
    await c.query("COMMIT");
    res.json({ message: "Ticket reclamado para coordinación." });
  } catch (err) { await c.query("ROLLBACK"); throw err; }
  finally { c.release(); }
}));

app.post("/api/tickets/:id/release", authenticate, roles(LOGISTICS, ADMIN), asyncRoute(async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await c.query("SELECT * FROM tickets WHERE id=$1 FOR UPDATE", [req.params.id]);
    const t = result.rows[0];
    if (!t) {
      await c.query("ROLLBACK");
      return res.status(404).json({ error: "Ticket no encontrado." });
    }
    if (req.user.role === LOGISTICS && t.logistics_owner != req.user.id) {
      await c.query("ROLLBACK");
      return res.status(403).json({ error: "Solo el responsable logístico puede liberar el ticket." });
    }
    if (t.status !== "available" || t.logistics_status !== "in_coordination") {
      await c.query("ROLLBACK");
      return res.status(409).json({ error: "El ticket debe estar en coordinación para liberarse." });
    }
    if (!t.site_id || !t.address || !t.scope) {
      await c.query("ROLLBACK");
      return res.status(400).json({ error: "Faltan datos obligatorios del servicio." });
    }
    await c.query("UPDATE tickets SET logistics_status='ready',updated_at=NOW() WHERE id=$1", [t.id]);
    await event(c, t.id, req.user.id, "ticket_released", {});
    await c.query("COMMIT");
    res.json({ message: "Ticket liberado para asignación IDC." });
  } catch (err) { await c.query("ROLLBACK"); throw err; }
  finally { c.release(); }
}));

app.post("/api/tickets/:id/claim-idc", authenticate, roles(IDC), asyncRoute(async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await c.query(
      "UPDATE tickets SET idc_owner=$1,status='assigned',updated_at=NOW() " +
      "WHERE id=$2 AND status='available' AND logistics_status='ready' AND idc_owner IS NULL RETURNING id",
      [req.user.id, req.params.id]
    );
    if (!result.rowCount) {
      await c.query("ROLLBACK");
      return res.status(409).json({ error: "El ticket no está liberado o ya fue asignado a otro IDC." });
    }
    await event(c, req.params.id, req.user.id, "idc_assigned", {});
    await c.query("COMMIT");
    res.json({ message: "Servicio asignado a tu usuario." });
  } catch (err) { await c.query("ROLLBACK"); throw err; }
  finally { c.release(); }
}));

app.post("/api/tickets/:id/status", authenticate, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const allowed = {};
  allowed[ADMIN] = ["cancelled"];
  allowed[LOGISTICS] = [];
  allowed[IDC] = ["in_progress","on_hold","completed"];
  if (!(allowed[req.user.role] || []).includes(b.status)) return res.status(403).json({ error: "Tu rol no puede realizar esta transición." });

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await c.query("SELECT * FROM tickets WHERE id=$1 FOR UPDATE", [req.params.id]);
    const t = result.rows[0];
    if (!t) {
      await c.query("ROLLBACK");
      return res.status(404).json({ error: "Ticket no encontrado." });
    }
    if (req.user.role === IDC && t.idc_owner != req.user.id) {
      await c.query("ROLLBACK");
      return res.status(403).json({ error: "Solo puedes modificar un servicio asignado a ti." });
    }
    if (b.status === "in_progress" && !["assigned","on_hold"].includes(t.status)) {
      await c.query("ROLLBACK");
      return res.status(409).json({ error: "Solo un ticket asignado o en espera puede iniciar/reanudar ejecución." });
    }
    if (b.status === "on_hold" && !["assigned","in_progress"].includes(t.status)) {
      await c.query("ROLLBACK");
      return res.status(409).json({ error: "El ticket no puede pasar a espera desde su estado actual." });
    }
    if (b.status === "completed") {
      const checks = Array.isArray(t.close_checklist) ? t.close_checklist : [];
      const ev = await c.query("SELECT COUNT(*)::int AS n FROM ticket_evidence WHERE ticket_id=$1", [t.id]);
      if (!["in_progress","on_hold"].includes(t.status)) {
        await c.query("ROLLBACK");
        return res.status(409).json({ error: "El ticket debe estar en ejecución para cerrarse." });
      }
      if (checks.length !== 6 || checks.some((v) => v !== true)) {
        await c.query("ROLLBACK");
        return res.status(400).json({ error: "Debes completar los seis puntos del checklist." });
      }
      if (!required(b.result)) {
        await c.query("ROLLBACK");
        return res.status(400).json({ error: "El resultado del servicio es obligatorio." });
      }
      if (ev.rows[0].n < 1) {
        await c.query("ROLLBACK");
        return res.status(400).json({ error: "Agrega al menos una evidencia antes del cierre." });
      }
    }
    if (b.status === "cancelled" && !required(b.reason)) {
      await c.query("ROLLBACK");
      return res.status(400).json({ error: "Indica el motivo de cancelación." });
    }
    const progress = b.status === "completed" ? 100 :
      (Number.isInteger(b.progress) ? Math.max(0, Math.min(100, b.progress)) : t.progress);
    await c.query(
      "UPDATE tickets SET status=$1,progress=$2,result=COALESCE($3,result), " +
      "closed_by=CASE WHEN $1='completed' THEN $4 ELSE closed_by END, " +
      "closed_at=CASE WHEN $1='completed' THEN NOW() ELSE closed_at END,updated_at=NOW() WHERE id=$5",
      [b.status, progress, b.result || null, req.user.id, t.id]
    );
    await event(c, t.id, req.user.id, "status_changed", { from: t.status, to: b.status, reason: b.reason || null });
    await c.query("COMMIT");
    res.json({ message: "Estado actualizado." });
  } catch (err) { await c.query("ROLLBACK"); throw err; }
  finally { c.release(); }
}));

app.put("/api/tickets/:id/checklist", authenticate, roles(IDC), asyncRoute(async (req, res) => {
  const list = req.body && req.body.checklist;
  if (!Array.isArray(list) || list.length !== 6 || list.some((v) => typeof v !== "boolean")) {
    return res.status(400).json({ error: "El checklist debe contener exactamente seis valores booleanos." });
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const updated = await c.query(
      "UPDATE tickets SET close_checklist=$1::jsonb,updated_at=NOW() " +
      "WHERE id=$2 AND idc_owner=$3 AND status IN ('assigned','in_progress','on_hold') RETURNING id",
      [JSON.stringify(list), req.params.id, req.user.id]
    );
    if (!updated.rowCount) {
      await c.query("ROLLBACK");
      return res.status(403).json({ error: "No puedes actualizar el checklist de este ticket." });
    }
    await event(c, req.params.id, req.user.id, "checklist_updated", { checklist: list });
    await c.query("COMMIT");
    res.json({ message: "Checklist guardado." });
  } catch (err) { await c.query("ROLLBACK"); throw err; }
  finally { c.release(); }
}));

app.post("/api/tickets/:id/notes", authenticate, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const type = b.note_type || "note";
  if (!required(b.body) || b.body.trim().length > 5000 || !["note","incident","blocker"].includes(type)) {
    return res.status(400).json({ error: "Escribe una nota válida (máximo 5000 caracteres) y selecciona un tipo permitido." });
  }
  const found = await pool.query("SELECT id,idc_owner,logistics_owner FROM tickets WHERE id=$1", [req.params.id]);
  const t = found.rows[0];
  if (!t) return res.status(404).json({ error: "Ticket no encontrado." });
  if (req.user.role === IDC && t.idc_owner != req.user.id) return res.status(403).json({ error: "Solo puedes registrar notas en tickets asignados a ti." });
  if (req.user.role === LOGISTICS && t.logistics_owner != req.user.id) return res.status(403).json({ error: "Solo puedes registrar notas en tickets bajo tu coordinación." });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("INSERT INTO ticket_notes(ticket_id,author_id,note_type,body) VALUES($1,$2,$3,$4)", [t.id,req.user.id,type,b.body.trim()]);
    await event(c, t.id, req.user.id, "note_added", { note_type: type });
    await c.query("UPDATE tickets SET updated_at=NOW() WHERE id=$1", [t.id]);
    await c.query("COMMIT");
  } catch (err) { await c.query("ROLLBACK"); throw err; }
  finally { c.release(); }
  res.status(201).json({ message: "Registro agregado." });
}));

app.post("/api/tickets/:id/evidence", authenticate, roles(IDC, ADMIN), asyncRoute(async (req, res) => {
  const b = req.body || {};
  if (!required(b.label) || !required(b.url) || b.label.length > 200 || b.url.length > 2000) {
    return res.status(400).json({ error: "Nombre y URL de evidencia son obligatorios." });
  }
  let parsed;
  try { parsed = new URL(b.url); } catch { return res.status(400).json({ error: "La URL de evidencia no es válida." }); }
  if (!["https:","http:"].includes(parsed.protocol)) return res.status(400).json({ error: "La evidencia debe usar HTTP o HTTPS." });
  const found = await pool.query("SELECT id,idc_owner,status FROM tickets WHERE id=$1", [req.params.id]);
  const t = found.rows[0];
  if (!t) return res.status(404).json({ error: "Ticket no encontrado." });
  if (req.user.role === IDC && (t.idc_owner != req.user.id || !["assigned","in_progress","on_hold"].includes(t.status))) {
    return res.status(403).json({ error: "No puedes agregar evidencia a este ticket." });
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("INSERT INTO ticket_evidence(ticket_id,added_by,label,url) VALUES($1,$2,$3,$4)", [t.id,req.user.id,b.label.trim(),parsed.toString()]);
    await event(c, t.id, req.user.id, "evidence_added", { label: b.label.trim() });
    await c.query("UPDATE tickets SET updated_at=NOW() WHERE id=$1", [t.id]);
    await c.query("COMMIT");
  } catch (err) { await c.query("ROLLBACK"); throw err; }
  finally { c.release(); }
  res.status(201).json({ message: "Evidencia agregada." });
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.code === "23505") return res.status(409).json({ error: "El registro ya existe." });
  res.status(500).json({ error: "Ocurrió un error interno. Intenta nuevamente." });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log("FieldConnect Group escuchando en el puerto " + port));
