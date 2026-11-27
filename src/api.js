function registerApi(app, { pool, jwt, bcrypt, jwtSecret, randomUUID, jsonParam=JSON.stringify }) {
const ADMIN = "admin";
const DIRECTOR = "director";
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const required = (v) => typeof v === "string" && v.trim().length > 0;
const roles = (...allowed) => (req, res, next) => allowed.includes(req.user.role)
  ? next()
  : res.status(403).json({ error: "No tienes permisos para esta operación." });

async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Inicia sesión para continuar." });
  try {
    const claims = await jwt.verify(token, jwtSecret);
    const current = await pool.query("SELECT id,name,email,role,session_version FROM users WHERE id=$1 AND active=TRUE AND role IN ('admin','director')", [claims.id]);
    if (!current.rows[0] || Number(claims.ver || 0)!==current.rows[0].session_version) return res.status(401).json({ error: "Sesión expirada. Inicia sesión nuevamente." });
    req.user = current.rows[0];
    return next();
  } catch (err) {
    if (!['JsonWebTokenError','TokenExpiredError','NotBeforeError'].includes(err.name)) return next(err);
    return res.status(401).json({ error: "Sesión inválida o expirada. Inicia sesión nuevamente." });
  }
}
function event(client, ticketId, actorId, eventType, details) {
  return client.query(
    "INSERT INTO ticket_events(ticket_id,actor_id,event_type,details) VALUES($1,$2,$3,$4)",
    [ticketId, actorId, eventType, jsonParam(details || {})]
  );
}
const ticketSelect = "SELECT t.*, creator.name AS creator_name, logistics.name AS logistics_owner_name, idc.name AS idc_owner_name " +
  "FROM tickets t LEFT JOIN users creator ON creator.id=t.created_by " +
  "LEFT JOIN employees logistics ON logistics.id=t.logistics_owner LEFT JOIN employees idc ON idc.id=t.idc_owner";

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "FieldConnect Group" }));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const body = req.body || {};
  if (!required(body.email) || !required(body.password)) {
    return res.status(400).json({ error: "Correo y contraseña son obligatorios." });
  }
  if (body.email.length>254 || body.password.length>128) return res.status(400).json({error:"Revisa tu correo y contraseña."});
  const bucket=body.email.trim().toLowerCase();
  const attempt=await pool.query("INSERT INTO login_attempts(bucket) VALUES($1) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN login_attempts.reset_at<NOW() THEN 1 ELSE login_attempts.attempts+1 END,reset_at=CASE WHEN login_attempts.reset_at<NOW() THEN NOW()+INTERVAL '15 minutes' ELSE login_attempts.reset_at END RETURNING attempts",[bucket]);
  if(attempt.rows[0].attempts>10)return res.status(429).json({error:"Demasiados intentos. Intenta de nuevo en 15 minutos."});
  const result = await pool.query(
    "SELECT id,name,email,password_hash,role,active,session_version FROM users WHERE email=LOWER($1)",
    [body.email.trim()]
  );
  const user = result.rows[0];
  if (!user || !user.active || ![ADMIN,DIRECTOR].includes(user.role) || !(await bcrypt.compare(body.password, user.password_hash))) {
    return res.status(401).json({ error: "Credenciales incorrectas." });
  }
  const token = await jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, ver:user.session_version },
    jwtSecret,
    { expiresIn: "8h" }
  );
  await pool.query("DELETE FROM login_attempts WHERE bucket=$1",[bucket]);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

app.post("/api/auth/password", authenticate, asyncRoute(async(req,res)=>{
  const b=req.body || {};
  if(!required(b.current_password)||!required(b.new_password)||b.new_password.length<12||b.new_password.length>72)return res.status(400).json({error:"La contraseña nueva debe tener entre 12 y 72 caracteres."});
  const r=await pool.query("SELECT password_hash FROM users WHERE id=$1",[req.user.id]);
  if(!await bcrypt.compare(b.current_password,r.rows[0].password_hash))return res.status(400).json({error:"La contraseña actual no es correcta."});
  const hash=await bcrypt.hash(b.new_password,12);
  const changed=await pool.query("UPDATE users SET password_hash=$1,session_version=session_version+1 WHERE id=$2 AND password_hash=$3 RETURNING id",[hash,req.user.id,r.rows[0].password_hash]);
  if(!changed.rowCount)return res.status(409).json({error:"La contraseña cambió. Inicia sesión nuevamente."});
  res.json({message:"Contraseña actualizada. Inicia sesión nuevamente."});
}));

