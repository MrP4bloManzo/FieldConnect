const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
fs.mkdirSync(path.join(root,'dist'),{recursive:true});
fs.cpSync(path.join(root,'public'),path.join(root,'dist'),{recursive:true});
console.log('GitHub Pages application built in dist/.');
