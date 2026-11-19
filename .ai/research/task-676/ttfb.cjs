const { readFileSync } = require('node:fs');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd()] }));
const base='http://127.0.0.1:3676';
(async()=>{
 const b=await chromium.launch({headless:true}); const c=await b.newContext({baseURL:base}); const p=await c.newPage();
 await p.goto('/login',{waitUntil:'domcontentloaded'});
 await p.locator('#email').fill('doctor@ucc.local'); await p.locator('#password').fill(readFileSync(process.env.UCC_BENCH_PASSWORD_FILE,'utf8').trim());
 await p.getByRole('button',{name:'Sign in',exact:true}).click(); await p.waitForURL(/dashboard/); 
 const cookie=(await c.cookies()).map(x=>x.name+'='+x.value).join('; '); await b.close();
 for (const path of (process.argv[2]||'/dashboard').split(',')) {
  const rows=[];
  for(let i=0;i<13;i++){
   const t=performance.now(); const r=await fetch(base+path,{headers:{cookie}}); const th=performance.now()-t;
   const rd=r.body.getReader(); let n=0, first=null; const times=[];
   for(;;){const {done,value}=await rd.read(); if(done)break; n++; times.push(Math.round(performance.now()-t));}
   if(i) rows.push({head:Math.round(th),chunks:n,times:times.join(',')});
  }
  rows.sort((a,b)=>a.head-b.head); console.log(path,'median head',rows[6].head,'chunks',rows[6].chunks,'times',rows[6].times);
 }
})();
