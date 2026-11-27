"use strict";

const app = document.getElementById("app");
const state = { token: localStorage.getItem("fc_token") || "", user: null, tickets: [], filter: "", query: "", view:"services", catalogs:null, analyticsQuery:{period:"month"}, analyticsData:null, analyticsRequest:0 };
const CHECKLIST = [
  "Se verificó el alcance solicitado",
  "Se realizaron las actividades técnicas",
  "Se validó el funcionamiento del servicio",
  "Se documentaron incidencias o se indicó que no hubo",
  "Se registraron las evidencias correspondientes",
  "Se informó el resultado al responsable correspondiente"
];
const STATUS = { available:"Disponible", assigned:"Asignado", in_progress:"En progreso", on_hold:"En espera", completed:"Completado", cancelled:"Cancelado" };
const LOGISTICS = { pending:"Pendiente de coordinación", in_coordination:"En coordinación", ready:"Coordinación completada" };
const ROLE = { admin:"Administrador", director:"Directivo" };
const canManage = () => ["admin","director"].includes(state.user?.role);
const PRIORITY = { low:"Baja", normal:"Normal", high:"Alta", urgent:"Urgente" };
const SATISFACTION = { satisfied:"Satisfecho", neutral:"Neutral", unsatisfied:"Insatisfecho" };
const coverageText = x => Array.isArray(x)&&x.length ? x.join(" · ") : "Cobertura por definir";
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const fmtDate = (v) => v ? new Date(v).toLocaleString("es-MX", { dateStyle:"medium", timeStyle:"short" }) : "Sin programar";
const money = (v) => new Intl.NumberFormat("es-MX", { style:"currency", currency:"MXN" }).format(Number(v || 0));

