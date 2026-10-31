import fs from "node:fs";
import { request } from '@playwright/test';
import { BASE, USER, PASSWORD } from './lib/env';
// One API login per run (Medplum rate-limits auth ~5/min/IP and the app reports that as "Incorrect email or password").
// Also seeds idempotent fake catalog fixtures the workflow needs.
export default async function () {
  // The standalone admin suite owns its single login and must not seed clinic data.
  const specs = process.argv.filter((arg) => /\.spec\.[cm]?[jt]s$/.test(arg));
  if (specs.length === 1 && /(^|\/)admin\.spec\.ts$/.test(specs[0])) return;
  const ctx = await request.newContext({ baseURL: BASE });
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) {
    ok = (await ctx.post('/api/auth/login', { data: { email: USER, password: PASSWORD } })).ok();
    if (!ok) await new Promise(r => setTimeout(r, 65_000));
  }
  if (!ok) throw new Error('Login failed for ' + USER);
  const inv = await (await ctx.get('/api/inventory')).json();
  const haveMed = (n: string) => inv.medications?.some((m: any) => m.name === n);
  for (const [name, cat, form, price] of [['Paracetamol', 'Analgesic', 'Tablet', 0.5], ['Amoxicillin', 'Antibiotic', 'Capsule', 1.2]] as const)
    if (!haveMed(name)) await ctx.post('/api/inventory', { data: { name, category: cat, dosageForm: form, strengths: ['500mg'], stock: 500, minimumStock: 20, unit: form.toLowerCase(), unitPrice: price, expiryDate: '2029-12-31' } });
  const cat = await (await ctx.get('/api/catalogs')).json();
  const have = (n: string) => cat.items?.some((c: any) => c.name === n);
  const items = [
    { type: 'lab', name: 'Full Blood Count', code: '58410-2', system: 'http://loinc.org', defaultPrice: 25 },
    { type: 'imaging', name: 'Chest X-ray PA view', code: '36643-5', system: 'http://loinc.org', modality: 'DX', defaultPrice: 60 },
    { type: 'imaging', name: 'Ultrasound abdomen', modality: 'US', defaultPrice: 120 },
    { type: 'diagnosis', name: 'Acute pharyngitis', code: 'J02.9', system: 'http://hl7.org/fhir/sid/icd-10' },
    { type: 'document', name: 'Medical Certificate', code: 'letter-mc', defaultPrice: 10 },
    { type: 'document', name: 'Referral Letter', code: 'letter-referral', defaultPrice: 0 },
  ];
  for (const it of items) if (!have(it.name)) await ctx.post('/api/catalogs', { data: it });
  const procs = await (await ctx.get('/api/procedures')).json();
  if (!procs.procedures?.some((p: any) => p.name === 'Wound dressing')) await ctx.post('/api/procedures', { data: { name: 'Wound dressing', category: 'Minor procedure', defaultPrice: 30 } });
  fs.mkdirSync(".secrets", { recursive: true }); await ctx.storageState({ path: '.secrets/state.json' }); await ctx.dispose();
}
