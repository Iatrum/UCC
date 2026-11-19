// Seeds FAKE data on the dev Medplum: 1 patient checked into the queue, 3 consultations with MC/letter documents, 8 appointments.
// Usage: node seed.cjs <baseUrl>. Prints ids as JSON.
const path = require('path'), fs = require('fs');
const root = path.resolve(__dirname, '../../..');
const base = process.argv[2];
const cookie = JSON.parse(fs.readFileSync(path.join(root, 'e2e/.secrets/state.json'), 'utf8')).cookies.map(c => c.name + '=' + c.value).join('; ');
const call = async (p, body, method = 'POST') => { const r = await fetch(base + p, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
(async () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const p = await call('/api/patients', { fullName: `Perf696 Fake ${sfx}`, nric: `FAKE-696-${sfx}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000696' });
  const patientId = p.j.patientId;
  const docs = [];
  for (let i = 0; i < 3; i++) {
    const c = await call('/api/consultations', { patientId, chiefComplaint: `Fake visit ${i}`, diagnosis: 'Fake test' });
    const notes = JSON.stringify({ kind: 'mc', mcDays: 2, mcFrom: '2026-11-18', mcTo: '2026-11-19', title: 'MEDICAL CERTIFICATE', status: 'completed' });
    const u = await call('/api/consultations', { consultationId: c.j.consultationId, procedures: [{ name: 'MEDICAL CERTIFICATE', procedureId: 'letter-mc', category: 'documents', price: 10, quantity: 1, notes }] }, 'PATCH');
    docs.push(u.s);
  }
  const ci = await call('/api/check-in', { patientId, chiefComplaint: 'Fake perf visit' });
  const ap = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.now() + (i % 4) * 3600e3 + 86400e3 * Math.floor(i / 4)).toISOString();
    ap.push((await call('/api/appointments', { patientId, patientName: `Perf696 Fake ${sfx}`, clinician: 'Dr Fake', reason: 'Fake follow-up', status: 'booked', scheduledAt: d })).s);
  }
  console.log(JSON.stringify({ patientId, patient: p.s, docs, checkIn: ci.s, appts: ap }));
})();