function toast(message, bad) {
  const el = document.createElement("div");
  el.className = "toast" + (bad ? " bad" : "");
  el.textContent = message;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 3500);
}
async function api(url, options) {
  options = options || {};
  const headers = Object.assign({ "Content-Type":"application/json" }, options.headers || {});
  if (state.token) headers.Authorization = "Bearer " + state.token;
  const response = await fetch((window.FIELDCONNECT_CONFIG?.apiBase || "") + url, Object.assign({}, options, { headers:headers }));
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && url !== "/api/auth/login") {
    logout(false);
    throw new Error(data.error || "La sesión expiró.");
  }
  if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
  return data;
}
function loginView(error) {
 app.innerHTML=`<main class="login-page"><section class="login-story"><div class="login-brand"><img class="official-logo" src="./assets/fieldconnect-logo-clean.png" alt="FieldConnect Group"><span>FieldConnect<br><small>GROUP</small></span></div><div class="story-copy"><div class="eyebrow">Operaciones de ingeniería de campo</div><h1>Tu operación.<br><span>En conexión.</span></h1><p>Personas, servicios y resultados en un solo centro de control.</p><div class="story-flow"><span>Coordina</span><span>Supervisa</span><span>Resuelve</span></div></div><p class="story-footer">Conectando tecnología en todas partes.</p></section><section class="login-side"><form id="login-form" class="panel login-panel"><div class="eyebrow">Bienvenido a FieldConnect</div><h2>Centro de operaciones</h2><p class="login-description">Inicia sesión con tu cuenta de Administrador o Directivo.</p><label>Correo electrónico<input type="email" name="email" autocomplete="username" required placeholder="usuario@empresa.com"></label><label>Contraseña<input type="password" name="password" autocomplete="current-password" required></label><button class="primary" type="submit">Entrar a la plataforma <span aria-hidden="true">→</span></button><p id="login-error" class="error" role="alert">${esc(error||'')}</p><p class="login-note">Acceso autorizado · FieldConnect Group</p></form></section></main>`;
}
function logout(showMessage) {
  state.view="services";state.analyticsData=null;state.analyticsRequest++;
  state.token = "";
  state.user = null;
  localStorage.removeItem("fc_token");
  loginView();
  if (showMessage) toast("Sesión cerrada.");
}
async function loadTickets() {
  const params = new URLSearchParams();
  if (state.filter) params.set("status", state.filter);
  if (state.query) params.set("q", state.query);
  const data = await api("/api/tickets?" + params.toString());
  state.tickets = data.tickets;
}
async function boot() {
  if (!state.token) return loginView();
  try {
    const me = await api("/api/auth/me");
    state.user = me.user;
    await loadTickets();
    renderDashboard();
  } catch (err) {
    logout(false);
  }
}
function pill(value, isLogistics) {
  const label = isLogistics ? (LOGISTICS[value] || value) : (STATUS[value] || PRIORITY[value] || value);
  const color = ["completed","ready"].includes(value) ? "green" :
    ["assigned","in_progress"].includes(value) ? "blue" :
    ["in_coordination","on_hold"].includes(value) ? "amber" :
    ["cancelled","urgent"].includes(value) ? "red" : "";
  return '<span class="pill ' + color + '">' + esc(label) + '</span>';
}
function card(t) {
  let actions = '<button class="secondary" data-act="detail" data-id="' + esc(t.id) + '">Ver detalle</button>';
  if (canManage() && !["completed","cancelled"].includes(t.status) && t.logistics_status === "in_coordination")
    actions += '<button class="primary" data-act="release" data-id="'+esc(t.id)+'">Completar coordinación</button>';
  return '<article class="ticket-card"><div><div class="folio">' + esc(t.folio) + ' · ' + esc(PRIORITY[t.priority] || t.priority) + '</div>' +
    '<h3>' + esc(t.client) + ' — ' + esc(t.service_type) + '</h3><p><strong>' + esc(t.project) + '</strong> · SITE ID: ' + esc(t.site_id) + '</p>' +
    '<p>Folio de entrada: '+esc(t.access_folio||'No indicado')+'</p><p>' + esc(t.site_name) + ' · ' + esc(t.region) + '</p><p>Programado: ' + esc(fmtDate(t.scheduled_at)) + '</p><p>' +
    pill(t.status, false) + ' ' + pill(t.logistics_status, true) + '</p><p>Apoyo: ' + esc(t.logistics_owner_name || "Sin asignar") +
    ' · IDC: ' + esc(t.idc_owner_name || "Sin asignar") + '</p><p class="coverage-note">Cobertura IDC: '+esc(coverageText(t.idc_coverage_states))+'</p>'+(t.status==='completed'?'<p class="satisfaction-tag">Satisfacción: '+esc(SATISFACTION[t.satisfaction]||'Sin evaluar')+'</p>':'')+'</div><div class="ticket-actions">' + actions + '</div></article>';
}
function renderDashboard() {
  const u = state.user;
  const list = state.tickets;
  const counts = {
    open:list.filter((t) => !["completed","cancelled"].includes(t.status)).length,
    ready:list.filter((t) => t.logistics_status === "ready" && ["available","assigned"].includes(t.status)).length,
    active:list.filter((t) => ["in_progress","on_hold"].includes(t.status)).length,
    done:list.filter((t) => t.status === "completed").length
  };
  const title = u.role === "admin" ? "Panel administrativo" : "Centro de control ejecutivo";
  app.innerHTML = '<div class="app-shell"><header class="topbar"><div class="brand"><img class="official-logo nav-logo" src="./assets/fieldconnect-logo-clean.png" alt="Logo oficial">FieldConnect <span>Group</span></div>' +
    '<div class="user-box"><div class="avatar">' + esc((u.name || "U").slice(0,1).toUpperCase()) + '</div><div><div class="user-name">' + esc(u.name) +
    '</div><div class="role-tag">' + esc(ROLE[u.role]) + '</div></div><button class="quiet" data-act="password">Contraseña</button><button class="quiet" id="logout">Salir</button></div></header><main class="layout">' +
    '<nav class="workspace-tabs" aria-label="Secciones"><button data-act="services" aria-pressed="'+(state.view==='services')+'">Tickets y operación</button><button data-act="analytics" aria-pressed="'+(state.view==='analytics')+'">Analítica y reportes</button></nav><div id="workspace-main">'+
    '<div class="heading-row"><div><div class="eyebrow">Centro de operaciones</div><h1>' + title + '</h1><p>' +
    (u.role === "admin" ? "Supervisa tickets, responsables y avance de los servicios." :
      "Supervisa responsables, avance y resultados de los servicios.") + '</p></div>' +
    (canManage() ? '<div class="toolbar"><button class="secondary" data-act="catalogs">Directorio y cobertura</button><button class="primary" id="new-ticket">＋ Crear ticket</button></div>' : '') + '</div>' +
    '<section class="stats"><div class="stat"><div class="stat-label">Servicios activos</div><div class="stat-value">' + counts.open +
    '</div><div class="stat-note">Pendientes o en ejecución</div></div><div class="stat"><div class="stat-label">Listos para iniciar</div><div class="stat-value">' + counts.ready +
    '</div><div class="stat-note">Coordinación completada</div></div><div class="stat"><div class="stat-label">En ejecución / espera</div><div class="stat-value">' + counts.active +
    '</div><div class="stat-note">Requieren seguimiento</div></div><div class="stat"><div class="stat-label">Completados</div><div class="stat-value">' + counts.done +
    '</div><div class="stat-note">En el conjunto visible</div></div></section><section><h2 class="section-title">Servicios y tickets</h2>' +
    '<div class="toolbar"><input id="search" type="search" placeholder="Buscar folio, cliente, proyecto o SITE ID…" value="' + esc(state.query) + '">' +
    '<select id="status-filter"><option value="">Todos los estados</option>' + Object.keys(STATUS).map((k) =>
      '<option value="' + k + '"' + (state.filter === k ? ' selected' : '') + '>' + STATUS[k] + '</option>').join("") +
    '</select><button class="secondary" id="refresh">Actualizar</button></div><div class="ticket-list">' +
    (list.length ? list.map(card).join("") : '<div class="empty"><strong>No hay tickets para mostrar</strong><p>Cambia los filtros o actualiza la lista.</p></div>') +
    '</div></section></div></main><footer class="site-footer">FieldConnect Group · Conectando tecnología en todas partes</footer></div>';
  if(state.view==='analytics')showAnalytics();
}
async function refresh() {
  try { await loadTickets(); renderDashboard(); }
  catch (err) { toast(err.message, true); }
}
function showModal(title, html) {
  const old = document.getElementById("modal-backdrop");
  if (old) old.remove();
  const el = document.createElement("div");
  el.id = "modal-backdrop";
  el.className = "modal-backdrop";
  el.innerHTML = '<section class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>' + esc(title) +
    '</h2><button class="quiet" data-act="close-modal" aria-label="Cerrar">✕</button></div>' + html + '</section>';
  document.body.appendChild(el);
  el.addEventListener("click", (e) => { if (e.target === el) el.remove(); });
  return el;
}
async function createTicketModal() {
  let catalogs;
  try { catalogs=await api("/api/catalogs");state.catalogs=catalogs; } catch(err) { return toast(err.message,true); }
  const select=(name,label,rows)=>'<label>'+label+' *<select name="'+name+'" required><option value="">Selecciona del catálogo</option>'+rows.filter(x=>x.active).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name+(x.kind==='idc'?' — '+coverageText(x.coverage_states):''))+'</option>').join('')+'</select></label>';

  showModal("Crear servicio / ticket", '<form id="ticket-form"><div class="form-grid">' +
    '<label>Empresa *<input name="client" required maxlength="200" placeholder="Escribe el nombre de la empresa" autocomplete="organization"></label><label>ID de acceso / folio de entrada *<input name="access_folio" required></label><label>Proyecto *<input name="project" required></label>' +
    '<label>SITE ID<input value="Se genera al guardar" readonly><small>Consecutivo automático por empresa</small></label>'+select("logistics_owner","Ing. de base de proyecto / apoyo",catalogs.employees.filter(x=>x.kind==="logistics"))+select("idc_owner","IDC asignado y cobertura",catalogs.employees.filter(x=>x.kind==="idc"))+'<p class="span-2 coverage-hint" id="ticket-coverage">Selecciona un IDC para consultar sus estados de cobertura.</p><label>Estado del servicio *<select name="service_state" required><option value="">Selecciona un estado de México</option>'+catalogs.states.map(x=>'<option>'+esc(x.name)+'</option>').join('')+'</select></label><label>Tipo de servicio *<input name="service_type" required></label>' +
    '<label>Nombre del sitio *<input name="site_name" required></label><label>Ciudad o región *<input name="region" required></label>' +
    '<label class="span-2">Domicilio operativo *<input name="address" required></label><label>Contacto<input name="contact_name"></label>' +
    '<label>Teléfono<input name="contact_phone"></label><label>Fecha y hora programada<input type="datetime-local" name="scheduled_at"></label>' +
    '<label>Prioridad<select name="priority"><option value="normal">Normal</option><option value="low">Baja</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>' +
    '<label class="span-2">Instrucciones de acceso<textarea name="access_instructions"></textarea></label>' +
    '<label class="span-2">Alcance del servicio *<textarea name="scope" required></textarea></label>' +
    '<label>Actividades solicitadas<textarea name="activities"></textarea></label><label>Herramientas necesarias<textarea name="tools"></textarea></label>' +
    '<label>Materiales requeridos<textarea name="materials"></textarea></label><label>Condiciones previas<textarea name="prerequisites"></textarea></label>' +
    '<label class="span-2">Observaciones técnicas<textarea name="technical_notes"></textarea></label><div class="span-2 divider"></div>' +
    '<label>Importe acordado (MXN)<input type="number" min="0" step="0.01" name="agreed_amount" value="0"></label>' +
    '<label>Viáticos (MXN)<input type="number" min="0" step="0.01" name="travel_expenses" value="0"></label>' +
    '<label>Otros gastos (MXN)<input type="number" min="0" step="0.01" name="other_expenses" value="0"></label>' +
    '<label>Estado de pago<select name="payment_status"><option value="pending">Pendiente</option><option value="partial">Parcial</option><option value="paid">Pagado</option><option value="not_applicable">No aplica</option></select></label>' +
    '<label class="span-2">Observaciones económicas<textarea name="financial_notes"></textarea></label></div><p class="error" id="form-error"></p>' +
    '<div class="form-actions"><button type="button" class="quiet" data-act="close-modal">Cancelar</button><button class="primary" type="submit">Crear ticket</button></div></form>');
}
async function openDetail(id) {
  try {
    const d = await api("/api/tickets/" + encodeURIComponent(id));
    renderDetail(d);
  } catch (err) { toast(err.message, true); }
}
function renderDetail(d) {
  const t = d.ticket;
  const canIDC = canManage() && !["completed","cancelled"].includes(t.status);
  const canNote = canManage();
  const checks = Array.isArray(t.close_checklist) ? t.close_checklist : [false,false,false,false,false,false];
  let html = '<div class="heading-row"><div><h2>' + esc(t.client) + ' — ' + esc(t.service_type) + '</h2><p>' + esc(t.project) + ' · SITE ID ' + esc(t.site_id) + '</p></div><div>' +
    pill(t.status, false) + ' ' + pill(t.logistics_status, true) + '</div></div><div class="detail-grid">' +
    detailItem("Sitio / región", t.site_name + " · " + t.region) + detailItem("Domicilio", t.address) +
    detailItem("Estado del servicio",t.service_state||"Sin estado registrado")+detailItem("Estados de cobertura del IDC",coverageText(t.idc_coverage_states))+
    detailItem("Programación", fmtDate(t.scheduled_at)) + detailItem("Prioridad", PRIORITY[t.priority] || t.priority) +
    detailItem("ID de acceso / folio de entrada",t.access_folio || "No indicado")+detailItem("Ing. de base de proyecto / apoyo", t.logistics_owner_name || "Sin asignar") + detailItem("IDC asignado", t.idc_owner_name || "Sin asignar") +
    detailItem("Contacto", (t.contact_name || "No indicado") + " · " + (t.contact_phone || "")) +
    detailItem("Progreso", Number(t.progress || 0) + "%") + '</div><div class="detail-section"><h3 class="section-title">Alcance y preparación</h3><div class="detail-grid">' +
    detailItem("Alcance", t.scope) + detailItem("Actividades", t.activities || "No indicadas") + detailItem("Herramientas", t.tools || "No indicadas") +
    detailItem("Materiales", t.materials || "No indicados") + detailItem("Condiciones previas", t.prerequisites || "No indicadas") +
    detailItem("Acceso / observaciones", (t.access_instructions || "") + " " + (t.technical_notes || "")) + '</div></div>';
  if (canManage()) html += '<div class="detail-section"><h3 class="section-title">Información económica · restringida</h3><div class="detail-grid">' +
    detailItem("Importe acordado", money(t.agreed_amount)) + detailItem("Viáticos", money(t.travel_expenses)) +
    detailItem("Otros gastos", money(t.other_expenses)) + detailItem("Estado de pago", t.payment_status) +
    detailItem("Observaciones económicas", t.financial_notes || "Sin observaciones") + '</div></div>';

  html += '<div class="detail-section"><h3 class="section-title">Checklist de cierre</h3><form id="checklist-form">';
  for (let i = 0; i < CHECKLIST.length; i++) {
    html += '<label class="check-row"><input type="checkbox" name="check-' + i + '"' + (checks[i] ? " checked" : "") + (canIDC ? "" : " disabled") + '>' + esc(CHECKLIST[i]) + '</label>';
  }
  if (canIDC) html += '<button class="secondary" type="submit">Guardar checklist</button>';
  html += '</form></div>';

  if (canIDC) {
    html += '<div class="detail-section"><h3 class="section-title">Acciones de ejecución</h3><div class="toolbar">';
    if (t.status === "assigned") html += '<button class="primary" data-act="start" data-id="' + t.id + '">Iniciar ejecución</button>';
    if (["assigned","in_progress"].includes(t.status)) html += '<button class="secondary" data-act="hold" data-id="' + t.id + '">Reportar bloqueo / espera</button>';
    if (t.status === "on_hold") html += '<button class="primary" data-act="resume" data-id="' + t.id + '">Reanudar ejecución</button>';
    html += '</div><form id="evidence-form" class="form-grid"><label>Nombre de evidencia<input name="label" required></label>' +
      '<label>URL de evidencia<input type="url" name="url" placeholder="https://…" required></label><div class="span-2"><button class="secondary" type="submit">Agregar evidencia por URL</button></div></form>' +
      '<div class="divider"></div><form id="result-form"><label>Resultado del servicio<textarea name="result" required>' + esc(t.result || "") +
      '</textarea></label>'+satisfactionFields(t.satisfaction,t.satisfaction_notes,'satisfaction_notes')+'<button class="primary" type="submit">Finalizar servicio</button><p class="tiny">El cierre exige los seis puntos del checklist, resultado escrito y al menos una evidencia. Puedes registrar la satisfacción después.</p><p class="error" id="close-error"></p></form></div>';
  }
  if(t.status==='completed')html+='<section class="detail-section"><h3 class="section-title">Resultado y satisfacción del cliente</h3>'+detailItem("Resultado del servicio",t.result||"Sin resultado registrado")+'<form id="satisfaction-form">'+satisfactionFields(t.satisfaction,t.satisfaction_notes,'notes')+'<button class="secondary">Guardar evaluación</button><p class="error" id="satisfaction-error" role="alert"></p></form></section>';
  if (canNote) html += '<div class="detail-section"><h3 class="section-title">Agregar nota o incidencia</h3><form id="note-form" class="form-grid">' +
    '<label>Tipo<select name="note_type"><option value="note">Nota técnica</option><option value="incident">Incidencia</option><option value="blocker">Bloqueo</option></select></label>' +
    '<label class="span-2">Descripción<textarea name="body" maxlength="5000" required></textarea></label><div class="span-2"><button class="secondary" type="submit">Guardar registro</button></div></form></div>';
  html += '<div class="detail-section"><h3 class="section-title">Evidencias</h3><div class="timeline">' +
    (d.evidence.length ? d.evidence.map((x) => '<div class="timeline-item"><strong>' + esc(x.label) + '</strong><p><a class="link" href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">Abrir evidencia</a></p><p>' + esc(x.added_by_name || "Usuario") + ' · ' + esc(fmtDate(x.created_at)) + '</p></div>').join("") : '<p class="muted">Todavía no hay evidencias.</p>') +
    '</div></div><div class="detail-section"><h3 class="section-title">Notas e incidencias</h3><div class="timeline">' +
    (d.notes.length ? d.notes.map((x) => '<div class="timeline-item"><strong>' + esc(x.author_name || "Usuario") + ' · ' + esc(x.note_type) + '</strong><p>' + esc(x.body) + '</p><p>' + esc(fmtDate(x.created_at)) + '</p></div>').join("") : '<p class="muted">Sin notas ni incidencias.</p>') +
    '</div></div><div class="detail-section"><h3 class="section-title">Historial de auditoría</h3><div class="timeline">' +
    (d.events.length ? d.events.map((x) => '<div class="timeline-item"><strong>' + esc(String(x.event_type).replace(/_/g, " ")) + '</strong><p>' + esc(x.actor_name || "Sistema") + ' · ' + esc(fmtDate(x.created_at)) + '</p></div>').join("") : '<p class="muted">Sin movimientos registrados.</p>') +
    '</div></div>';
  const modal = showModal(t.folio, html);
  modal.dataset.ticketId = t.id;
}
function detailItem(label, value) {
  return '<div class="detail-item"><small>' + esc(label) + '</small><strong>' + esc(value == null ? "" : value) + '</strong></div>';
}
function stateCheckboxes(states,selected=[]) {
 return '<div class="state-checkboxes">'+states.map(x=>'<label><input type="checkbox" name="coverage_states" value="'+esc(x.name)+'"'+(selected.includes(x.name)?' checked':'')+'>'+esc(x.name)+'</label>').join('')+'</div>';
}
function satisfactionFields(value,notes,notesName) {
 return '<label>Satisfacción del cliente<select name="satisfaction"><option value="">Sin evaluar</option>'+Object.entries(SATISFACTION).map(([k,v])=>'<option value="'+k+'"'+(k===value?' selected':'')+'>'+v+'</option>').join('')+'</select></label><label>Observaciones de la evaluación<textarea name="'+notesName+'" maxlength="2000" placeholder="Registra la opinión recibida del cliente">'+esc(notes||'')+'</textarea></label>';
}
async function showCatalogs() {
 try {
  const d=await api('/api/catalogs');state.catalogs=d;
  showModal('Directorio y cobertura',
   '<p class="muted">Los ingenieros de apoyo e IDC se asignan a los tickets sin cuenta de acceso. La empresa se escribe directamente al crear el servicio.</p><div class="catalog-heading"><h3>Personal interno</h3><span class="pill">'+d.employees.length+' personas</span></div>'+d.employees.map(x=>'<div class="catalog-row"><div><strong>'+esc(x.name)+'</strong><p>'+ (x.kind==='logistics'?'Ingeniería de apoyo':'Ingeniería de campo · IDC')+' · '+esc(x.email||'Sin correo')+'</p>'+(x.kind==='idc'?'<p class="coverage-note">Cobertura: '+esc(coverageText(x.coverage_states))+'</p>':'')+'</div><div class="row-actions">'+(x.kind==='idc'?'<button class="secondary" data-act="edit-coverage" data-id="'+esc(x.id)+'">Editar cobertura</button>':'')+'<button class="quiet" data-act="toggle-employee" data-id="'+esc(x.id)+'" data-active="'+x.active+'">'+(x.active?'Desactivar':'Activar')+'</button></div></div>').join('')+
   '<section class="detail-section"><h3>Agregar persona</h3><form id="employee-form" class="form-grid"><label>Nombre<input name="name" required maxlength="200"></label><label>Tipo<select name="kind"><option value="logistics">Ingeniero de apoyo</option><option value="idc">IDC</option></select></label><label>Correo de contacto<input name="email" type="email"></label><label>Teléfono<input name="phone"></label><fieldset class="span-2 coverage-fieldset" id="employee-coverage" hidden><legend>Estados de cobertura del IDC</legend><p class="tiny">Selecciona al menos un estado. Puedes elegir varios.</p>'+stateCheckboxes(d.states)+'</fieldset><div class="span-2"><button class="primary">Agregar persona</button></div></form><p class="error" id="catalog-error" role="alert"></p></section>');
 }catch(err){toast(err.message,true);}
}
function editCoverage(id){
 const d=state.catalogs,e=d?.employees.find(e=>String(e.id)===String(id));if(!e)return;
 const dialog=showModal('Cobertura de '+e.name,'<form id="coverage-form"><p>Selecciona los estados de México que cubre este IDC.</p>'+stateCheckboxes(d.states,e.coverage_states)+'<p class="error" id="coverage-error" role="alert"></p><div class="form-actions"><button type="button" class="quiet" data-act="catalogs">Volver al directorio</button><button class="primary">Guardar cobertura</button></div></form>');dialog.dataset.employeeId=e.id;
}
async function sendAction(id, action, body) {
  const endpoints = { release:"/release" };
  try {
    const result = await api("/api/tickets/" + encodeURIComponent(id) + endpoints[action], { method:"POST", body:"{}" });
    toast(result.message);
    await refresh();
  } catch (err) { toast(err.message, true); }
}
async function changeStatus(id, status, extra) {
  try {
    const result = await api("/api/tickets/" + encodeURIComponent(id) + "/status", {
      method:"POST", body:JSON.stringify(Object.assign({ status:status }, extra || {}))
    });
    toast(result.message);
    const modal = document.getElementById("modal-backdrop");
    if (modal) modal.remove();
    await refresh();
  } catch (err) { toast(err.message, true); }
}
function formObject(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  return data;
}

