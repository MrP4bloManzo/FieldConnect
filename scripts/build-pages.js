const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
fs.mkdirSync(path.join(root,'dist'),{recursive:true});
fs.cpSync(path.join(root,'public'),path.join(root,'dist'),{recursive:true});
// Keep the existing branch-based Pages entrypoint functional as well.
for(const name of ['index.html','app.js','styles.css','config.js','analytics.js']) {
  fs.copyFileSync(path.join(root,'public',name),path.join(root,name));
}
console.log('GitHub Pages application built in dist/.');
