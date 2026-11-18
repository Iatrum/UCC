import { describe, expect, it } from "bun:test";
import { fetchWithTimeout } from "../../lib/fetch-with-timeout";

const enc = new TextEncoder();

/** Headers arrive immediately; the body sends `first` then stalls forever (ignores the signal). */
function stalledFetch(first: string | null, calls: RequestInit[] = []): typeof fetch {
  return (async (_u: string, init: RequestInit) => {
    calls.push(init);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        if (first !== null) c.enqueue(enc.encode(first));
      },
      pull() {
        return new Promise(() => {});
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const okFetch = ((_u: string, _i: RequestInit) =>
  Promise.resolve(new Response('{"a":1}', { status: 200 }))) as unknown as typeof fetch;

describe("fetchWithTimeout body timeout (Task 653)", () => {
  it("GET: a stalled body rejects json() with an AbortError instead of hanging", async () => {
    const res = await fetchWithTimeout("/x", {}, 30, stalledFetch('{"a":'));
    expect(res.status).toBe(200);
    const err = await res.json().then(() => null, (e) => e);
    expect(err).toBeTruthy();
    expect((err as Error).name).toBe("AbortError");
  });

  it("GET: a body that stalls before any byte also rejects", async () => {
    const res = await fetchWithTimeout("/x", { method: "GET" }, 30, stalledFetch(null));
    await expect(res.text()).rejects.toBeTruthy();
  });

  it("GET: a body that completes in time is returned intact, status/headers/url preserved", async () => {
    const f = (async () => {
      const r = new Response('{"a":1}', { status: 201, statusText: "Created", headers: { "x-t": "1" } });
      Object.defineProperty(r, "url", { value: "http://h/x" });
      return r;
    }) as unknown as typeof fetch;
    const res = await fetchWithTimeout("/x", {}, 200, f);
    expect(res.status).toBe(201);
    expect(res.headers.get("x-t")).toBe("1");
    expect(res.url).toBe("http://h/x");
    expect(await res.json()).toEqual({ a: 1 });
    await new Promise((r) => setTimeout(r, 250)); // timer must be cleared: no late abort/unhandled error
  });

  it("GET: timer is cleared once the body is read (late abort does nothing)", async () => {
    let signal: AbortSignal | undefined;
    const f = (async (_u: string, init: RequestInit) => {
      signal = init.signal!;
      return new Response('{"a":1}');
    }) as unknown as typeof fetch;
    const res = await fetchWithTimeout("/x", {}, 40, f);
    await res.json();
    await new Promise((r) => setTimeout(r, 80));
    expect(signal!.aborted).toBe(false);
  });

  it("GET: header stall still aborts (existing behaviour)", async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new Error("abort"))))) as unknown as typeof fetch;
    await expect(fetchWithTimeout("/x", {}, 20, hang)).rejects.toThrow("abort");
  });

  it("POST/PATCH: body is not wrapped and not aborted after headers arrive", async () => {
    for (const method of ["POST", "PATCH", "post"]) {
      const calls: RequestInit[] = [];
      const res = await fetchWithTimeout("/w", { method }, 20, stalledFetch('{"a":', calls));
      await new Promise((r) => setTimeout(r, 60));
      expect(calls[0].signal!.aborted).toBe(false); // timer cleared once headers arrived
      const reader = res.body!.getReader();
      expect((await reader.read()).done).toBe(false); // first chunk still readable, no abort error
    }
  });

  it("passes through responses with no body and plain ok responses", async () => {
    const empty = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    expect((await fetchWithTimeout("/x", {}, 20, empty)).status).toBe(204);
    expect(await (await fetchWithTimeout("/x", {}, 20, okFetch)).json()).toEqual({ a: 1 });
  });
});
