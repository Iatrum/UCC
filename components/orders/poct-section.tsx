"use client";

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { POCT_TESTS, type PoctAnalyser } from '@/lib/fhir/lab-constants';
import type { PoctEntryMeta, TreatmentPlanEntry } from '@/lib/treatment-plan';

export function PoctSection({ entries, query, onAdd }: {
  entries: TreatmentPlanEntry[];
  query: string;
  onAdd: (item: { id: string; name: string; unitPrice: number; meta: PoctEntryMeta }) => Promise<void>;
}) {
  const [analysers, setAnalysers] = React.useState<PoctAnalyser[]>([]);
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
        const response = await fetch('/api/poct/analysers', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Unable to load analysers');
        const data = await response.json();
        if (!controller.signal.aborted) { setAnalysers(data.analysers); setError(false); }
      } catch {
        if (!controller.signal.aborted) { setAnalysers([]); setError(true); }
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 15_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, []);

  async function add(test: typeof POCT_TESTS[number], device: PoctAnalyser) {
    setAdding(true);
    try {
      // Recheck at click time as well as during periodic status refresh.
      const response = await fetch('/api/poct/analysers', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setAnalysers(data.analysers);
      if (!data.analysers.some((a: PoctAnalyser) => a.id === device.id && a.online && a.analyserType === test.analyserType)) return;
      await onAdd({ id: `poct:${test.code}`, name: test.name, unitPrice: test.unitPrice,
        meta: { kind: 'poct', code: test.code, system: test.system, analyserId: device.id, analyserName: device.name } });
    } catch { setAnalysers([]); setError(true); }
    finally { setAdding(false); }
  }

  return <section aria-label="POCT" className="space-y-2 rounded-md border p-3">
    <div className="flex flex-wrap justify-between gap-1"><h3 className="text-sm font-medium">POCT</h3><span className="text-xs text-muted-foreground">Results appear in Labs &amp; Imaging</span></div>
    {error && <p role="status" className="text-xs text-muted-foreground">Unable to load analysers. Ordering is unavailable.</p>}
    {POCT_TESTS.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase())).map((test) => {
      const matching = analysers.filter((a) => a.analyserType === test.analyserType);
      const device = matching.find((a) => a.online) || matching[0];
      const added = entries.some((e) => e.meta?.kind === 'poct' && e.meta.code === test.code);
      return <div key={test.code} data-testid={`poct-${test.code}`} className="flex flex-wrap items-center gap-2 rounded border px-2 py-2 text-xs">
        <span className="min-w-24 flex-1 font-medium">{test.name}</span>
        <span className="max-w-32 truncate text-muted-foreground">{device?.name || 'No analyser'}</span>
        <span className={device?.online ? 'text-green-700' : 'text-muted-foreground'}>{loading ? 'Checking…' : device?.online ? 'Online' : 'Offline'}</span>
        <span>RM {test.unitPrice.toFixed(2)}</span>
        <Button type="button" size="sm" variant="outline" disabled={loading || adding || !device?.online || added} onClick={() => device && void add(test, device)} aria-label={`Add POCT ${test.name}`}>{added ? 'Added' : '+ Add'}</Button>
      </div>;
    })}
    <p className="text-[11px] text-muted-foreground">Only online, connected analysers can be ordered. No manual results.</p>
  </section>;
}