document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!form || !form.id) return;
  e.preventDefault();
  if (form.id === "login-form") {
    const data = formObject(form);
    try {
      const response = await api("/api/auth/login", { method:"POST", body:JSON.stringify(data) });
      state.token = response.token;
      state.user = response.user;
      localStorage.setItem("fc_token", state.token);
      await loadTickets();
      renderDashboard();
    } catch (err) {
      const error = document.getElementById("login-error");
      if (error) error.textContent = err.message;
    }
  } else if (form.id === "analytics-form") {
    const q=formObject(form);if(q.period!=='custom'){delete q.from;delete q.to;}if(!q.group)delete q.group;
    await loadAnalytics(q);
  } else if (form.id === "coverage-form") {
    const id=document.getElementById('modal-backdrop').dataset.employeeId;
    const coverage_states=new FormData(form).getAll('coverage_states');
    try{await api('/api/employees/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({coverage_states})});await loadTickets();renderDashboard();await showCatalogs();toast('Cobertura actualizada.');}
    catch(err){document.getElementById('coverage-error').textContent=err.message;}
  } else if (form.id === "satisfaction-form") {
    const id=document.getElementById('modal-backdrop').dataset.ticketId,body=formObject(form);body.satisfaction=body.satisfaction||null;
    try{const r=await api('/api/tickets/'+encodeURIComponent(id)+'/satisfaction',{method:'PUT',body:JSON.stringify(body)});await loadTickets();renderDashboard();await openDetail(id);toast(r.message);}
    catch(err){document.getElementById('satisfaction-error').textContent=err.message;}
  } else if (form.id === "password-form") {
    const data=formObject(form);
    if(data.new_password!==data.confirm_password) { document.getElementById("password-error").textContent="Las contraseñas no coinciden.";return; }
    try { const r=await api("/api/auth/password",{method:"POST",body:JSON.stringify(data)});document.getElementById("modal-backdrop")?.remove();logout(false);toast(r.message); }
    catch(err){document.getElementById("password-error").textContent=err.message;}
  } else if (["employee-form","company-form"].includes(form.id)) {
    const body=formObject(form);if(form.id==='employee-form')body.coverage_states=body.kind==='idc'?new FormData(form).getAll('coverage_states'):[];
    try { await api(form.id==="company-form"?"/api/companies":"/api/employees",{method:"POST",body:JSON.stringify(body)}); await showCatalogs(); toast("Catálogo actualizado."); }
    catch(err) { const error=document.getElementById("catalog-error"); if(error)error.textContent=err.message; }
  } else if (form.id === "ticket-form") {
    const data = formObject(form);
    ["agreed_amount","travel_expenses","other_expenses"].forEach((k) => { data[k] = Number(data[k] || 0); });
    if (data.scheduled_at) data.scheduled_at = new Date(data.scheduled_at).toISOString();
    else delete data.scheduled_at;
    try {
      const result = await api("/api/tickets", { method:"POST", body:JSON.stringify(data) });
      document.getElementById("modal-backdrop").remove();
      toast("Ticket creado: " + result.ticket.folio);
      await refresh();
    } catch (err) {
      const error = document.getElementById("form-error");
      if (error) error.textContent = err.message;
    }
  } else if (form.id === "checklist-form") {
    const modal = document.getElementById("modal-backdrop");
    const id = modal && modal.dataset.ticketId;
    const checklist = CHECKLIST.map((_, i) => !!form.querySelector('[name="check-' + i + '"]').checked);
    try {
      const result = await api("/api/tickets/" + encodeURIComponent(id) + "/checklist", { method:"PUT", body:JSON.stringify({ checklist:checklist }) });
      toast(result.message);
      await openDetail(id);
    } catch (err) { toast(err.message, true); }
  } else if (form.id === "evidence-form") {
    const modal = document.getElementById("modal-backdrop");
    const id = modal && modal.dataset.ticketId;
    try {
      const result = await api("/api/tickets/" + encodeURIComponent(id) + "/evidence", { method:"POST", body:JSON.stringify(formObject(form)) });
      toast(result.message);
      await openDetail(id);
    } catch (err) { toast(err.message, true); }
  } else if (form.id === "note-form") {
    const modal = document.getElementById("modal-backdrop");
    const id = modal && modal.dataset.ticketId;
    try {
      const result = await api("/api/tickets/" + encodeURIComponent(id) + "/notes", { method:"POST", body:JSON.stringify(formObject(form)) });
      toast(result.message);
      await openDetail(id);
    } catch (err) { toast(err.message, true); }
  } else if (form.id === "result-form") {
    const modal = document.getElementById("modal-backdrop");
    const id = modal && modal.dataset.ticketId;
    const resultText = new FormData(form).get("result");
    try {
      const result = await api("/api/tickets/" + encodeURIComponent(id) + "/status", {
        method:"POST", body:JSON.stringify({ status:"completed", result:resultText,satisfaction:new FormData(form).get('satisfaction')||null,satisfaction_notes:new FormData(form).get('satisfaction_notes')||'' })
      });
      toast(result.message);
      if (modal) modal.remove();
      await refresh();
    } catch (err) {
      const error = document.getElementById("close-error");
      if (error) error.textContent = err.message;
    }
  }
});

