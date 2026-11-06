"use client";

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { XRAY_STUDIES } from '@/lib/fhir/imaging-constants';
import type { XrayEntryMeta, TreatmentPlanEntry } from '@/lib/treatment-plan';

type XrayDevice = { id: string; name: string; deviceType: string; online: boolean; lastHeartbeat?: string };

export function XraySection({ entries, query, onAdd }: {
  entries: TreatmentPlanEntry[];
  query: string;
  onAdd: (item: { id: string; name: string; unitPrice: number; meta: XrayEntryMeta }) => Promise<void>;
}) {
  const [devices, setDevices] = React.useState<XrayDevice[]>([]);
  const [error, setError] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  React.useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch('/api/pacs/devices', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Unable to load devices');
        const data = await response.json();
        if (!controller.signal.aborted) { setDevices(data.devices); setError(false); }
      } catch {
        if (!controller.signal.aborted) { setDevices([]); setError(true); }
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 15_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, []);

  async function add(study: typeof XRAY_STUDIES[number], device: XrayDevice) {
    setAdding(true);
    try {
      // Recheck at click time as well as during periodic status refresh.
      const response = await fetch('/api/pacs/devices', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setDevices(data.devices);
      if (!data.devices.some((d: XrayDevice) => d.id === device.id && d.online)) return;
      await onAdd({ id: `xray:${study.code}`, name: study.name, unitPrice: study.unitPrice,
        meta: { kind: 'xray', code: study.code, system: study.system, deviceId: device.id, deviceName: device.name } });
    } catch { setDevices([]); setError(true); }
    finally { setAdding(false); }
  }

  return <section aria-label="X-ray" className="space-y-2 rounded-md border p-3">
    <div className="flex flex-wrap justify-between gap-1"><h3 className="text-sm font-medium">X-ray</h3><span className="text-xs text-muted-foreground">Results appear in Labs &amp; Imaging</span></div>
    {error && <p role="status" className="text-xs text-muted-foreground">Unable to load devices. Ordering is unavailable.</p>}
    {XRAY_STUDIES.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())).map((study) => {
      const device = devices.find((d) => d.online) || devices[0];
      const added = entries.some((e) => e.meta?.kind === 'xray' && e.meta.code === study.code);
      return <div key={study.code} data-testid={`xray-${study.code}`} className="flex flex-wrap items-center gap-2 rounded border px-2 py-2 text-xs">
        <span className="min-w-24 flex-1 font-medium">{study.name}</span>
        <span className="max-w-32 truncate text-muted-foreground">{device?.name || 'No device'}</span>
        <span className={device?.online ? 'text-green-700' : 'text-muted-foreground'}>{loading ? 'Checking…' : device?.online ? 'Online' : 'Offline'}</span>
        <span>RM {study.unitPrice.toFixed(2)}</span>
        <Button type="button" size="sm" variant="outline" disabled={loading || adding || !device?.online || added} onClick={() => device && void add(study, device)} aria-label={`Add X-ray ${study.name}`}>{added ? 'Added' : '+ Add'}</Button>
      </div>;
    })}
    <p className="text-[11px] text-muted-foreground">Only online, connected devices can be ordered. No manual results.</p>
  </section>;
}
