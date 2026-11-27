const test=require('node:test');
const assert=require('node:assert/strict');
const createFetchRouter=require('../src/fetch-router');
test('Fetch adapter waits for authentication and forwards parameters, JSON and errors',async()=>{
  const app=createFetchRouter();
  app.use((err,req,res,next)=>res.status(400).json({error:err.message}));
  app.post('/api/items/:id',async(req,res,next)=>{await Promise.resolve();req.user={id:7};return next();},async(req,res)=>{await Promise.resolve();res.status(201).json({id:req.params.id,user:req.user.id,body:req.body,q:req.query.q});});
  app.get('/api/failure',async()=>{throw new Error('Expected failure');});
  const response=await app.handle(new Request('https://example.com/api/items/4?q=ok',{method:'POST',body:JSON.stringify({hello:'world'})}),'/api/items/4');
  assert.equal(response.status,201);assert.deepEqual(await response.json(),{id:'4',user:7,body:{hello:'world'},q:'ok'});
  assert.equal((await app.handle(new Request('https://example.com/api/items/4',{method:'POST',body:'bad json'}),'/api/items/4')).status,400);
  assert.equal((await app.handle(new Request('https://example.com/unknown'),'/unknown')).status,404);
  assert.equal((await app.handle(new Request('https://example.com/api/failure'),'/api/failure')).status,400);
});
