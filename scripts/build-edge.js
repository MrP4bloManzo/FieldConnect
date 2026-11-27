const fs=require('fs');
const path=require('path');
const dir=path.join(__dirname,'..','supabase','functions','fieldconnect-api','shared');
fs.mkdirSync(dir,{recursive:true});
for(const [name,exportName] of [['api','registerApi'],['fetch-router','createFetchRouter']]) {
  const source=fs.readFileSync(path.join(__dirname,'..','src',name+'.js'),'utf8')
    .replace('module.exports = '+exportName+';','export default '+exportName+';');
  fs.writeFileSync(path.join(dir,name+'.js'),source);
}
console.log('Shared API prepared for Supabase Edge Functions.');
