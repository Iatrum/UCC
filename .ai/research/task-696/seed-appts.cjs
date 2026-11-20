const path=require('path'),fs=require('fs');const root=path.resolve(__dirname,'../../..');
const [base,patientId]=process.argv.slice(2);
const cookie=JSON.parse(fs.readFileSync(path.join(root,'e2e/.secrets/state.json'),'utf8')).cookies.map(c=>c.name+'='+c.value).join('; ');
(async()=>{const out=[];for(let i=0;i<8;i++){const d=new Date(Date.now()+(i%4)*3600e3+86400e3*Math.floor(i/4)).toISOString();
const r=await fetch(base+'/api/appointments',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({patientId,patientName:'Perf696 Fake',clinician:'Dr Fake',reason:'Fake follow-up',status:'booked',scheduledAt:d})});out.push(r.status);}console.log(out)})();
