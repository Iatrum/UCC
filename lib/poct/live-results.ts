import type { LabReportSummary } from '@/lib/fhir/lab-constants';
import type { PendingPoctOrder } from '@/lib/fhir/lab-service';

type Results = { reports: LabReportSummary[]; pending: PendingPoctOrder[]; poctEnabled: boolean };
type Options = { patientId: string; encounterId?: string; onResults: (data: Results) => void; onLoaded: () => void };

/** Mounted only by the Lab tab. Notifications invalidate data; the gated API is authoritative. */
export function startLabResultUpdates({ patientId, encounterId, onResults, onLoaded }: Options): () => void {
  const abort = new AbortController();
  let allowed = false;
  let socket: WebSocket | undefined;
  let token: string | undefined;
  let connecting = false;
  let loading = false;
  let queued = false;
  let renewal: ReturnType<typeof setTimeout> | undefined;
  let handshake: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const endpoint = `/api/labs/results?${new URLSearchParams(encounterId ? { encounterId } : { patientId })}`;

  const disconnect = () => {
    clearTimeout(renewal);
    clearTimeout(handshake);
    clearInterval(ping);
    if (socket?.readyState === WebSocket.OPEN && token) {
      socket.send(JSON.stringify({ type: 'unbind-from-token', payload: { token } }));
    }
    socket?.close();
    socket = undefined;
    token = undefined;
  };

  const load = async () => {
    if (abort.signal.aborted) return;
    if (loading) { queued = true; return; }
    loading = true;
    try {
      const response = await fetch(endpoint, { signal: abort.signal, cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          allowed = false;
          disconnect();
          clearInterval(poll);
          onResults({ reports: [], pending: [], poctEnabled: false });
        }
        return;
      }
      const data: Results = await response.json();
      if (abort.signal.aborted) return;
      allowed = data.poctEnabled === true;
      onResults(data);
      if (!allowed) { disconnect(); clearInterval(poll); }
    } catch { /* Keep the last successful results during a transient outage. */ }
    finally {
      loading = false;
      if (!abort.signal.aborted) onLoaded();
      if (queued) { queued = false; void load(); }
    }
  };

  const connect = async () => {
    if (!allowed || connecting || socket || abort.signal.aborted) return;
    connecting = true;
    try {
      const response = await fetch('/api/labs/subscription', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, encounterId }), signal: abort.signal, cache: 'no-store',
      });
      if (!response.ok) { if (response.status === 403) await load(); return; }
      const binding = await response.json();
      if (abort.signal.aborted || !allowed) return;
      if (typeof binding.token !== 'string' || typeof binding.subscriptionId !== 'string' ||
        typeof binding.expiresAt !== 'number' || binding.expiresAt <= Date.now()) return;
      token = binding.token;
      const ws = new WebSocket(binding.url);
      socket = ws;
      ws.onopen = () => {
        if (abort.signal.aborted || socket !== ws) { ws.close(); return; }
        ws.send(JSON.stringify({ type: 'bind-with-token', payload: { token } }));
        ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' })); }, 20_000);
      };
      ws.onmessage = (event) => {
        if (socket !== ws || abort.signal.aborted) return;
        try {
          const bundle = JSON.parse(event.data);
          const status = bundle.entry?.[0]?.resource;
          if (status?.subscription?.reference !== `Subscription/${binding.subscriptionId}`) return;
          if (status.type === 'handshake') clearTimeout(handshake);
          if (status.type === 'handshake' || status.type === 'event-notification') void load();
        } catch { /* Ignore malformed or unrelated frames, never display socket payloads. */ }
      };
      ws.onerror = () => { if (socket === ws) disconnect(); };
      ws.onclose = () => { if (socket === ws) disconnect(); };
      handshake = setTimeout(() => { if (socket === ws) disconnect(); }, 10_000);
      renewal = setTimeout(() => { disconnect(); void connect(); }, Math.max(1000, binding.expiresAt - Date.now() - 15_000));
    } catch { disconnect(); }
    finally { connecting = false; }
  };

  void load().then(() => {
    if (!allowed || abort.signal.aborted) return;
    void connect();
    // Also rechecks the kill switch while connected. Covers dropped/missed socket events.
    poll = setInterval(() => { void load().then(() => { void connect(); }); }, 30_000);
  });
  return () => { abort.abort(); clearInterval(poll); disconnect(); };
}
