function analyticsDateLabel(value) {
  return new Date(value+'T12:00:00Z').toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric',timeZone:'America/Mexico_City'});
}
async function showAnalytics() {
  const q=state.analyticsQuery;
  document.getElementById('workspace-main').innerHTML=`
    <div class="heading-row report-heading"><div><div class="eyebrow">Inteligencia operativa</div><h1>La operación, en perspectiva.</h1><p>Consulta volumen, avance, tiempos de cierre y satisfacción de tus servicios.</p></div><span class="report-mark">FC / Analítica</span></div>
    <form id="analytics-form" class="report-filters panel">
      <label>Periodo<select name="period" id="analytics-period">${[['week','Semana actual'],['month','Mes actual'],['custom','Rango de fechas'],['all','Todo el historial']].map(([k,v])=>`<option value="${k}"${q.period===k?' selected':''}>${v}</option>`).join('')}</select></label>
      <label class="custom-date"${q.period!=='custom'?' hidden':''}>Desde<input type="date" name="from" value="${esc(q.from||'')}"${q.period==='custom'?' required':''}></label>
      <label class="custom-date"${q.period!=='custom'?' hidden':''}>Hasta<input type="date" name="to" value="${esc(q.to||'')}"${q.period==='custom'?' required':''}></label>
      <label>Agrupar tendencia<select name="group"><option value="">Automático</option>${[['day','Por día'],['week','Por semana'],['month','Por mes']].map(([k,v])=>`<option value="${k}"${q.group===k?' selected':''}>${v}</option>`).join('')}</select></label>
      <button class="primary" type="submit">Aplicar periodo</button><button class="secondary" type="button" data-act="analytics-csv" id="analytics-export" disabled>Descargar CSV</button>
      <p class="error span-full" id="analytics-error" role="alert"></p>
    </form><p class="report-period" id="analytics-period-caption" role="status">Consultando el periodo…</p><div id="analytics-content" aria-live="polite"><div class="empty">Cargando indicadores…</div></div>`;
  await loadAnalytics(q);
}
async function loadAnalytics(query) {
  const request=++state.analyticsRequest;
  const error=document.getElementById('analytics-error');if(error)error.textContent='';
  const exportButton=document.getElementById('analytics-export');if(exportButton)exportButton.disabled=true;
  const submit=document.querySelector('#analytics-form button[type="submit"]');if(submit)submit.disabled=true;
  try {
    const params=new URLSearchParams(Object.entries(query).filter(([,v])=>v));
    const d=await api('/api/analytics?'+params);
    if(state.view!=='analytics'||request!==state.analyticsRequest)return;
    state.analyticsData=d;state.analyticsQuery={...query,from:d.period.from,to:d.period.to};
    document.getElementById('analytics-period-caption').textContent=analyticsDateLabel(d.period.from)+' — '+analyticsDateLabel(d.period.to)+' · Hora de Ciudad de México';
    document.getElementById('analytics-content').innerHTML=analyticsContent(d);
    if(exportButton)exportButton.disabled=false;
  }catch(err){
    if(state.view!=='analytics'||request!==state.analyticsRequest)return;
    state.analyticsData=null;
    if(error)error.textContent=err.message;
    const content=document.getElementById('analytics-content');if(content)content.innerHTML='<div class="empty">No se pudo cargar el reporte. Revisa las fechas y vuelve a aplicar el periodo.</div>';
    const caption=document.getElementById('analytics-period-caption');if(caption)caption.textContent='Reporte sin actualizar';
  }finally{if(submit?.isConnected&&request===state.analyticsRequest)submit.disabled=false;}
}
function distributionChart(title,subtitle,rows,labelMap={}) {
  const max=Math.max(1,...rows.map(x=>Number(x.total)));
  return `<section class="report-panel"><div class="panel-heading"><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>${rows.some(x=>x.total)?`<div class="distribution">${rows.map(x=>`<div class="distribution-row"><div><span>${esc(labelMap[x.label]||x.label)}</span><strong>${x.total}</strong></div><div class="distribution-track"><span style="width:${Number(x.total)/max*100}%"></span></div></div>`).join('')}</div>`:'<div class="report-empty">Sin tickets creados en este periodo.</div>'}</section>`;
}
function trendChart(rows,group) {
  const max=Math.max(1,...rows.map(x=>Math.max(x.created,x.closed)));
  const label=v=>new Date(v+'T12:00:00Z').toLocaleDateString('es-MX',{day:group==='month'?undefined:'numeric',month:'short',timeZone:'America/Mexico_City'});
  return `<section class="report-panel trend-panel"><div class="panel-heading"><div><h2>Ritmo de la operación</h2><p>Altas por fecha de creación y cierres por fecha de finalización.</p></div><div class="chart-legend"><span><i></i>Creados</span><span><i class="closed-key"></i>Completados</span></div></div>
    <div class="trend-scroll"><div class="trend-chart">${rows.map(x=>`<div class="trend-column" tabindex="0" aria-label="${esc(analyticsDateLabel(x.date))}: ${x.created} creados, ${x.closed} completados"><div class="trend-values"><span style="height:${Math.max(x.created?3:0,x.created/max*100)}%"></span><span class="closed-bar" style="height:${Math.max(x.closed?3:0,x.closed/max*100)}%"></span></div><small>${esc(label(x.date))}</small><span class="chart-tooltip">${esc(label(x.date))}<br>${x.created} creados · ${x.closed} completados</span></div>`).join('')}</div></div>
    <details class="trend-data"><summary>Ver datos de la tendencia</summary><div class="table-scroll"><table><thead><tr><th>Inicio del intervalo</th><th>Creados</th><th>Completados</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(analyticsDateLabel(x.date))}</td><td>${x.created}</td><td>${x.closed}</td></tr>`).join('')}</tbody></table></div></details></section>`;
}
function analyticsContent(d) {
  const s=d.summary;
  const metrics=[
    ['Tickets creados',s.created,'Altas dentro del periodo'],
    ['Completados',s.closed,'Por fecha real de cierre'],
    ['Abiertos del periodo',s.open,'Creados aquí, aún sin cerrar'],
    ['Cierre de cohorte',s.completion_rate+'%','Completados de los creados aquí'],
    ['Clientes satisfechos',s.satisfaction_rate===null?'—':s.satisfaction_rate+'%',s.evaluated+' evaluados de '+s.closed+' cierres'],
    ['Tiempo medio de cierre',s.avg_resolution_hours===null?'—':s.avg_resolution_hours+' h','Desde creación hasta cierre']
  ];
  return `<section class="report-kpis">${metrics.map(([name,value,note])=>`<article class="stat"><div class="stat-label">${name}</div><strong class="stat-value">${value}</strong><p class="stat-note">${note}</p></article>`).join('')}</section>
    ${!s.created&&!s.closed?'<div class="report-notice">No hay altas ni cierres en el periodo seleccionado. Prueba otro rango o consulta todo el historial.</div>':''}
    ${trendChart(d.trend,d.period.group)}
    <div class="report-grid">${distributionChart('Estado de los tickets','Estado actual de los tickets creados en el periodo.',d.statuses,STATUS)}
    <section class="report-panel"><div class="panel-heading"><h2>La voz del cliente</h2><p>Evaluaciones de los servicios completados en el periodo.</p></div><div class="satisfaction-score"><strong>${s.satisfaction_rate===null?'—':s.satisfaction_rate+'%'}</strong><span>de las evaluaciones registradas son satisfactorias</span></div><div class="satisfaction-list">${[['satisfied','Satisfechos'],['neutral','Neutrales'],['unsatisfied','Insatisfechos'],['unrated','Sin evaluar']].map(([key,label])=>`<div><span>${label}</span><strong>${s[key]}</strong></div>`).join('')}</div><p class="tiny">Los cierres sin evaluación no se cuentan como satisfechos ni como insatisfechos.</p></section>
    ${distributionChart('Tipos de servicio','Todos los tipos de tickets creados en el periodo.',d.types)}
    ${distributionChart('Prioridades','Distribución de las altas por prioridad.',d.priorities,PRIORITY)}
    ${distributionChart('Empresas','Volumen de tickets por empresa.',d.companies)}
    ${distributionChart('Cobertura de los servicios','Estado de México registrado en cada ticket.',d.states)}
    ${distributionChart('Asignación IDC','Servicios creados por ingeniero de campo.',d.team)}</div>
    <p class="report-footnote">El reporte considera todos los registros del periodo. Las distribuciones se basan en tickets creados; satisfacción y tiempos, en servicios completados según su fecha de cierre. Una evaluación refleja la información registrada por Administración o Dirección.</p>`;
}
function exportAnalyticsCsv() {
  const d=state.analyticsData;if(!d)return;
  const rows=[['FieldConnect Group','Analítica de tickets'],['Desde',d.period.from],['Hasta',d.period.to],['Zona horaria',d.period.timezone],[],['Indicador','Valor']];
  const names={created:'Tickets creados',open:'Abiertos del periodo',completed_in_cohort:'Completados de la cohorte',cancelled_in_cohort:'Cancelados de la cohorte',completion_rate:'Porcentaje de cierre de cohorte',closed:'Completados por fecha de cierre',evaluated:'Cierres evaluados',satisfied:'Satisfechos',neutral:'Neutrales',unsatisfied:'Insatisfechos',unrated:'Sin evaluar',satisfaction_rate:'Porcentaje de satisfacción',avg_resolution_hours:'Tiempo medio de cierre en horas'};
  Object.entries(d.summary).forEach(([key,value])=>rows.push([names[key]||key,value===null?'Sin datos':value]));
  rows.push([],['Inicio del intervalo','Creados','Completados']);d.trend.forEach(x=>rows.push([x.date,x.created,x.closed]));
  for(const [key,title,map] of [['statuses','Estados',STATUS],['types','Tipos de servicio',{}],['priorities','Prioridades',PRIORITY],['companies','Empresas',{}],['states','Estados de México',{}],['team','IDC',{}]]){rows.push([],[title,'Tickets creados']);d[key].forEach(x=>rows.push([map[x.label]||x.label,x.total]));}
  const cell=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`fieldconnect-analitica-${d.period.from}-${d.period.to}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
