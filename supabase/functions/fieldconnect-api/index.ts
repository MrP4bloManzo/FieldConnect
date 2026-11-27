import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import registerApi from './shared/api.js';
import createFetchRouter from './shared/fetch-router.js';

const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{
  max:1,prepare:false,idle_timeout:20,connect_timeout:10,
  connection:{search_path:'fieldconnect'},
});
const query=(client:any)=>async(text:string,params:unknown[]=[])=>{
  const rows=await client.unsafe(text,params);
  return {rows:Array.from(rows),rowCount:rows.count};
};
const pool={query:query(sql),async connect(){const client=await sql.reserve();return {query:query(client),release:()=>client.release()};}};
const secret=Deno.env.get('JWT_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'))[0];
if(!secret)throw new Error('Missing server signing secret');
const key=new TextEncoder().encode(String(secret));
const jwt={
  async sign(payload:any){return await new SignJWT(payload).setProtectedHeader({alg:'HS256'}).setIssuedAt().setIssuer('fieldconnect').setAudience('fieldconnect-web').setExpirationTime('8h').sign(key);},
  async verify(token:string){
    try{return (await jwtVerify(token,key,{algorithms:['HS256'],issuer:'fieldconnect',audience:'fieldconnect-web'})).payload;}
    catch {const e=new Error('Invalid token');e.name='JsonWebTokenError';throw e;}
  },
};
const router=createFetchRouter();
registerApi(router,{pool,jwt,bcrypt,jwtSecret:'runtime-managed',randomUUID:()=>crypto.randomUUID(),jsonParam:(value:unknown)=>sql.json(value)});
const allowedOrigins=new Set(['https://mrp4blomanzo.github.io','http://localhost:3000','http://127.0.0.1:4173']);

Deno.serve(async(request:Request)=>{
  const origin=request.headers.get('origin');
  const headers={
    'Access-Control-Allow-Origin':origin&&allowedOrigins.has(origin)?origin:'https://mrp4blomanzo.github.io',
    'Access-Control-Allow-Headers':'authorization,content-type',
    'Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,OPTIONS',
    'Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  };
  if(origin&&!allowedOrigins.has(origin))return Response.json({error:'Origen no permitido.'},{status:403,headers});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  const pathname=new URL(request.url).pathname.replace(/^\/(?:functions\/v1\/)?fieldconnect-api/,'');
  try {
    const response=await router.handle(request,pathname);
    return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...headers}});
  }catch(err){console.error('Request failed',err?.name,err?.code);return Response.json({error:'No se pudo completar la operación. Intenta nuevamente.'},{status:500,headers});}
});
