// compare.mjs <results.json> [baseline.json]: prints pass count, exits 1 on a NEW failure vs baseline.
import fs from 'node:fs';
const load = f => { const r = JSON.parse(fs.readFileSync(f, 'utf8')); const t = {};
  const w = s => { (s.specs || []).forEach(x => x.tests.forEach(y => t[x.title] = y.results.at(-1)?.status)); (s.suites || []).forEach(w); };
  r.suites.forEach(w); return t; };
const cur = load(process.argv[2]); const base = process.argv[3] && fs.existsSync(process.argv[3]) ? load(process.argv[3]) : null;
const names = Object.keys(cur); console.log(`passed ${names.filter(n => cur[n] === 'passed').length}/${names.length}`);
let bad = 0;
for (const n of names) if (cur[n] !== 'passed') { const isNew = base && base[n] === 'passed'; if (isNew) bad++; console.log(`  ${isNew ? 'NEW FAIL' : 'fail (also in baseline)'}: ${n}`); }
if (base) for (const n of Object.keys(base)) if (!(n in cur)) { bad++; console.log(`  MISSING: ${n}`); }
process.exit(bad ? 1 : 0);
