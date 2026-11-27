const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=name=>fs.readFileSync(path.join(__dirname,'..','src',name),'utf8');
const {schemaBundle}=require('../src/database-schema');

test('isolated schema preserves existing public tables and generates tracking',async()=>{
  const db=new PGlite();
  try {
    await db.exec('CREATE TABLE public.tickets(id uuid PRIMARY KEY, marker text);');
    await db.exec(schemaBundle('fieldconnect'));
    await db.exec("SET search_path TO fieldconnect;"+sql('seed-demo.sql'));
    assert.equal((await db.query("SELECT site_id FROM fieldconnect.tickets WHERE folio='FC-EJEMPLO-001'")).rows[0].site_id,'000001');
    assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='tickets' AND column_name='marker'")).rows.length,1);
  } finally { await db.close(); }
});

test('fresh database initializes and remains compatible with repeated initialization',async()=>{
  const db=new PGlite();
  try {
    await db.exec('BEGIN;'+sql('schema.sql')+sql('migration-v2.sql')+'COMMIT;');
    await db.exec(sql('seed-demo.sql'));
    await db.exec('BEGIN;'+sql('schema.sql')+sql('migration-v2.sql')+'COMMIT;');
    assert.equal((await db.query('SELECT count(*)::int n FROM tickets')).rows[0].n,1);
    await assert.rejects(db.query("INSERT INTO users(name,email,password_hash,role) VALUES('IDC','invalid@example.com','unused','idc')"));
  } finally { await db.close(); }
});

