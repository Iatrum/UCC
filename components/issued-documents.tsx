"use client";

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type IssuedDocument = { id: string; title: string; date: string; status: string; encounter: string };

export function IssuedDocuments({ patientId, refreshKey }: { patientId: string; refreshKey: string }) {
  const [documents, setDocuments] = useState<IssuedDocument[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<IssuedDocument | null>(null);
  const [html, setHtml] = useState('');
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setDocuments([]);
    setSelected(null);
    setError('');
    fetch(`/api/issued-documents?patientId=${encodeURIComponent(patientId)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async r => { if (!r.ok) throw new Error('Could not load issued documents'); return r.json(); })
      .then(data => setDocuments(data.documents || []))
      .catch(() => { if (!controller.signal.aborted) setError('Could not load issued documents'); });
    return () => controller.abort();
  }, [patientId, refreshKey, retry]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setHtml('');
    setReady(false);
    fetch(`/api/issued-documents?id=${encodeURIComponent(selected.id)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async r => { if (!r.ok) throw new Error('Could not load issued document'); return r.text(); })
      .then(setHtml)
      .catch(() => { if (!controller.signal.aborted) setError('Could not load issued document'); });
    return () => controller.abort();
  }, [selected]);
  return <div className="space-y-3">
    {error && <p role="alert">{error} <Button type="button" variant="outline" onClick={() => { setSelected(null); setRetry(n => n + 1); }}>Retry</Button></p>}
    {documents.map(doc => <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div><p className="font-medium">{doc.title}</p><p className="text-sm text-muted-foreground">Issued · {doc.date.slice(0, 10)}</p></div>
      <Button type="button" variant="outline" onClick={() => { setError(''); setSelected(doc); }}>View / reprint</Button>
    </div>)}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader><DialogTitle>{selected?.title} — issued copy</DialogTitle></DialogHeader>
        {html ? <iframe ref={frame} title="Issued document" srcDoc={html} sandbox="allow-same-origin allow-modals" onLoad={() => setReady(true)} className="h-[65vh] w-full border" /> : <p>{error || 'Loading document…'}</p>}
        <Button type="button" disabled={!ready} onClick={() => frame.current?.contentWindow?.print()}>Print</Button>
      </DialogContent>
    </Dialog>
  </div>;
}
