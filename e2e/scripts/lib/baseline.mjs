// Baseline identity for the regression gate (Task 533 / plan 385c; Task 8 note).
// A results.json baseline is only trusted for the target it was recorded on. The identity sidecar
// `<baseline>.identity.json` = { schema: 1, target, resultsSha256 } binds the baseline to a target and
// to its exact bytes. Strict targets (anything except "local") fail closed: missing, malformed,
// foreign or tampered baselines are errors, never a silent "no baseline".
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const LOCAL_TARGET = 'local';
const TARGET_RE = /^[a-z][a-z0-9-]{0,31}$/;

export const identityPath = (baselinePath) => `${baselinePath}.identity.json`;
export const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const normalizeTarget = (t) => (t && t.trim() ? t.trim().toLowerCase() : LOCAL_TARGET);
export const isStrictTarget = (t) => normalizeTarget(t) !== LOCAL_TARGET;

/** Returns a list of problems (empty = baseline is valid for `target`). Never throws on bad input. */
export function checkBaselineIdentity(baselinePath, target) {
  const t = normalizeTarget(target);
  if (!TARGET_RE.test(t)) return [`invalid gate target name`];
  if (!baselinePath) return ['no baseline path given'];
  if (!fs.existsSync(baselinePath)) return ['baseline results file is missing'];
  try {
    const r = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    if (!r || !Array.isArray(r.suites) || r.suites.length === 0) return ['baseline results file has no suites'];
  } catch {
    return ['baseline results file is not valid JSON'];
  }
  const idf = identityPath(baselinePath);
  if (!fs.existsSync(idf)) return ['baseline identity file is missing (record one with: node scripts/lib/baseline.mjs write <results.json> <target>)'];
  let id;
  try { id = JSON.parse(fs.readFileSync(idf, 'utf8')); } catch { return ['baseline identity file is not valid JSON']; }
  const problems = [];
  if (!id || id.schema !== 1) problems.push('baseline identity has an unsupported schema');
  if (normalizeTarget(id?.target) !== t || typeof id?.target !== 'string') problems.push(`baseline belongs to a different target than "${t}"`);
  if (typeof id?.resultsSha256 !== 'string' || id.resultsSha256 !== sha256File(baselinePath)) problems.push('baseline hash does not match its identity (file changed or foreign)');
  return problems;
}

export function writeBaselineIdentity(baselinePath, target) {
  const t = normalizeTarget(target);
  if (!TARGET_RE.test(t)) throw new Error('invalid gate target name');
  fs.writeFileSync(identityPath(baselinePath), JSON.stringify({ schema: 1, target: t, resultsSha256: sha256File(baselinePath) }, null, 2) + '\n');
}

// CLI: node scripts/lib/baseline.mjs check|write <baseline.json> <target>
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, file, target] = process.argv.slice(2);
  if (cmd === 'write' && file && target) {
    if (!fs.existsSync(file)) { console.error('baseline file is missing'); process.exit(1); }
    writeBaselineIdentity(file, target); console.log('identity written');
  } else if (cmd === 'check' && file) {
    const p = checkBaselineIdentity(file, target);
    p.forEach((x) => console.error(`BASELINE: ${x}`)); process.exit(p.length ? 1 : 0);
  } else { console.error('usage: baseline.mjs check <baseline.json> <target> | write <baseline.json> <target>'); process.exit(2); }
}