test('migration, catalogs, tracking and the two authorized logins',async t=>{
  const db=new PGlite();
  // Start with the previous schema and existing assignments, not an empty-only migration.
  await db.exec(sql('schema.sql').replace("('admin','director')","('admin','logistics','idc')"));
  await db.exec(`INSERT INTO users(id,name,email,password_hash,role) VALUES
    (10,'Admin','admin@example.com','unused','admin'),
    (20,'Apoyo anterior','support@example.com','unused','logistics'),
    (30,'IDC anterior','field@example.com','unused','idc');
    INSERT INTO tickets(folio,client,project,site_id,service_type,site_name,region,address,scope,logistics_owner,idc_owner)
    VALUES('OLD-001','Empresa anterior','Proyecto','000041','Servicio','Sitio','Colima','Domicilio','Alcance',20,30);`);
  await db.exec(sql('migration-v2.sql')); await db.exec(sql('migration-web.sql'));
  await db.exec(sql('migration-v2.sql')); await db.exec(sql('migration-web.sql'));
  await t.test('migration preserves history, maps personnel and disables legacy accounts',async()=>{
    const old=(await db.query('SELECT t.site_id,a.name support,i.name field FROM tickets t JOIN employees a ON a.id=t.logistics_owner JOIN employees i ON i.id=t.idc_owner')).rows[0];
    assert.deepEqual(old,{site_id:'000041',support:'Apoyo anterior',field:'IDC anterior'});
    assert.equal((await db.query("SELECT count(*)::int n FROM users WHERE active AND role IN ('logistics','idc')")).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int n FROM employees')).rows[0].n,2);
  });
  await db.exec(sql('seed-demo.sql')); await db.exec(sql('seed-demo.sql'));
  await t.test('sample data is idempotent and tables have RLS',async()=>{
    assert.equal((await db.query("SELECT count(*)::int n FROM tickets WHERE folio='FC-EJEMPLO-001'")).rows[0].n,1);
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_class WHERE relname IN ('users','companies','employees','tickets','ticket_events','ticket_notes','ticket_evidence') AND relrowsecurity")).rows[0].n,7);
  });
  const bcrypt=require('bcryptjs'); const jwt=require('jsonwebtoken');
  const password='Test-password-2026!';const hash=await bcrypt.hash(password,4);
  await db.query("UPDATE users SET password_hash=$1",[hash]);
  await db.query("INSERT INTO users(name,email,password_hash,role) VALUES('Director','director@example.com',$1,'director')",[hash]);
  // Connect the real HTTP handlers to an isolated PostgreSQL engine.
  process.env.JWT_SECRET='test-secret-for-fieldconnect-at-least-32-characters';
  const {pool}=require('../src/db');
  pool.query=(...args)=>db.query(...args).then(r=>({...r,rowCount:r.affectedRows ?? r.rows.length}));
  pool.connect=async()=>({query:pool.query,release(){}});
  const app=require('../src/server');
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const api=async(url,method='GET',body,token)=>{
    const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
    return {status:r.status,...await r.json()};
  };
  try {
    let admin,director;
    await t.test('only admin/director can log in; stale legacy tokens are rejected',async()=>{
      admin=await api('/api/auth/login','POST',{email:'admin@example.com',password});assert.equal(admin.status,200);
      director=await api('/api/auth/login','POST',{email:'director@example.com',password});assert.equal(director.status,200);
      for(const email of ['support@example.com','field@example.com']) assert.equal((await api('/api/auth/login','POST',{email,password})).status,401);
      const stale=jwt.sign({id:20,role:'logistics'},process.env.JWT_SECRET);
      assert.equal((await api('/api/tickets','GET',null,stale)).status,401);
      assert.equal((await api('/api/tickets')).status,401);
      assert.equal((await api('/api/users','POST',{name:'Invalid',email:'new@example.com',password,role:'idc'},admin.token)).status,400);
    });
    const catalogs=await api('/api/catalogs','GET',null,admin.token);
    const company=catalogs.companies.find(x=>x.name==='Empresa anterior');
    const support=catalogs.employees.find(x=>x.kind==='logistics');const field=catalogs.employees.find(x=>x.kind==='idc');
    const body={company_id:company.id,logistics_owner:support.id,idc_owner:field.id,project:'Proyecto',service_type:'Inspección',site_name:'Sitio',region:'Colima',address:'Domicilio',scope:'Pruebas',access_folio:'ENT-123',site_id:'INJECTED'};
    let ticket;
    await t.test('tracking ignores manual SITE ID and advances per company with assignments',async()=>{
      const first=await api('/api/tickets','POST',body,admin.token);assert.equal(first.status,201);ticket=first.ticket;
      assert.equal(ticket.site_id,'000042');assert.equal(ticket.client,'Empresa anterior');assert.equal(ticket.access_folio,'ENT-123');assert.equal(ticket.status,'assigned');
      const second=await api('/api/tickets','POST',body,director.token);assert.equal(second.ticket.site_id,'000043');
      const other=await api('/api/companies','POST',{name:'Otra empresa'},admin.token);assert.equal(other.status,201);
      const third=await api('/api/tickets','POST',{...body,company_id:other.company.id},admin.token);assert.equal(third.ticket.site_id,'000001');
      const detail=await api('/api/tickets/'+ticket.id,'GET',null,director.token);assert.equal(detail.ticket.logistics_owner_name,support.name);assert.equal(detail.ticket.idc_owner_name,field.name);
      await assert.rejects(db.query("UPDATE tickets SET site_id='999999' WHERE id=$1",[ticket.id]));
    });
    await t.test('invalid/inactive personnel and missing folio do not consume tracking numbers',async()=>{
      assert.equal((await api('/api/tickets','POST',{...body,access_folio:''},admin.token)).status,400);
      assert.equal((await api('/api/tickets','POST',{...body,logistics_owner:field.id},admin.token)).status,400);
      await api('/api/employees/'+support.id,'PATCH',{active:false},admin.token);
      assert.equal((await api('/api/tickets','POST',body,admin.token)).status,400);
      await api('/api/employees/'+support.id,'PATCH',{active:true},admin.token);
      assert.equal((await api('/api/tickets','POST',body,admin.token)).ticket.site_id,'000044');
    });
    await t.test('authorized profiles complete coordination, execution, checklist and evidence',async()=>{
      const route='/api/tickets/'+ticket.id;
      assert.equal((await api(route+'/status','POST',{status:'in_progress'},admin.token)).status,409);
      assert.equal((await api(route+'/release','POST',{},admin.token)).status,200);
      assert.equal((await api(route+'/status','POST',{status:'in_progress'},admin.token)).status,200);
      assert.equal((await api(route+'/status','POST',{status:'completed',result:'Listo'},director.token)).status,400);
      assert.equal((await api(route+'/checklist','PUT',{checklist:Array(6).fill(true)},admin.token)).status,200);
      assert.equal((await api(route+'/evidence','POST',{label:'Reporte',url:'https://example.com/report'},admin.token)).status,201);
      assert.equal((await api(route+'/status','POST',{status:'completed',result:'Conectividad validada'},director.token)).status,200);
      assert.equal((await api(route+'/status','POST',{status:'in_progress'},admin.token)).status,409);
      const detail=await api(route,'GET',null,admin.token);assert.equal(detail.ticket.progress,100);assert.ok(detail.events.length>=5);
    });
    await t.test('changing a password invalidates previous sessions',async()=>{
      const changed=await api('/api/auth/password','POST',{current_password:password,new_password:'New-test-password-2026!'},director.token);
      assert.equal(changed.status,200);
      assert.equal((await api('/api/tickets','GET',null,director.token)).status,401);
      assert.equal((await api('/api/auth/login','POST',{email:'director@example.com',password:'New-test-password-2026!'})).status,200);
      assert.equal((await api('/api/auth/login','POST',{email:'director@example.com',password})).status,401);
    });
    await t.test('repeated failed logins are rate limited',async()=>{
      for(let i=0;i<10;i++)assert.equal((await api('/api/auth/login','POST',{email:'missing@example.com',password})).status,401);
      assert.equal((await api('/api/auth/login','POST',{email:'missing@example.com',password})).status,429);
    });
  } finally { await new Promise(resolve=>server.close(resolve));await pool.end();await db.close(); }
});
