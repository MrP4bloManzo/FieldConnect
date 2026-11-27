// Small Fetch adapter for the same handlers used by Express.
function createFetchRouter() {
  const routes = [];
  let errorHandler;
  const app = { use(handler) { errorHandler = handler; } };
  for (const method of ['get','post','put','patch']) {
    app[method] = (path,...handlers) => {
      const keys=[];
      const pattern=path.replace(/:([a-z_]+)/gi,(_,key)=>{ keys.push(key); return '([^/]+)'; });
      routes.push({method:method.toUpperCase(),pattern:new RegExp('^'+pattern+'$'),keys,handlers});
    };
  }
  app.handle = async (request, pathname) => {
    const url=new URL(request.url);
    const route=routes.find(r=>r.method===request.method&&r.pattern.test(pathname));
    if(!route)return Response.json({error:'Ruta no encontrada.'},{status:404});
    let body={};
    if(!['GET','HEAD'].includes(request.method)) {
      const raw=await request.text();
      if(new TextEncoder().encode(raw).length>1048576)return Response.json({error:'El contenido excede el tamaño permitido.'},{status:413});
      try { body=raw?JSON.parse(raw):{}; } catch { return Response.json({error:'JSON inválido.'},{status:400}); }
      if(!body||typeof body!=='object'||Array.isArray(body))return Response.json({error:'El cuerpo debe ser un objeto.'},{status:400});
    }
    const match=route.pattern.exec(pathname);
    const req={headers:Object.fromEntries(request.headers),body,query:Object.fromEntries(url.searchParams),params:Object.fromEntries(route.keys.map((key,i)=>[key,decodeURIComponent(match[i+1])]))};
    let status=200,response;
    const res={ status(code) { status=code; return res; }, json(value) { response=Response.json(value,{status}); return res; } };
    const dispatch=async(index,err)=>{
      if(err) { if(errorHandler)return errorHandler(err,req,res,()=>{}); throw err; }
      const handler=route.handlers[index];
      if(handler)await handler(req,res,(error)=>dispatch(index+1,error));
    };
    try { await dispatch(0); }
    catch(err) { if(errorHandler)await errorHandler(err,req,res,()=>{}); else throw err; }
    return response || Response.json({error:'No se pudo procesar la solicitud.'},{status:500});
  };
  return app;
}
module.exports = createFetchRouter;
