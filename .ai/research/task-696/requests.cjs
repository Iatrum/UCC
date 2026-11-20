const path=require('path');const root=''+require('path').resolve(__dirname,'../../..')+'';
const {chromium}=require(path.join(root,'node_modules/playwright-core'));
const [base,pid]=process.argv.slice(2);
(async()=>{const b=await chromium.launch({args:['--disable-dev-shm-usage']});
const ctx=await b.newContext({storageState:path.join(root,'e2e/.secrets/state.json'),viewport:{width:1440,height:900}});
const p=await ctx.newPage();
for(let k=0;k<2;k++){await p.goto(base+'/patients/'+pid);await p.waitForTimeout(800);}
const rows=[];let t0;
p.on('request',r=>rows.push({t:Date.now()-t0,u:r.url().replace(base,'').slice(0,80),ty:r.resourceType(),rsc:r.headers()['rsc']?'RSC':''}));
t0=Date.now();await p.goto(base+'/patients/'+pid,{waitUntil:'commit'});
await p.getByRole('tab',{name:'Documents',exact:true}).click();
await p.waitForTimeout(2000);
const by={};rows.forEach(r=>{const k=r.ty+(r.rsc?'/RSC':'');by[k]=(by[k]||0)+1});console.log(by);
console.log(rows.filter(r=>r.rsc||/api/.test(r.u)).map(r=>r.t+' '+r.u+' '+r.rsc).join('\n'));await b.close();})();
