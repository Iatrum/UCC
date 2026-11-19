import type { LabReportSummary } from '@/lib/fhir/lab-constants';
import type { PendingPoctOrder } from '@/lib/fhir/lab-service';
import type { PendingXrayOrder } from '@/lib/fhir/imaging-service';

type Results = { reports: LabReportSummary[]; pending: PendingPoctOrder[]; xrayPending: PendingXrayOrder[]; poctEnabled: boolean; pacsEnabled: boolean };
/** 'denied' = 401/403 (session or clinic access gone, stale data must not stay on screen); 'failed' = anything else. */
export type LabLoadError = 'denied' | 'failed';
type Options = {
  patientId: string; encounterId?: string;
  /** Called only with a successful, well-formed response. `fetchedAt` is when it was received. */
  onResults: (data: Results, fetchedAt: number) => void;
  /** Called when a load fails. The caller decides what to keep; a failure is never an empty result. */
  onError: (error: LabLoadError) => void;
  onLoaded: () => void;
  /** Live (WebSocket) updates unavailable or dropped: the tab still polls, but staff should press Refresh. */
  onLiveStatus?: (live: boolean) => void;
};
export type LabResultUpdates = { stop: () => void; refresh: () => void };
type Outcome = 'ok' | 'disabled' | 'denied' | 'failed' | 'queued' | 'aborted';

/** Mounted only by the Lab tab. Notifications invalidate data; the gated API is authoritative. */
export function startLabResultUpdates({ patientId, encounterId, onResults, onError, onLoaded, onLiveStatus }: Options): LabResultUpdates {
  const abort = new AbortController();
  let allowed = false;
  let socket: WebSocket | undefined;
  let token: string | undefined;
  let connecting = false;
  // Task 659: 503 = subscription backend not configured. Stop re-trying every poll; the tab keeps polling results.
  // A manual refresh() clears it so staff can re-check.
  let liveUnavailable = false;
  let loading = false;
  let queued = false;
  let renewal: ReturnType<typeof setTimeout> | undefined;
  let handshake: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const endpoint = `/api/labs/results?${new URLSearchParams(encounterId ? { encounterId } : { patientId })}`;

  const setLive = (live: boolean) => { if (!abort.signal.aborted) onLiveStatus?.(live); };

  const disconnect = (quiet = false) => {
    clearTimeout(renewal);
    clearTimeout(handshake);
    clearInterval(ping);
    if (socket?.readyState === WebSocket.OPEN && token) {
      socket.send(JSON.stringify({ type: 'unbind-from-token', payload: { token } }));
    }
    socket?.close();
    socket = undefined;
    token = undefined;
    if (!quiet) setLive(false);
  };

  const stopPoll = () => { clearInterval(poll); poll = undefined; };
  // Also rechecks the kill switch while connected and covers dropped/missed socket events.
  // It keeps running after a failed load so the tab recovers by itself when the API returns.
  const startPoll = () => {
    if (poll || abort.signal.aborted) return;
    poll = setInterval(() => { void load().then(afterLoad); }, 30_000);
  };
  const afterLoad = (outcome: Outcome) => {
    if (abort.signal.aborted) return;
    if (outcome === 'ok') { startPoll(); void connect(); }
    else if (outcome === 'failed') startPoll();
  };

  const load = async (): Promise<Outcome> => {
    if (abort.signal.aborted) return 'aborted';
    if (loading) { queued = true; return 'queued'; }
    loading = true;
    try {
      const response = await fetch(endpoint, { signal: abort.signal, cache: 'no-store' });
      if (abort.signal.aborted) return 'aborted';
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          allowed = false;
          disconnect();
          stopPoll();
          onError('denied');
          return 'denied';
        }
        onError('failed');
        return 'failed';
      }
      const data: Results = await response.json();
      if (abort.signal.aborted) return 'aborted';
      if (!data || !Array.isArray(data.reports)) throw new Error('Malformed lab results response');
      allowed = data.poctEnabled === true || data.pacsEnabled === true;
      onResults(data, Date.now());
      if (!allowed) { disconnect(true); stopPoll(); return 'disabled'; }
      return 'ok';
    } catch {
      // Keep the last successful results during a transient outage, but surface the failure.
      if (abort.signal.aborted) return 'aborted';
      onError('failed');
      return 'failed';
    }
    finally {
      loading = false;
      if (!abort.signal.aborted) onLoaded();
      if (queued) { queued = false; void load().then(afterLoad); }
    }
  };

  const connect = async () => {
    if (!allowed || liveUnavailable || connecting || socket || abort.signal.aborted) return;
    connecting = true;
    try {
      const response = await fetch('/api/labs/subscription', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, encounterId }), signal: abort.signal, cache: 'no-store',
      });
      if (!response.ok) {
        setLive(false);
        if (response.status === 503) liveUnavailable = true;
        if (response.status === 403) await load();
        return;
      }
      const binding = await response.json();
      if (abort.signal.aborted || !allowed) return;
      if (typeof binding.token !== 'string' || typeof binding.subscriptionId !== 'string' ||
        typeof binding.expiresAt !== 'number' || binding.expiresAt <= Date.now()) { setLive(false); return; }
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
          if (status.type === 'handshake') { clearTimeout(handshake); setLive(true); }
          if (status.type === 'handshake' || status.type === 'event-notification') void load();
        } catch { /* Ignore malformed or unrelated frames, never display socket payloads. */ }
      };
      ws.onerror = () => { if (socket === ws) disconnect(); };
      ws.onclose = () => { if (socket === ws) disconnect(); };
      handshake = setTimeout(() => { if (socket === ws) disconnect(); }, 10_000);
      renewal = setTimeout(() => { disconnect(true); void connect(); }, Math.max(1000, binding.expiresAt - Date.now() - 15_000));
    } catch { disconnect(); }
    finally { connecting = false; }
  };

  void load().then(afterLoad);
  return {
    stop: () => { abort.abort(); stopPoll(); disconnect(); },
    // Manual Retry/Refresh. Also restarts polling after a 401/403 or a kill-switch pause.
    refresh: () => { liveUnavailable = false; void load().then(afterLoad); },
  };
}
