import { setTimeout as delay } from 'node:timers/promises';

if (!(globalThis as any).WebSocket) (globalThis as any).WebSocket = class {};

// Fixture/service calls share the dev Medplum quota with browser API calls. Respect its
// documented cooldown; do not retry UCC responses (including the auth/security tests).
if (!(globalThis as any).__uccE2ELocalRateRetry) {
  (globalThis as any).__uccE2ELocalRateRetry = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const value = input instanceof Request ? input.url : String(input);
    let local = false;
    try {
      const url = new URL(value);
      local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '8113';
    } catch {}
    if (!local) return nativeFetch(input, init);
    const template = input instanceof Request ? input.clone() : input;
    for (let attempt = 0; ; attempt++) {
      const response = await nativeFetch(template instanceof Request ? template.clone() : template, init);
      if (response.status !== 429 || attempt >= 2) return response;
      const retryAfter = Number(response.headers.get('retry-after'));
      const resets = Array.from((response.headers.get('ratelimit') || '').matchAll(/(?:^|[;,])\s*t\s*=\s*(\d+)/g), match => Number(match[1]));
      const seconds = Math.min(600, Math.max(1, retryAfter || 0, ...resets, resets.length || retryAfter ? 0 : 60)) + 1;
      await response.body?.cancel();
      await delay(seconds * 1000, undefined, { signal: init?.signal ?? (input instanceof Request ? input.signal : undefined) });
    }
  }) as typeof fetch;
}
