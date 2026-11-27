// Run only after deployment. Reads private local credentials; never prints them.
const fs=require('fs');
const assert=require('node:assert/strict');
const base='https://yyueagefcfoqesmegvtd.supabase.co/functions/v1/fieldconnect-api';
const accounts=JSON.parse(fs.readFileSync('.local/access-accounts.json','utf8'));
async function api(path,method='GET',body,token) {
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:'https://mrp4blomanzo.github.io',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  const d=await r.json();
  return {status:r.status,...d};
}
async function main(){
  const sessions={};
  for(const account of accounts){const d=await api('/api/auth/login','POST',{email:account.email,password:account.password});assert.equal(d.status,200,d.error);sessions[account.role]=d.token;}
  assert.equal((await api('/api/tickets')).status,401);
  assert.equal((await api('/api/tickets','GET',undefined,'invalid-token')).status,401);
  const admin=sessions.admin,director=sessions.director;
  const catalogs=await api('/api/catalogs','GET',null,admin);assert.equal(catalogs.status,200);
  const company=catalogs.companies.find(x=>x.active),support=catalogs.employees.find(x=>x.active&&x.kind==='logistics'),idc=catalogs.employees.find(x=>x.active&&x.kind==='idc');
  const body={company_id:company.id,logistics_owner:support.id,idc_owner:idc.id,access_folio:'QA-DESPLIEGUE',project:'Prueba de despliegue verificada',service_type:'Validación de plataforma',site_name:'Sitio de prueba',region:'Colima',address:'Registro ficticio de verificación',scope:'Verificar guardado, asignaciones, coordinación y cierre desde la API publicada.'};
  assert.equal((await api('/api/tickets','POST',{...body,access_folio:''},admin)).status,400);
  const list=await api('/api/tickets','GET',null,admin);
  let ticket=list.tickets.find(t=>t.project===body.project&&['assigned','in_progress'].includes(t.status));
  if(!ticket){const made=await api('/api/tickets','POST',body,admin);assert.equal(made.status,201,made.error);ticket=made.ticket;}
  assert.match(ticket.site_id,/^\d{6,}$/);
  const route='/api/tickets/'+ticket.id;
  let d=await api(route,'GET',null,director);assert.equal(d.status,200);assert.equal(d.ticket.logistics_owner_name,support.name);assert.equal(d.ticket.idc_owner_name,idc.name);assert.equal(d.ticket.access_folio,'QA-DESPLIEGUE');
  if(ticket.logistics_status==='in_coordination')assert.equal((await api(route+'/release','POST',{},admin)).status,200);
  if(ticket.status==='assigned')assert.equal((await api(route+'/status','POST',{status:'in_progress'},admin)).status,200);
  assert.equal((await api(route+'/checklist','PUT',{checklist:Array(6).fill(false)},admin)).status,200);
  assert.equal((await api(route+'/status','POST',{status:'completed',result:'Prueba'},director)).status,400);
  assert.equal((await api(route+'/checklist','PUT',{checklist:Array(6).fill(true)},admin)).status,200);
  assert.equal((await api(route+'/notes','POST',{body:'Validación del despliegue y persistencia compartida.',note_type:'note'},admin)).status,201);
  assert.equal((await api(route+'/evidence','POST',{label:'Repositorio de la plataforma',url:'https://github.com/MrP4bloManzo/FieldConnect'},admin)).status,201);
  assert.equal((await api(route+'/status','POST',{status:'completed',result:'Inicio de sesión, creación, responsables, folio, checklist, evidencia y cierre verificados.'},director)).status,200);
  d=await api(route,'GET',null,admin);assert.equal(d.ticket.progress,100);assert.equal(d.ticket.status,'completed');assert.ok(d.events.length>=6);
  const result={verified_at:new Date().toISOString(),api:base,ticket_id:ticket.id,site_id:ticket.site_id,company:ticket.client,checks:['admin login','director login','anonymous denied','invalid token denied','catalogs','required folio','ticket creation','support and IDC assignments','director reads shared data','coordination','start','closing requirements','checklist','notes','evidence','completion','audit trail']};
  fs.writeFileSync('.local/smoke-result.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}
main().catch(err=>{console.error(err.message);process.exit(1);});