document.addEventListener("click", async (e) => {
  const button = e.target.closest("button[data-act],button#logout,button#new-ticket,button#refresh");
  if (!button) return;
  if (button.id === "logout") return logout(true);
  if (button.id === "new-ticket") return createTicketModal();
  if (button.id === "refresh") return refresh();
  const act = button.dataset.act;
  const id = button.dataset.id;
  if(act==='services'||act==='analytics'){state.view=act;state.analyticsRequest++;renderDashboard();return;}
  if(act==='analytics-csv')return exportAnalyticsCsv();
  if(act==='edit-coverage')return editCoverage(id);
  if (act === "catalogs") return showCatalogs();
  if (act === "password") return showModal("Cambiar contraseña",'<form id="password-form"><label>Contraseña actual<input type="password" name="current_password" autocomplete="current-password" required></label><label>Contraseña nueva<input type="password" name="new_password" minlength="12" maxlength="72" autocomplete="new-password" required></label><label>Confirmar contraseña nueva<input type="password" name="confirm_password" minlength="12" maxlength="72" autocomplete="new-password" required></label><p class="tiny">Usa al menos 12 caracteres. Se cerrarán las sesiones anteriores.</p><p class="error" id="password-error" role="alert"></p><button class="primary">Guardar contraseña</button></form>');
  if (act === "toggle-employee") { try { await api("/api/employees/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({active:button.dataset.active!=="true"})}); await showCatalogs(); } catch(err) { toast(err.message,true); } return; }
  if (act === "close-modal") {
    const modal = document.getElementById("modal-backdrop");
    if (modal) modal.remove();
  } else if (act === "detail") {
    await openDetail(id);
  } else if (act === "release") {
    await sendAction(id, act);
  } else if (act === "start") {
    await changeStatus(id, "in_progress", { progress:1 });
  } else if (act === "resume") {
    await changeStatus(id, "in_progress");
  } else if (act === "hold") {
    const reason = window.prompt("Describe el bloqueo que impide continuar:");
    if (reason && reason.trim()) {
      const modal = document.getElementById("modal-backdrop");
      try {
        await api("/api/tickets/" + encodeURIComponent(id) + "/notes", {
          method:"POST", body:JSON.stringify({ note_type:"blocker", body:reason.trim() })
        });
        await changeStatus(id, "on_hold");
      } catch (err) { toast(err.message, true); }
    }
  }
});

document.addEventListener("change", async (e) => {
  if(e.target.id==='analytics-period'){
    const custom=e.target.value==='custom';document.querySelectorAll('.custom-date').forEach(label=>{label.hidden=!custom;label.querySelector('input').required=custom;});return;
  }
  if(e.target.name==='kind'&&e.target.form?.id==='employee-form'){document.getElementById('employee-coverage').hidden=e.target.value!=='idc';return;}
  if(e.target.name==='idc_owner'&&e.target.form?.id==='ticket-form'){
    const x=state.catalogs?.employees.find(x=>String(x.id)===e.target.value);document.getElementById('ticket-coverage').textContent=x?'Estados de cobertura: '+coverageText(x.coverage_states):'Selecciona un IDC para consultar sus estados de cobertura.';return;
  }
  if (e.target && e.target.id === "status-filter") {
    state.filter = e.target.value;
    await refresh();
  }
});
document.addEventListener("keydown", async (e) => {
  if (e.target && e.target.id === "search" && e.key === "Enter") {
    state.query = e.target.value;
    await refresh();
  }
});
document.addEventListener("change", async (e) => {
  if (e.target && e.target.id === "search") {
    state.query = e.target.value;
    await refresh();
  }
});

boot();
