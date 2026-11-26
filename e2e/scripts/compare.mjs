// compare.mjs <results.json> [baseline.json]: prints pass count, exits 1 on a NEW failure vs baseline.
import fs from 'node:fs';
import { checkBaselineIdentity, isStrictTarget, normalizeTarget } from './lib/baseline.mjs';
const load = (f, current = false) => { const r = JSON.parse(fs.readFileSync(f, 'utf8')); const t = {};
  const w = s => { (s.specs || []).forEach(x => x.tests.forEach(y => t[x.title] = y.results.at(-1)?.status)); (s.suites || []).forEach(w); };
  r.suites.forEach(w);
  if (current && (r.errors?.length || !Object.keys(t).length || Object.values(t).some(s => !s || s === 'interrupted'))) {
    console.error('FAIL: Playwright report contains global errors or incomplete test results');
    process.exit(1);
  }
  return t;
};
// Strict (non-local) gate target, e.g. UCC_GATE_TARGET=staging: the baseline must exist and be attested for
// that target, otherwise FAIL (Task 533). Local runs keep the old lenient behaviour.
const target = normalizeTarget(process.env.UCC_GATE_TARGET);
if (isStrictTarget(target)) {
  const problems = checkBaselineIdentity(process.argv[3], target);
  if (problems.length) { problems.forEach(p => console.log(`  BASELINE REJECTED: ${p}`)); console.log('FAIL: no trusted baseline for target ' + target); process.exit(1); }
}
// Strict targets also need every non-passed test (failed, timedOut, skipped, interrupted) to be an EXACT title in
// the approved-exception file (UCC_GATE_EXCEPTIONS, default e2e/staging-exceptions.json: JSON array of titles).
// A baseline match alone is not an approval, so skips cannot hide on staging (Task 607 / plan 385c).
let approved = null;
if (isStrictTarget(target)) {
  const ef = process.env.UCC_GATE_EXCEPTIONS || new URL('../staging-exceptions.json', import.meta.url).pathname;
  try { approved = fs.existsSync(ef) ? JSON.parse(fs.readFileSync(ef, 'utf8')) : [];
    if (!Array.isArray(approved) || approved.some(x => typeof x !== 'string')) throw new Error('not an array of strings'); }
  catch (e) { console.log(`  EXCEPTION LIST REJECTED: ${ef}: ${e.message}`); console.log('FAIL: unreadable approved-exception list'); process.exit(1); }
}
const cur = load(process.argv[2], true); const base = process.argv[3] && fs.existsSync(process.argv[3]) ? load(process.argv[3]) : null;
const names = Object.keys(cur); console.log(`passed ${names.filter(n => cur[n] === 'passed').length}/${names.length}`);
let bad = 0;
for (const n of names) if (cur[n] !== 'passed' && approved && !approved.includes(n)) { bad++; console.log(`  UNAPPROVED ${cur[n]}: ${n} (add the exact title to the exception list only after review)`); }
else if (cur[n] !== 'passed') {
  const isNew = base ? base[n] === 'passed' || !(n in base) : cur[n] !== 'skipped';
  if (isNew) bad++;
  const label = isNew ? (base ? 'NEW FAIL' : 'FAIL') : cur[n];
  console.log(`  ${label}: ${n}`);
}
if (base) for (const n of Object.keys(base)) if (!(n in cur)) { bad++; console.log(`  MISSING: ${n}`); }
process.exit(bad ? 1 : 0);
