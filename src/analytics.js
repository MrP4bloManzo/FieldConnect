const timezone='America/Mexico_City';
function mexicoDate(value=new Date()) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value).map(p=>[p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const iso=d=>d.toISOString().slice(0,10);
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&iso(new Date(s+'T00:00:00Z'))===s;
function resolvePeriod(query={},now=new Date(),minDate=null) {
  const period=query.period || 'month',today=mexicoDate(now),d=new Date(today+'T00:00:00Z');
  let from,to;
  if(period==='week') {const start=new Date(d);start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);from=iso(start);to=iso(end);}
  else if(period==='month'){from=iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)));to=iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)));}
  else if(period==='custom'){from=query.from;to=query.to;}
  else if(period==='all'){from=minDate||today;to=today;}
  else throw new Error('Selecciona semana, mes, todo el historial o un rango personalizado.');
  if(!validDate(from)||!validDate(to)||from>to)throw new Error('Selecciona fechas válidas, con inicio anterior o igual al fin.');
  const days=(Date.parse(to)-Date.parse(from))/86400000+1;
  if(days>3660)throw new Error('Selecciona un periodo de hasta diez años.');
  const group=query.group || (days<=31?'day':days<=180?'week':'month');
  if(!['day','week','month'].includes(group))throw new Error('Agrupación inválida.');
  return {period,from,to,group,timezone};
}
const analyticsSql=`
WITH created AS (
 SELECT * FROM tickets WHERE created_at >= ($1::date::timestamp AT TIME ZONE 'America/Mexico_City')
 AND created_at < (($2::date+1)::timestamp AT TIME ZONE 'America/Mexico_City')
), closed AS (
 SELECT * FROM tickets WHERE status='completed' AND closed_at >= ($1::date::timestamp AT TIME ZONE 'America/Mexico_City')
 AND closed_at < (($2::date+1)::timestamp AT TIME ZONE 'America/Mexico_City')
), summary AS (
 SELECT count(*)::int AS created,
 count(*) FILTER (WHERE status NOT IN ('completed','cancelled'))::int AS open,
 count(*) FILTER (WHERE status='completed')::int AS completed_in_cohort,
 count(*) FILTER (WHERE status='cancelled')::int AS cancelled_in_cohort,
 COALESCE(round(100.0*count(*) FILTER(WHERE status='completed')/NULLIF(count(*),0),1),0) AS completion_rate,
 (SELECT count(*)::int FROM closed) AS closed,
 (SELECT count(*)::int FROM closed WHERE satisfaction IS NOT NULL) AS evaluated,
 (SELECT count(*)::int FROM closed WHERE satisfaction='satisfied') AS satisfied,
 (SELECT count(*)::int FROM closed WHERE satisfaction='neutral') AS neutral,
 (SELECT count(*)::int FROM closed WHERE satisfaction='unsatisfied') AS unsatisfied,
 (SELECT count(*)::int FROM closed WHERE satisfaction IS NULL) AS unrated,
 (SELECT round(100.0*count(*) FILTER(WHERE satisfaction='satisfied')/NULLIF(count(*) FILTER(WHERE satisfaction IS NOT NULL),0),1) FROM closed) AS satisfaction_rate,
 (SELECT round(avg(EXTRACT(EPOCH FROM (closed_at-created_at))/3600)::numeric,1) FROM closed) AS avg_resolution_hours
 FROM created
), statuses AS (
 SELECT v.label,count(c.id)::int AS total FROM (VALUES ('available'),('assigned'),('in_progress'),('on_hold'),('completed'),('cancelled')) v(label)
 LEFT JOIN created c ON c.status=v.label GROUP BY v.label
), types AS (SELECT service_type AS label,count(*)::int AS total FROM created GROUP BY service_type),
priorities AS (SELECT priority AS label,count(*)::int AS total FROM created GROUP BY priority),
companies_data AS (SELECT client AS label,count(*)::int AS total FROM created GROUP BY client),
states_data AS (SELECT COALESCE(service_state,'Sin estado registrado') AS label,count(*)::int AS total FROM created GROUP BY service_state),
team_data AS (SELECT COALESCE(e.name,'Sin IDC asignado') AS label,count(*)::int AS total FROM created c LEFT JOIN employees e ON e.id=c.idc_owner GROUP BY e.id,e.name),
created_trend AS (SELECT date_trunc($3,created_at AT TIME ZONE 'America/Mexico_City') AS bucket,count(*)::int AS total FROM created GROUP BY bucket),
closed_trend AS (SELECT date_trunc($3,closed_at AT TIME ZONE 'America/Mexico_City') AS bucket,count(*)::int AS total FROM closed GROUP BY bucket),
trend AS (
 SELECT to_char(s.bucket,'YYYY-MM-DD') AS date,COALESCE(c.total,0) AS created,COALESCE(d.total,0) AS closed
 FROM generate_series(date_trunc($3,$1::date::timestamp),date_trunc($3,$2::date::timestamp),$4::interval) s(bucket)
 LEFT JOIN created_trend c ON c.bucket=s.bucket LEFT JOIN closed_trend d ON d.bucket=s.bucket
)
SELECT jsonb_build_object(
 'summary',(SELECT to_jsonb(summary) FROM summary),
 'statuses',COALESCE((SELECT jsonb_agg(to_jsonb(statuses) ORDER BY total DESC,label) FROM statuses),'[]'::jsonb),
 'types',COALESCE((SELECT jsonb_agg(to_jsonb(types) ORDER BY total DESC,label) FROM types),'[]'::jsonb),
 'priorities',COALESCE((SELECT jsonb_agg(to_jsonb(priorities) ORDER BY total DESC,label) FROM priorities),'[]'::jsonb),
 'companies',COALESCE((SELECT jsonb_agg(to_jsonb(companies_data) ORDER BY total DESC,label) FROM companies_data),'[]'::jsonb),
 'states',COALESCE((SELECT jsonb_agg(to_jsonb(states_data) ORDER BY total DESC,label) FROM states_data),'[]'::jsonb),
 'team',COALESCE((SELECT jsonb_agg(to_jsonb(team_data) ORDER BY total DESC,label) FROM team_data),'[]'::jsonb),
 'trend',COALESCE((SELECT jsonb_agg(to_jsonb(trend) ORDER BY date) FROM trend),'[]'::jsonb)
) AS analytics`;
module.exports = { resolvePeriod, analyticsSql };
