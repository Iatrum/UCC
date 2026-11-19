// Request waterfall for one warm load. Usage: node waterfall.cjs <base> <path>
const path=require('path');const root=path.resolve(__dirname,'../../..');
const {chromium}=require(path.join(root,'node_modules/playwright-core'));
const [base,u]=process.argv.slice(2);
(async()=>{const b=await chromium.launch({args:['--disable-dev-shm-usage']});
const ctx=await b.newContext({storageState:root+'/e2e/.secrets/state.json',viewport:{width:1440,height:900}});
const p=await ctx.newPage();
for(let k=0;k<2;k++){await p.goto(base+u);await p.waitForTimeout(1500);}
const rows=[];let t0;const st=new Map();
p.on('request',r=>{st.set(r,Date.now()-t0)});
p.on('requestfinished',async r=>{const t=r.timing();rows.push({s:st.get(r),e:Date.now()-t0,m:r.method(),u:r.url().replace(base,'').replace(/^https?:\/\/[^/]+/,m=>m).slice(0,110),ty:r.resourceType()})});
t0=Date.now();await p.goto(base+u,{waitUntil:'commit'});await p.waitForTimeout(4000);
rows.filter(r=>/api|8113|fetch|xhr/.test(r.u+r.ty)||r.ty==='document').sort((a,c)=>a.s-c.s).forEach(r=>console.log(String(r.s).padStart(5),String(r.e).padStart(5),r.m,r.ty,r.u));
await b.close()})();
