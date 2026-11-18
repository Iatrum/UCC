import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { auditComposeText, auditDockerPs, auditListeners, auditNmapGreppable } from '../../scripts/staging/lib/exposure';

test('docker ps: only loopback or 80/443 pass', () => {
  const ok = 'traefik\t0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, :::443->443/tcp\nmedplum-pg\t5432/tcp\ndev\t127.0.0.1:8113->8103/tcp, [::1]:8113->8103/tcp';
  expect(auditDockerPs(ok)).toEqual([]);
  const bad = auditDockerPs('NAMES\tPORTS\nweb\t0.0.0.0:5432->5432/tcp\nui\t0.0.0.0:3000->3000/tcp\nudp\t0.0.0.0:443->443/udp\nv6\t[::]:6379->6379/tcp');
  expect(bad.map((f) => f.where)).toEqual(['web', 'ui', 'udp', 'v6']);
});

test('ss listeners', () => {
  const out = [
    'Netid State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'tcp   LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*',
    'tcp   LISTEN 0 4096 [::]:443 [::]:*',
    'tcp   LISTEN 0 4096 127.0.0.1:8113 0.0.0.0:*',
    'udp   UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:*',
    'tcp   LISTEN 0 511 *:8080 *:*',
    'udp   UNCONN 0 0 0.0.0.0:443 0.0.0.0:*',
  ].join('\n');
  expect(auditListeners(out).map((f) => f.where)).toEqual(['tcp *:8080', 'udp 0.0.0.0:443']);
});

test('nmap greppable: unexpected open ports and empty input fail', () => {
  const g = 'Host: 203.0.113.9 ()\tPorts: 22/open/tcp//ssh///, 80/open/tcp//http///, 5432/open/tcp//postgresql///, 6379/filtered/tcp//redis///\t';
  const f = auditNmapGreppable(g);
  expect(f).toHaveLength(1);
  expect(f[0].problem).toContain('5432');
  expect(auditNmapGreppable('')).toHaveLength(1);
});

test('compose: flags bare/ephemeral/interpolated/long-form ports, socket, host net, latest', () => {
  const bad = `services:
  a:
    image: foo:latest
    network_mode: host
    ports:
      - "5432:5432"
      - 3000
      - "\${BIND}:80:80"
      - "[::]:81:81"
      - "[::1]:82:82"
      - "127.0.0.1:83:83/tcp"
      - target: 90
        published: "90"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
  b:
    image: bar
    ports:
      - target: 91
        published: "91"
        host_ip: 127.0.0.1
`;
  const f = auditComposeText('c.yml', bad).map((x) => x.problem);
  expect(f.filter((p) => p.includes('no host IP'))).toHaveLength(2);
  expect(f.some((p) => p.includes('interpolation'))).toBe(true);
  expect(f.some((p) => p.includes('binds [::]'))).toBe(true);
  expect(f.filter((p) => p.includes('long-form'))).toHaveLength(1);
  expect(f.some((p) => p.includes('network_mode'))).toBe(true);
  expect(f.some((p) => p.includes('Docker socket'))).toBe(true);
  expect(f.some((p) => p.includes(':latest'))).toBe(true);
  expect(f.some((p) => p.includes('unpinned'))).toBe(true);
  expect(f).toHaveLength(9);
});

test('the repo staging/PACS compose files pass their own audit', () => {
  for (const p of ['infra/staging/docker-compose.yml', 'infra/staging/rehearsal/docker-compose.yml', 'infra/pacs-dev/docker-compose.yml']) {
    // PACS OHIF uses host networking on purpose (binds 127.0.0.1:3320 and the pacs bridge only).
    expect(auditComposeText(p, readFileSync(p, 'utf8'), { allowHostNetwork: p.includes('pacs-dev') })).toEqual([]);
  }
  expect(auditComposeText('p', readFileSync('infra/pacs-dev/docker-compose.yml', 'utf8')).map((f) => f.problem)).toEqual(['network_mode: host shares the host network']);
});
