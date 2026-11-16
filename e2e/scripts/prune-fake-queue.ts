// Dev-only gate helper: take leftover FAKE e2e encounters out of today's queue.
// /api/queue returns at most 200 encounters per day, sorted by date. After many gate runs the dev Medplum holds
// more than that, so a freshly checked-in test patient never appears on the dashboard (workflow 03 fails).
// Only encounters whose patient name contains " Fake " are set to 'cancelled' (nothing is deleted).
import { fhir } from '../lib/fhir';

const m = await fhir();
if (!/^https?:\/\/(localhost|127\.0\.0\.1):8113\b/.test(String(process.env.MEDPLUM_BASE_URL || process.env.MEDPLUM_URL || 'http://127.0.0.1:8113'))) throw Error('Dev Medplum only');
const start = new Date(); start.setHours(0, 0, 0, 0);
const end = new Date(start); end.setDate(end.getDate() + 1);
let cancelled = 0;
for (let pass = 0; pass < 20; pass++) {
  const bundle: any = await m.search('Encounter',
    `status=arrived,triaged,in-progress,finished&date=ge${start.toISOString()}&date=lt${end.toISOString()}&_count=200&_include=Encounter:subject`);
  const resources = (bundle.entry || []).map((e: any) => e.resource);
  const fake = new Set(resources.filter((r: any) => r.resourceType === 'Patient'
    && / Fake /.test(`${r.name?.[0]?.text || ''} ${(r.name?.[0]?.given || []).join(' ')} ${r.name?.[0]?.family || ''}`)).map((r: any) => `Patient/${r.id}`));
  const targets = resources.filter((r: any) => r.resourceType === 'Encounter' && fake.has(r.subject?.reference));
  if (!targets.length) break;
  for (const enc of targets) { await m.updateResource({ ...enc, status: 'cancelled' }); cancelled++; }
}
console.log(`prune-fake-queue: cancelled ${cancelled} fake encounters`);
