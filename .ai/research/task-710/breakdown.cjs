// Per-screen warm timeline from Resource Timing: TTFB, JS bytes (encoded), when auth/API calls start/end. Usage: node breakdown.cjs <base>
const path=require('path');const root=path.resolve(__dirname,'../../..');
const {chromium}=require(path.join(root,'node_modules/playwright-core'));
const base=process.argv[2];
(async()=>{const b=await chromium.launch({args:['--disable-dev-shm-usage']});
const ctx=await b.newContext({storageState:root+'/e2e/.secrets/state.json',viewport:{width:1440,height:900}});
const p=await ctx.newPage();
for(const u of ['/patients','/appointments','/analytics','/orders','/settings']){
 const runs=[];
 for(let k=0;k<7;k++){await p.goto(base+u,{waitUntil:'load'});await p.waitForTimeout(1500);
  runs.push(await p.evaluate(()=>{const nav=performance.getEntriesByType('navigation')[0];const rs=performance.getEntriesByType('resource');
   const js=rs.filter(r=>r.name.endsWith('.js'));const f=(re)=>rs.filter(r=>re.test(r.name)).map(r=>[Math.round(r.startTime),Math.round(r.responseEnd)]);
   return{ttfb:Math.round(nav.responseStart),html:Math.round(nav.responseEnd),dcl:Math.round(nav.domContentLoadedEventEnd),jsKB:Math.round(js.reduce((s,r)=>s+r.encodedBodySize,0)/1024),jsN:js.length,auth:f(/\/api\/auth\/me/)[0],api:f(/\/api\/(patients|appointments)/)}}));}
 const r=runs[3];console.log(u,JSON.stringify(r));}
await b.close()})();
