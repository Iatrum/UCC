/**
 * Read-only exposure audit CLI (plan 1.2 / 1.3, Task 570). Reads command output on stdin or compose
 * files by path; never runs commands and never touches Docker. Exit 1 if any finding.
 *
 *   docker ps --format '{{.Names}}\t{{.Ports}}' | bun run staging:audit docker-ps
 *   ss -tuln                                    | bun run staging:audit listeners
 *   nmap -Pn -oG - -p 22,80,443,5432,... IP     | bun run staging:audit nmap     (from OUTSIDE)
 *   bun run staging:audit compose infra/staging/docker-compose.yml ...
 * Output may contain IPs and container names, no secrets; still do not paste it publicly unredacted.
 */
import { readFileSync } from 'node:fs';
import { auditComposeText, auditDockerPs, auditListeners, auditNmapGreppable, type Finding } from './lib/exposure';

const [mode, ...files] = process.argv.slice(2);
let findings: Finding[];
switch (mode) {
  case 'docker-ps': findings = auditDockerPs(readFileSync(0, 'utf8')); break;
  case 'listeners': findings = auditListeners(readFileSync(0, 'utf8')); break;
  case 'nmap': findings = auditNmapGreppable(readFileSync(0, 'utf8')); break;
  case 'compose':
    if (!files.length) { console.error('give at least one compose file'); process.exit(2); }
    findings = files.flatMap((f) => auditComposeText(f, readFileSync(f, 'utf8'), { allowHostNetwork: f.includes('infra/pacs-dev/') }));
    break;
  default:
    console.error('usage: audit-exposure.ts docker-ps|listeners|nmap (stdin) | compose <files>');
    process.exit(2);
}
for (const f of findings) console.log(`FINDING ${f.where}: ${f.problem}`);
console.log(findings.length ? `AUDIT FAIL (${findings.length})` : 'AUDIT OK');
process.exit(findings.length ? 1 : 0);
