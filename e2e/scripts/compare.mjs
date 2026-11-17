// compare.mjs <results.json> [baseline.json]: prints pass count, exits 1 on a NEW failure vs baseline.
import fs from 'node:fs';
import { checkBaselineIdentity, isStrictTarget, normalizeTarget } from './lib/baseline.mjs';
const load = f => { const r = JSON.parse(fs.readFileSync(f, 'utf8')); const t = {};
  const w = s => { (s.specs || []).forEach(x => x.tests.forEach(y => t[x.title] = y.results.at(-1)?.status)); (s.suites || []).forEach(w); };
  r.suites.forEach(w); return t; };
// Strict (non-local) gate target, e.g. UCC_GATE_TARGET=staging: the baseline must exist and be attested for
// that target, otherwise FAIL (Task 533). Local runs keep the old lenient behaviour.
const target = normalizeTarget(process.env.UCC_GATE_TARGET);
if (isStrictTarget(target)) {
  const problems = checkBaselineIdentity(process.argv[3], target);
  if (problems.length) { problems.forEach(p => console.log(`  BASELINE REJECTED: ${p}`)); console.log('FAIL: no trusted baseline for target ' + target); process.exit(1); }
}
const cur = load(process.argv[2]); const base = process.argv[3] && fs.existsSync(process.argv[3]) ? load(process.argv[3]) : null;
const names = Object.keys(cur); console.log(`passed ${names.filter(n => cur[n] === 'passed').length}/${names.length}`);
let bad = 0;
for (const n of names) if (cur[n] !== 'passed') { const isNew = base && (base[n] === 'passed' || !(n in base)); if (isNew) bad++; console.log(`  ${isNew ? 'NEW FAIL' : 'fail (also in baseline)'}: ${n}`); }
if (base) for (const n of Object.keys(base)) if (!(n in cur)) { bad++; console.log(`  MISSING: ${n}`); }
process.exit(bad ? 1 : 0);
