const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=name=>fs.readFileSync(path.join(__dirname,'..','src',name),'utf8');
const {schemaBundle}=require('../src/database-schema');
const {resolvePeriod}=require('../src/analytics');

test('report dates use Mexico City calendar weeks and validate custom ranges',()=>{
  assert.deepEqual(resolvePeriod({period:'week'},new Date('2026-11-30T05:30:00Z')),{period:'week',from:'2026-11-23',to:'2026-11-29',group:'day',timezone:'America/Mexico_City'});
  assert.equal(resolvePeriod({period:'month'},new Date('2024-02-29T18:00:00Z')).to,'2024-02-29');
  assert.throws(()=>resolvePeriod({period:'custom',from:'2026-02-29',to:'2026-03-01'}));
  assert.throws(()=>resolvePeriod({period:'custom',from:'2026-11-30',to:'2026-11-01'}));
});

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
  await db.exec(sql('migration-v2.sql')); await db.exec(sql('migration-web.sql')); await db.exec(sql('migration-analytics.sql'));
  await db.exec(sql('migration-v2.sql')); await db.exec(sql('migration-web.sql')); await db.exec(sql('migration-analytics.sql'));
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
    await t.test('free-text company names share tracking across case/spacing and failed tickets leave no orphan',async()=>{
      const a=await api('/api/tickets','POST',{...body,client:'  Empresa   Nueva  ',service_state:'Colima'},admin.token);assert.equal(a.status,201,a.error);assert.equal(a.ticket.client,'Empresa Nueva');assert.equal(a.ticket.site_id,'000001');
      const b=await api('/api/tickets','POST',{...body,client:'empresa nueva',service_state:'Jalisco'},admin.token);assert.equal(b.status,201,b.error);assert.equal(b.ticket.company_id,a.ticket.company_id);assert.equal(b.ticket.site_id,'000002');
      const failed=await api('/api/tickets','POST',{...body,client:'No debe persistir',logistics_owner:field.id},admin.token);assert.equal(failed.status,400);
      assert.equal((await db.query("SELECT count(*)::int n FROM companies WHERE name='No debe persistir'")).rows[0].n,0);
    });
    await t.test('IDC coverage accepts only Mexican states and edits preserve prior coverage on failure',async()=>{
      assert.equal(catalogs.states.length,32);
      assert.equal((await api('/api/employees','POST',{name:'IDC sin zona',kind:'idc'},admin.token)).status,400);
      const person=await api('/api/employees','POST',{name:'IDC de prueba',kind:'idc',coverage_states:['Colima','Jalisco']},admin.token);assert.equal(person.status,201,person.error);
      const url='/api/employees/'+person.employee.id;
      assert.equal((await api(url,'PATCH',{coverage_states:['Michoacán']},admin.token)).status,200);
      assert.equal((await api(url,'PATCH',{coverage_states:['Estado inventado']},admin.token)).status,400);
      const updated=await api('/api/catalogs','GET',null,director.token);
      assert.deepEqual(updated.employees.find(e=>e.id===person.employee.id).coverage_states,['Michoacán']);
      assert.equal((await api(url,'PATCH',{coverage_states:[]},admin.token)).status,400);
    });
    await t.test('analytics uses all matching tickets, inclusive Mexico dates and distinct closure/evaluation cohorts',async()=>{
      assert.equal((await api('/api/analytics')).status,401);
      const fixture=[
        ['2001-01-02T06:00:00Z','2001-01-03T18:00:00Z','satisfied'],
        ['2000-12-31T06:00:00Z','2001-01-03T06:00:00Z','unsatisfied'],
        ['2001-01-03T05:59:59Z',null,null],
        ['2001-01-04T06:00:00Z',null,null],
        ['2001-01-02T05:59:59Z',null,null],
        ['2001-01-03T06:00:00Z','2001-01-04T05:59:59Z',null]
      ];
      const ids=[];
      for(const [created,closed,satisfaction] of fixture){
        const made=await api('/api/tickets','POST',{...body,client:'Empresa analítica',service_type:'Cableado',service_state:'Colima'},admin.token);assert.equal(made.status,201,made.error);ids.push(made.ticket.id);
        await db.query("UPDATE tickets SET created_at=$1,closed_at=$2,satisfaction=$3,status=$4 WHERE id=$5",[created,closed,satisfaction,closed?'completed':'assigned',made.ticket.id]);
      }
      let d=await api('/api/analytics?period=custom&from=2001-01-02&to=2001-01-03','GET',null,director.token);assert.equal(d.status,200,d.error);
      assert.equal(d.summary.created,3);assert.equal(d.summary.closed,3);assert.equal(d.summary.open,1);assert.equal(d.summary.completion_rate,66.7);
      assert.equal(d.summary.satisfied,1);assert.equal(d.summary.unsatisfied,1);assert.equal(d.summary.unrated,1);assert.equal(d.summary.satisfaction_rate,50);assert.equal(d.summary.avg_resolution_hours,44);
      assert.equal(d.trend.reduce((sum,x)=>sum+x.created,0),3);assert.equal(d.trend.reduce((sum,x)=>sum+x.closed,0),3);
      assert.equal(d.types[0].label,'Cableado');assert.equal(d.states[0].label,'Colima');assert.equal(d.statuses.reduce((sum,x)=>sum+x.total,0),3);
      assert.equal((await api('/api/tickets/'+ids[2]+'/satisfaction','PUT',{satisfaction:'satisfied'},admin.token)).status,409);
      assert.equal((await api('/api/tickets/'+ids[5]+'/satisfaction','PUT',{satisfaction:'neutral',notes:'Atención aceptable'},admin.token)).status,200);
      d=await api('/api/analytics?period=custom&from=2001-01-02&to=2001-01-03','GET',null,admin.token);assert.equal(d.summary.evaluated,3);assert.equal(d.summary.satisfaction_rate,33.3);
      const empty=await api('/api/analytics?period=custom&from=1999-01-01&to=1999-01-02','GET',null,admin.token);assert.equal(empty.summary.created,0);assert.equal(empty.summary.satisfaction_rate,null);assert.equal(empty.summary.avg_resolution_hours,null);
      assert.equal((await api('/api/analytics?period=custom&from=2026-02-29&to=2026-03-01','GET',null,admin.token)).status,400);
      await db.query("INSERT INTO tickets(folio,client,project,site_id,service_type,site_name,region,address,scope,company_id,access_folio,logistics_owner,idc_owner,created_at) SELECT 'BULK-'||n,'','BULK','','Cableado','Sitio','Colima','Domicilio','Alcance',$1,'ENT-BULK',$2,$3,'2002-01-02T18:00:00Z' FROM generate_series(1,305) n",[company.id,support.id,field.id]);
      assert.equal((await api('/api/tickets?q=BULK','GET',null,admin.token)).tickets.length,300);
      const bulk=await api('/api/analytics?period=custom&from=2002-01-02&to=2002-01-02','GET',null,admin.token);assert.equal(bulk.summary.created,305);
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