app.get("/api/auth/me", authenticate, asyncRoute(async (req, res) => {
  const result = await pool.query(
    "SELECT id,name,email,role,active FROM users WHERE id=$1",
    [req.user.id]
  );
  if (!result.rows[0] || !result.rows[0].active) return res.status(401).json({ error: "Usuario inactivo." });
  res.json({ user: result.rows[0] });
}));

app.get("/api/users", authenticate, roles(ADMIN,DIRECTOR), asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT id,name,email,role,active FROM users WHERE active=TRUE AND role IN ('admin','director') ORDER BY name");
  res.json({ users: result.rows });
}));

app.post("/api/users", authenticate, roles(ADMIN,DIRECTOR), asyncRoute(async (req, res) => {
  const b = req.body || {};
  if (!required(b.name) || !required(b.email) || !required(b.password) || b.password.length < 12 ||
      ![ADMIN, DIRECTOR].includes(b.role)) {
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

app.get("/api/catalogs", authenticate, asyncRoute(async (_req,res) => {
  const [companies,employees]=await Promise.all([
    pool.query("SELECT id,name,active FROM companies ORDER BY name"),
    pool.query("SELECT id,name,kind,email,phone,active FROM employees ORDER BY name")
  ]);
  res.json({companies:companies.rows,employees:employees.rows});
}));
app.post("/api/companies", authenticate, roles(ADMIN,DIRECTOR), asyncRoute(async (req,res) => {
  if (!required(req.body?.name)) return res.status(400).json({error:"Escribe el nombre de la empresa."});
  const r=await pool.query("INSERT INTO companies(name) VALUES($1) RETURNING id,name,active",[req.body.name.trim()]);
  res.status(201).json({company:r.rows[0]});
}));
app.post("/api/employees", authenticate, roles(ADMIN,DIRECTOR), asyncRoute(async (req,res) => {
  const b=req.body || {};
  if (!required(b.name) || !["logistics","idc"].includes(b.kind)) return res.status(400).json({error:"Nombre y tipo de personal válidos son obligatorios."});
  const r=await pool.query("INSERT INTO employees(name,kind,email,phone) VALUES($1,$2,$3,$4) RETURNING id,name,kind,email,phone,active",[b.name.trim(),b.kind,String(b.email||"").trim(),String(b.phone||"").trim()]);
  res.status(201).json({employee:r.rows[0]});
}));
app.patch("/api/employees/:id", authenticate, roles(ADMIN,DIRECTOR), asyncRoute(async (req,res) => {
  if (typeof req.body?.active !== "boolean") return res.status(400).json({error:"Indica un estado válido."});
  const r=await pool.query("UPDATE employees SET active=$1 WHERE id=$2 RETURNING id",[req.body.active,req.params.id]);
  if (!r.rowCount) return res.status(404).json({error:"Persona no encontrada."});
  res.json({message:"Catálogo actualizado."});
}));

app.get("/api/tickets", authenticate, asyncRoute(async (req, res) => {
  const params = [];
  const conditions = [];
  if (req.query.status) {
    params.push(String(req.query.status));
    conditions.push("t.status=$" + params.length);
  }
  if (req.query.q) {
    params.push("%" + String(req.query.q).slice(0, 100) + "%");
    const n = params.length;
    conditions.push("(t.folio ILIKE $" + n + " OR t.client ILIKE $" + n + " OR t.site_id ILIKE $" + n + " OR t.project ILIKE $" + n + " OR t.access_folio ILIKE $" + n + ")");
  }
  const sql = ticketSelect + (conditions.length ? " WHERE " + conditions.join(" AND ") : "") +
    " ORDER BY t.updated_at DESC LIMIT 300";
  const result = await pool.query(sql, params);
  res.json({ tickets: result.rows });
}));

app.post("/api/tickets", authenticate, roles(ADMIN,DIRECTOR), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const requiredFields = ["project","service_type","site_name","region","address","scope","access_folio"];
  if (requiredFields.some((k) => !required(b[k]))) {
    return res.status(400).json({ error: "Completa proyecto, tipo de servicio, sitio, región, domicilio, alcance y folio de acceso." });
  }
  if (![b.company_id,b.logistics_owner,b.idc_owner].every(v => /^[1-9]\d*$/.test(String(v)))) {
    return res.status(400).json({ error: "Selecciona empresa, ingeniero de apoyo e IDC del catálogo." });
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
  const folio = "FC-" + randomUUID().toUpperCase();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await c.query(
      "INSERT INTO tickets(folio,client,project,site_id,service_type,site_name,region,address,contact_name,contact_phone," +
      "access_instructions,scheduled_at,priority,scope,activities,tools,materials,prerequisites,technical_notes," +
      "agreed_amount,travel_expenses,other_expenses,payment_status,financial_notes,created_by,company_id,access_folio,logistics_owner,idc_owner,status,logistics_status) " +
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,'assigned','in_coordination') RETURNING *",
      [folio,"",b.project.trim(),"",b.service_type.trim(),b.site_name.trim(),b.region.trim(),
       b.address.trim(),b.contact_name || "",b.contact_phone || "",b.access_instructions || "",scheduledAt,
       priority,b.scope.trim(),b.activities || "",b.tools || "",b.materials || "",b.prerequisites || "",
       b.technical_notes || "",amounts[0],amounts[1],amounts[2],paymentStatus,b.financial_notes || "",req.user.id,b.company_id,b.access_folio.trim(),b.logistics_owner,b.idc_owner]
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
  const ticketId = ticket.id;
  const results = await Promise.all([
    pool.query("SELECT n.*,u.name AS author_name FROM ticket_notes n LEFT JOIN users u ON u.id=n.author_id WHERE n.ticket_id=$1 ORDER BY n.created_at DESC", [ticketId]),
    pool.query("SELECT e.*,u.name AS actor_name FROM ticket_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.ticket_id=$1 ORDER BY e.created_at DESC", [ticketId]),
    pool.query("SELECT ev.*,u.name AS added_by_name FROM ticket_evidence ev LEFT JOIN users u ON u.id=ev.added_by WHERE ev.ticket_id=$1 ORDER BY ev.created_at DESC", [ticketId])
  ]);
  res.json({ ticket: ticket, notes: results[0].rows, events: results[1].rows, evidence: results[2].rows });
}));

app.post("/api/tickets/:id/release", authenticate, roles(ADMIN,DIRECTOR), asyncRoute(async (req,res) => {
  const c=await pool.connect();
  try {
    await c.query("BEGIN");
    const r=await c.query("UPDATE tickets SET logistics_status='ready',updated_at=NOW() WHERE id=$1 AND logistics_status='in_coordination' AND status NOT IN ('completed','cancelled') RETURNING id",[req.params.id]);
    if (!r.rowCount) { await c.query("ROLLBACK"); return res.status(409).json({error:"El ticket no está en coordinación."}); }
    await event(c,req.params.id,req.user.id,"ticket_released",{});
    await c.query("COMMIT"); res.json({message:"Coordinación completada."});
  } catch(err) { await c.query("ROLLBACK"); throw err; } finally { c.release(); }
}));

app.post("/api/tickets/:id/status", authenticate, asyncRoute(async (req, res) => {
  const b = req.body || {};
  if (!["cancelled","in_progress","on_hold","completed"].includes(b.status)) return res.status(400).json({error:"Estado inválido."});

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await c.query("SELECT * FROM tickets WHERE id=$1 FOR UPDATE", [req.params.id]);
    const t = result.rows[0];
    if (!t) {
      await c.query("ROLLBACK");
      return res.status(404).json({ error: "Ticket no encontrado." });
    }
    if (["completed","cancelled"].includes(t.status)) {
      await c.query("ROLLBACK"); return res.status(409).json({error:"El ticket ya está cerrado."});
    }
    if (b.status === "in_progress" && t.logistics_status !== "ready") {
      await c.query("ROLLBACK"); return res.status(409).json({error:"Completa la coordinación antes de iniciar."});
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

app.put("/api/tickets/:id/checklist", authenticate, roles(ADMIN,DIRECTOR), asyncRoute(async (req, res) => {
  const list = req.body && req.body.checklist;
  if (!Array.isArray(list) || list.length !== 6 || list.some((v) => typeof v !== "boolean")) {
    return res.status(400).json({ error: "El checklist debe contener exactamente seis valores booleanos." });
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const updated = await c.query(
      "UPDATE tickets SET close_checklist=$1::jsonb,updated_at=NOW() " +
      "WHERE id=$2 AND status IN ('assigned','in_progress','on_hold') RETURNING id",
      [jsonParam(list), req.params.id]
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

app.post("/api/tickets/:id/evidence", authenticate, roles(ADMIN,DIRECTOR), asyncRoute(async (req, res) => {
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
  if (["completed","cancelled"].includes(t.status)) return res.status(409).json({error:"El ticket ya está cerrado."});
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
  if (err.code === "23514" || err.code === "23503") return res.status(400).json({error:"Revisa la empresa, el folio y los responsables activos del catálogo."});
  console.error(err);
  if (err.code === "23505") return res.status(409).json({ error: "El registro ya existe." });
  res.status(500).json({ error: "Ocurrió un error interno. Intenta nuevamente." });
});

}
module.exports = registerApi;
