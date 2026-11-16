#!/usr/bin/env bun
// Disposable integration rehearsal; never changes the existing clinical project.
// Run with DEV_OPERATOR_EMAIL / DEV_OPERATOR_PASSWORD for the dedicated dev
// operator. Credentials and fixture resource bodies never enter test output.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
const B = 'http://127.0.0.1:8113/';
const check = (ok, label) => { if (!ok) throw Error(label); console.log(`PASS ${label}`); };
async function http(token, p, method = 'GET', body) {
  const r = await fetch(new URL(p, B), { method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/fhir+json', 'X-Medplum': 'extended', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => undefined) };
}
async function login(email, password, projectId) {
  for (let i=0;i<8;i++) {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const r = await http(null, 'auth/login', 'POST', { email, password, projectId,
      codeChallenge: crypto.createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256' });
    if (r.status === 429) { await new Promise(r=>setTimeout(r,20000)); continue; }
    if (r.status !== 200 || !r.json.code) throw Error('Fixture login failed');
    const t = await fetch(B+'oauth2/token', { method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:r.json.code,code_verifier:verifier}) });
    const token = (await t.json()).access_token;
    if (!token) throw Error('Fixture token exchange failed');
    return token;
  }
  throw Error('Fixture auth throttled');
}
const suffix=crypto.randomUUID();
const dir=fs.mkdtempSync('/home/dev/ucc-task5-rehearsal-'); fs.chmodSync(dir,0o700);
const fakePassword=crypto.randomBytes(24).toString('base64url');
let root, project, opsName=`Task5 Rehearsal Operator ${suffix}`;
const created=[];
const get=async(ref)=>(await http(root,'fhir/R4/'+ref)).json;
const search=async(type,pid)=>(await http(root,`fhir/R4/${type}?_project=${pid}&_count=1000`)).json?.entry?.map(e=>e.resource)||[];
const create=async(resource,pid)=>{
  const r=await http(root,'fhir/R4/'+resource.resourceType,'POST',{...resource,meta:pid?{project:pid}:undefined});
  if(r.status!==201||!r.json?.id)throw Error(`Fixture ${resource.resourceType} create failed (${r.status})`);
  created.push(`${r.json.resourceType}/${r.json.id}`);return r.json;
};
const invite=async(pid,email,admin)=>{
  const r=await http(root,`admin/projects/${pid}/invite`,'POST',{resourceType:'Practitioner',firstName:'Fake',lastName:'Rehearsal',email,password:fakePassword,sendEmail:false,admin});
  if(r.status!==200)throw Error('Fixture invite failed');
  for(const ref of [r.json.user?.reference,r.json.profile?.reference,`ProjectMembership/${r.json.id}`])if(ref)created.push(ref);
  return r.json;
};
let cliArgs, cliEnv;
async function cli(extra=[],expected=0){
  const c=spawn(process.execPath,[new URL('./task5-topology.mjs',import.meta.url).pathname,...cliArgs,...extra],{env:cliEnv,stdio:['ignore','pipe','pipe']});
  // Keep output private: errors must not serialize child env or credentials.
  let output='';c.stdout.on('data',d=>output+=d);c.stderr.on('data',d=>output+=d);
  const timer=setTimeout(()=>c.kill('SIGTERM'),300000);
  const status=await new Promise(resolve=>c.on('exit',resolve));clearTimeout(timer);
  if(status!==expected){fs.writeFileSync(dir+'/cli-failure.log',output,{mode:0o600});throw Error(`CLI exit mismatch (${status}, expected ${expected}); private status log saved`);}
}
try{
  root=await login(process.env.DEV_OPERATOR_EMAIL,process.env.DEV_OPERATOR_PASSWORD);
  const me=await http(root,'auth/me');check(me.json?.project?.superAdmin===true,'dedicated dev operator authenticated');
  project=await create({resourceType:'Project',name:`Task5 Fake Clinical ${suffix}`,superAdmin:true});
  const adminEmail=`task5-admin-${suffix}@example.invalid`;
  await invite(project.id,adminEmail,true);
  const clientResult=await http(root,`admin/projects/${project.id}/client`,'POST',{name:'Task5 Fake App'});
  if(clientResult.status!==201)throw Error('Fixture client create failed');
  const client=clientResult.json;created.push(`ClientApplication/${client.id}`);
  const app=(await search('ProjectMembership',project.id)).find(m=>m.profile?.reference===`ClientApplication/${client.id}`);
  if(!app)throw Error('Client creation did not create a membership');
  created.push(`ProjectMembership/${app.id}`);
  const members=[];
  for(let i=0;i<2;i++){
    const identifier=[{system:'clinic',value:`task5-${suffix}-${i}`}];
    const org=await create({resourceType:'Organization',identifier,name:'Fake Rehearsal Clinic'},project.id);
    const acct=await create({resourceType:'HealthcareService',identifier,active:true,providedBy:{reference:`Organization/${org.id}`}},project.id);
    const email=`task5-staff-${suffix}-${i}@example.invalid`;
    const member=await invite(project.id,email,false);members.push({member,email,org,acct});
    await create({resourceType:'PractitionerRole',active:true,practitioner:member.profile,organization:{reference:`Organization/${org.id}`}},project.id);
  }
  cliArgs=['--project',project.id,'--app-client',client.id,'--ops-project-name',opsName,'--operator-email',`task5-ops-${suffix}@example.invalid`,'--backup-dir',dir];
  cliEnv={...process.env,MEDPLUM_BASE_URL:B,MEDPLUM_ADMIN_EMAIL:adminEmail,MEDPLUM_ADMIN_PASSWORD:fakePassword};
  const original=await get(`Project/${project.id}`);
  await cli();check(isDeepStrictEqual(await get(`Project/${project.id}`),original),'default dry-run makes no project writes');
  check(!fs.existsSync(`${dir}/task5-pre-${project.id}.json`),'dry-run does not create migration snapshot');
  const existingStaffToken = await login(members[0].email, fakePassword, project.id);
  check((await http(existingStaffToken, `fhir/R4/ProjectMembership/${members[0].member.id}`)).status === 200, 'pre-cutover token positive control');
  await cli(['--apply']);
  check((await http(existingStaffToken, 'auth/me')).status === 200, 'pre-cutover staff token remains authenticated');
  check([403,404].includes((await http(existingStaffToken, 'fhir/R4/ProjectMembership?_count=100')).status), 'pre-cutover staff token loses admin directory grants');
  const after=await get(`Project/${project.id}`);check(after.superAdmin===false,'clinical project is non-superAdmin after apply');
  const clientTokenResponse=await fetch(B+'oauth2/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/x-www-form-urlencoded',authorization:'Basic '+Buffer.from(client.id+':'+client.secret).toString('base64')},body:new URLSearchParams({grant_type:'client_credentials'})});
  const clientToken=(await clientTokenResponse.json()).access_token;
  check(Boolean(clientToken),'app client authenticates after policy installation');
  check((await http(clientToken, 'fhir/R4/'+me.json.profile.resourceType+'/'+me.json.profile.id)).status===404,'app client cannot read operator project profile');
  for(const type of ['Bot','ClientApplication','Login'])check((await http(clientToken,'fhir/R4/'+type+'?_count=10')).status===403,`app client has no ${type} grant`);
  const policies=await search('AccessPolicy',project.id);check(policies.length===2,'policies belong to the clinical project');
  for(const s of members){const m=await get(`ProjectMembership/${s.member.id}`);check(m.access?.length===1&&!m.accessPolicy,'legacy staff membership gains clinic access entry');}
  const snap=JSON.parse(fs.readFileSync(`${dir}/task5-pre-${project.id}.json`));check((fs.statSync(`${dir}/task5-pre-${project.id}.json`).mode&0o777)===0o600,'snapshot is private');
  const versions=await Promise.all([`Project/${project.id}`,`ProjectMembership/${app.id}`,...members.map(s=>`ProjectMembership/${s.member.id}`),...policies.map(p=>`AccessPolicy/${p.id}`)].map(get));
  await cli(['--apply']);check(isDeepStrictEqual(await Promise.all(versions.map(r=>get(`${r.resourceType}/${r.id}`))),versions),'second apply does not rewrite project memberships or policies');
  // Use the independently exercised black-box verifier on both fresh staff tokens.
  const c=spawn(process.execPath,[new URL('./verify-clinic-isolation.mjs',import.meta.url).pathname,'--label','rehearsal','--project',project.id,'--staff',members[0].email,'--staff',members[1].email,'--out',dir+'/isolation.json'],{env:{...cliEnv,UCC_STAFF_PASSWORD:fakePassword},stdio:['ignore','pipe','pipe']});
  let output='';c.stdout.on('data',d=>output+=d);c.stderr.on('data',d=>output+=d);
  const timer=setTimeout(()=>c.kill('SIGTERM'),300000);const status=await new Promise(r=>c.on('exit',r));clearTimeout(timer);
  fs.writeFileSync(dir+'/isolation.log',output,{mode:0o600});check(status===0,'fresh staff tokens pass clinic isolation verifier');
  const current=await get(`ProjectMembership/${members[0].member.id}`);
  const drift=await http(root,`fhir/R4/ProjectMembership/${current.id}`,'PUT',{...current,admin:true});check(drift.status===200,'fixture grant drift installed');
  await cli(['--rollback','--apply'],2);check((await get(`Project/${project.id}`)).superAdmin===false,'rollback refuses grant drift before cutover');
  await http(root,`fhir/R4/ProjectMembership/${current.id}`,'PUT',current);
  await cli(['--rollback']);check((await get(`Project/${project.id}`)).superAdmin===false,'rollback defaults to dry-run');
  await cli(['--rollback','--apply']);check((await get(`Project/${project.id}`)).superAdmin===true,'rollback restores original project mode');
  for(const m of [app,...members.map(s=>s.member)]){const now=await get(`ProjectMembership/${m.id}`);check(isDeepStrictEqual([now.access,now.accessPolicy,now.admin],[m.access,m.accessPolicy,m.admin]),'rollback restores exact original membership grants');}
  check((await search('AccessPolicy',project.id)).length===0,'rollback removes policies created by migration');
  for(const item of snap.directory){const p=await get(item.pr);check(isDeepStrictEqual((p.meta?.accounts||[]).map(a=>a.reference).sort(),item.before),'rollback restores directory accounts');}
  console.log('Task 5 topology rehearsal PASS');
}catch(error){console.error('Task 5 topology rehearsal FAILED: '+error.message+'; private evidence at '+dir);process.exitCode=1;}
finally{
  if(root){
    // Also collect operator identities created by the script; all are disposable.
    const ops=(await http(root,`fhir/R4/Project?name=${encodeURIComponent(opsName)}&_count=100`)).json?.entry?.map(e=>e.resource).filter(p=>p.name===opsName)||[];
    for(const p of ops){for(const m of await search('ProjectMembership',p.id)){created.push(m.user?.reference,m.profile?.reference,`ProjectMembership/${m.id}`);}created.push(`Project/${p.id}`);}
    if(project)for(const type of ['AccessPolicy','PractitionerRole','Patient','Encounter','ServiceRequest','ImagingStudy','Observation'])for(const r of await search(type,project.id))created.push(`${type}/${r.id}`);
    const priority=r=>r.startsWith('Project/')?9:r.startsWith('User/')?8:r.startsWith('ProjectMembership/')?0:3;
    for(const ref of [...new Set(created.filter(Boolean))].sort((a,b)=>priority(a)-priority(b))){const r=await http(root,'fhir/R4/'+ref,'DELETE');if(![200,204,404,410].includes(r.status)){console.error('Fixture cleanup failed ('+r.status+')');process.exitCode=1;}}
    console.log('Disposable fixture cleanup completed');
  }
}
