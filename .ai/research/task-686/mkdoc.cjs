// Creates ONE fake patient + consultation with a signed MC line on the dev Medplum (fake data). Prints the patient id.
const path = require('path'), fs = require('fs');
const root = path.resolve(__dirname, '../../..');
const base = process.argv[2];
const cookie = JSON.parse(fs.readFileSync(path.join(root, 'e2e/.secrets/state.json'), 'utf8')).cookies.map(c => c.name + '=' + c.value).join('; ');
const post = async (p, body, method = 'POST') => { const r = await fetch(base + p, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
(async () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const p = await post('/api/patients', { fullName: `Slow686 Fake ${sfx}`, nric: `FAKE-686-${sfx}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000686' });
  const patientId = p.j.patientId;
  const c = await post('/api/consultations', { patientId, chiefComplaint: 'Fake slow-net visit', diagnosis: 'Fake test' });
  const consultationId = c.j.consultationId;
  const notes = JSON.stringify({ kind: 'mc', mcDays: 2, mcFrom: '2026-11-18', mcTo: '2026-11-19', title: 'MEDICAL CERTIFICATE', status: 'completed' });
  const u = await post('/api/consultations', { consultationId, procedures: [{ name: 'MEDICAL CERTIFICATE', procedureId: 'letter-mc', category: 'documents', price: 10, quantity: 1, notes }] }, 'PATCH');
  console.log(JSON.stringify({ patientId, consultationId, patch: u.s }));
})();
