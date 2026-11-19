import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchWithTimeout } from '../../lib/fetch-with-timeout';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QueueState from '../../components/dashboard/queue-state';
import { loadQueueOnce } from '../../lib/dashboard/queue-load';

const noop = () => {};
const render = (p: { loading: boolean; loaded: boolean; error: string | null }) =>
  renderToStaticMarkup(createElement(QueueState, { ...p, onRetry: noop }, createElement('p', null, 'QUEUE-ROWS')));
const res = (status: number, body: unknown = {}) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('Task 480 queue loading -> loaded / error -> retry', () => {
  test('session resolving or fetching shows Loading queue...', () => {
    const html = render({ loading: true, loaded: false, error: null });
    expect(html).toContain('Loading queue...');
    expect(html).not.toContain('QUEUE-ROWS');
  });
  test('loaded shows rows; refetch keeps previous list', () => {
    expect(render({ loading: false, loaded: true, error: null })).toContain('QUEUE-ROWS');
    expect(render({ loading: true, loaded: true, error: null })).toContain('QUEUE-ROWS');
  });
  test('error shows message and Retry, not an endless spinner', () => {
    const html = render({ loading: false, loaded: false, error: 'Failed to load queue data.' });
    expect(html).toContain('Failed to load queue data.');
    expect(html).toContain('Retry');
    expect(html).not.toContain('Loading queue...');
  });
  test('loadQueueOnce: success, 401 (session not ready), 500, network, timeout, abort', async () => {
    const ok = await loadQueueOnce(res(200, { patients: [{ id: 'p1' }] }), new AbortController());
    expect(ok).toEqual({ ok: true, patients: [{ id: 'p1' }] } as never);
    expect(await loadQueueOnce(res(401), new AbortController())).toMatchObject({ ok: false, kind: 'unauthorized' });
    expect(await loadQueueOnce(res(500), new AbortController())).toMatchObject({ ok: false, kind: 'http' });
    const boom = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    expect(await loadQueueOnce(boom, new AbortController())).toMatchObject({ ok: false, kind: 'network' });
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new Error('abort'))))) as unknown as typeof fetch;
    expect(await loadQueueOnce(hang, new AbortController(), 20)).toMatchObject({ ok: false, kind: 'timeout' });
    const c = new AbortController();
    const p = loadQueueOnce(hang, c, 5000);
    c.abort();
    expect(await p).toMatchObject({ ok: false, kind: 'aborted' });
  });
  test('retry after error recovers', async () => {
    let n = 0;
    const flaky = (async () => (n++ === 0 ? new Response('', { status: 401 }) : new Response(JSON.stringify({ patients: [] }), { status: 200 }))) as unknown as typeof fetch;
    expect((await loadQueueOnce(flaky, new AbortController())).ok).toBe(false);
    expect((await loadQueueOnce(flaky, new AbortController())).ok).toBe(true);
  });
});

describe('Review 481 follow-ups', () => {
  test('fetchWithTimeout aborts a hung auth request so the spinner falls through', async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new Error('abort'))))) as unknown as typeof fetch;
    await expect(fetchWithTimeout('/api/auth/me', {}, 20, hang)).rejects.toThrow('abort');
    expect((await fetchWithTimeout('/x', {}, 20, res(200))).status).toBe(200);
  });
  test('auth provider uses the timeout for both dashboard auth requests', () => {
    const src = readFileSync(join(__dirname, '../../lib/auth-medplum.tsx'), 'utf8');
    expect(src).toContain("fetchWithTimeout('/api/auth/medplum-session'");
    expect(src).toContain("fetchWithTimeout('/api/auth/me'");
  });
  test('dashboard session-ready gate: queue fetch waits for auth and spinner covers it', () => {
    const src = readFileSync(join(__dirname, '../../app/(routes)/dashboard/dashboard-client.tsx'), 'utf8');
    expect(src).toContain('const authReady = !authLoading;');
    expect(src).toMatch(/if \(!authReady\) return;[\s\S]{0,200}void loadQueue\(\)/);
    expect(src).toContain('}, [authReady,');
    expect(src).toContain('loading={loading || !authReady}');
  });
});
