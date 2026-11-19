const { readFileSync } = require('node:fs');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd()] }));
const base='http://127.0.0.1:3676';
(async()=>{
 const b=await chromium.launch({headless:true}); const c=await b.newContext({baseURL:base}); const p=await c.newPage();
 await p.addInitScript(()=>{ new PerformanceObserver(l=>{const e=l.getEntries().at(-1); window.__lcp={t:Math.round(e.startTime),el:(e.element?.tagName||'?')+':'+(e.element?.textContent||'').slice(0,20)}}).observe({type:'largest-contentful-paint',buffered:true}); });
 await p.goto('/login',{waitUntil:'domcontentloaded'});
 await p.locator('#email').fill('doctor@ucc.local'); await p.locator('#password').fill(readFileSync(process.env.UCC_BENCH_PASSWORD_FILE,'utf8').trim());
 await p.getByRole('button',{name:'Sign in',exact:true}).click(); await p.waitForURL(/dashboard/); await p.waitForLoadState('networkidle');
 const url=process.argv[2]||'/dashboard';
 for(let i=0;i<8;i++){
  await p.goto(url,{waitUntil:'commit'}); await p.getByRole('tab',{name:"Today's Queue"}).first().waitFor().catch(()=>{}); await p.waitForTimeout(300);
  const r=await p.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];const f=performance.getEntriesByName('first-contentful-paint')[0];return {reqStart:Math.round(n.requestStart),ttfb:Math.round(n.responseStart),respEnd:Math.round(n.responseEnd),fcp:Math.round(f?.startTime||0),lcp:window.__lcp}});
  console.log(i,JSON.stringify(r));
 }
 await b.close();
})();
