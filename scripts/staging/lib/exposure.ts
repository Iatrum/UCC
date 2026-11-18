/**
 * Pure parsers for the plan 1.2 / 1.3 exposure audit (Task 570). Read-only text analysis:
 * they take command OUTPUT (docker ps, ss, nmap -oG) or compose file TEXT and return findings.
 * Nothing here runs a command, opens a socket or touches Docker.
 * Every function fails closed: an address it cannot classify is a finding, not a pass.
 */

export type Finding = { where: string; problem: string };

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|\[::1\])$/;
export const isLoopbackHost = (h: string) => LOOPBACK.test(h.replace(/%.*$/, ''));

/** Split "host:port" where host may be `[::]`, `*`, `0.0.0.0`, `127.0.0.53%lo`. */
export function splitAddr(a: string): { host: string; port: string } | null {
  const i = a.lastIndexOf(':');
  if (i <= 0) return null;
  return { host: a.slice(0, i), port: a.slice(i + 1) };
}

/** `docker ps --format '{{.Names}}\t{{.Ports}}'` (tab or 2+ spaces between name and ports). */
export function auditDockerPs(output: string, allowPublic: number[] = [80, 443]): Finding[] {
  const out: Finding[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim() || /^NAMES\b/i.test(line)) continue;
    const [name, ...rest] = line.split(/\t| {2,}/);
    const ports = rest.join(' ');
    for (const m of ports.matchAll(/(\[[^\]]+\]|[0-9.]+|:{3}|\*)?:(\d+)(?:-(\d+))?->(\d+)(?:-\d+)?\/(tcp|udp)/g)) {
      const host = m[1] === ':::' || m[1] === '*' ? '0.0.0.0' : m[1] ?? '';
      if (host && isLoopbackHost(host)) continue;
      const pub = Number(m[2]);
      if (allowPublic.includes(pub) && m[5] === 'tcp') continue;
      out.push({ where: name, problem: `published on ${host || '?'}:${m[2]} (${m[5]}), not loopback and not an allowed public port` });
    }
  }
  return out;
}

/** `ss -tuln` / `ss -tulpn` output. Flags non-loopback listeners outside `allowPublic`. */
export function auditListeners(output: string, allowPublic: number[] = [22, 80, 443]): Finding[] {
  const out: Finding[] = [];
  for (const line of output.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || !/^(tcp|udp)/i.test(cols[0])) continue;
    const idx = /^(LISTEN|UNCONN)$/i.test(cols[1]) ? 4 : 3; // with or without the State column
    const a = splitAddr(cols[idx] ?? '');
    if (!a) { out.push({ where: line.trim(), problem: 'unparseable local address' }); continue; }
    if (isLoopbackHost(a.host)) continue;
    if (allowPublic.includes(Number(a.port)) && /^tcp/i.test(cols[0])) continue;
    out.push({ where: `${cols[0]} ${cols[idx]}`, problem: 'listening on a non-loopback address outside the allowed public ports' });
  }
  return out;
}

/** `nmap -oG -` (greppable) output from OUTSIDE the host. Any open port outside `expected` is a finding. */
export function auditNmapGreppable(output: string, expected: number[] = [22, 80, 443]): Finding[] {
  const out: Finding[] = [];
  let sawHost = false;
  for (const line of output.split('\n')) {
    const m = line.match(/^Host:\s+(\S+).*\sPorts:\s+(.*?)(?:\t|$)/);
    if (!m) continue;
    sawHost = true;
    for (const p of m[2].split(',')) {
      const f = p.trim().split('/');
      if (f[1] === 'open' && !expected.includes(Number(f[0]))) out.push({ where: m[1], problem: `port ${f[0]}/${f[2]} (${f[4] || '?'}) open from outside` });
    }
  }
  if (!sawHost) out.push({ where: 'nmap', problem: 'no scanned host in output (wrong format? use -oG -)' });
  return out;
}

/** Compose file text (line based; no YAML parser so it also works for templated files). */
export function auditComposeText(name: string, text: string, opts: { allowHostNetwork?: boolean } = {}): Finding[] {
  const out: Finding[] = [];
  const lines = text.split('\n').map((l) => l.replace(/(^|\s)#.*$/, ''));
  const add = (n: number, problem: string) => out.push({ where: `${name}:${n + 1}`, problem });
  let portsIndent = -1;
  let item: { start: number; published: boolean; hostIp: string | null } | null = null;
  const flush = () => {
    if (item?.published && !(item.hostIp && isLoopbackHost(item.hostIp))) add(item.start, 'long-form port without a loopback host_ip');
    item = null;
  };
  lines.forEach((raw, n) => {
    const ind = raw.search(/\S/);
    if (ind < 0) return;
    const l = raw.trim();
    if (portsIndent >= 0 && ind <= portsIndent && !l.startsWith('-')) { flush(); portsIndent = -1; }
    if (/^ports:\s*$/.test(l)) { portsIndent = ind; return; }
    if (portsIndent >= 0) {
      if (l.startsWith('- ') && /^-\s*['"]?[\[\d$]/.test(l) && !/^-\s*(target|published|host_ip)\s*:/.test(l)) {
        flush();
        const v = l.replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '').replace(/\/(tcp|udp)$/, '');
        if (v.includes('$')) { add(n, `port "${v}" uses interpolation; cannot prove loopback`); return; }
        const m = v.match(/^(\[[^\]]+\]|[0-9.]+):[\d-]+:[\d-]+$/);
        if (m) { if (!isLoopbackHost(m[1])) add(n, `port "${v}" binds ${m[1]}`); }
        else add(n, `port "${v}" has no host IP (binds all interfaces${/^[\d-]+$/.test(v) ? ', ephemeral' : ''})`);
      } else if (/^-\s*(target|published)\s*:/.test(l)) { flush(); item = { start: n, published: /published/.test(l), hostIp: null }; }
      else if (item) {
        if (/^published\s*:/.test(l)) item.published = true;
        const h = l.match(/^host_ip\s*:\s*['"]?([^'"\s]+)/); if (h) item.hostIp = h[1];
      }
    }
    if (!opts.allowHostNetwork && /^network_mode\s*:\s*['"]?host/.test(l)) add(n, 'network_mode: host shares the host network');
    if (/docker\.sock/.test(l)) add(n, 'Docker socket referenced');
    if (/api\.insecure|--api=true|--api\.dashboard=true/.test(l)) add(n, 'Traefik API/dashboard enabled');
    if (/exposedbydefault\s*[=:]\s*true/i.test(l)) add(n, 'exposedByDefault true');
    if (/^image\s*:.*(:latest|[^:\s]+)\s*$/.test(l) && !/[:@]/.test(l.replace(/^image\s*:\s*/, ''))) add(n, 'unpinned image (no tag)');
    else if (/^image\s*:.*:latest\b/.test(l)) add(n, 'image uses :latest');
  });
  flush();
  return out;
}
