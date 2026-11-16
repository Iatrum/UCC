'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertCircle } from 'lucide-react';
import type { OpenXrayOrder, UnmatchedStudy } from '@/lib/pacs/study-ingest';

const REASONS: Record<string, string> = {
  'no-accession': 'No accession number on the study',
  'no-order': 'No X-ray order with this accession number',
  ambiguous: 'More than one order has this accession number',
  'order-closed': 'The order is cancelled or closed',
  'order-has-study': 'The order already has a study',
};

/**
 * Review list for studies the clinic PACS received without a matching X-ray order (X-ray phase 3).
 * Nothing here is attached automatically: staff pick the open X-ray order, or dismiss the entry.
 * Renders nothing when the list is empty or unavailable, so the PACS page is unchanged by default.
 */
export function UnmatchedStudiesCard() {
  const [studies, setStudies] = useState<UnmatchedStudy[]>([]);
  const [orders, setOrders] = useState<OpenXrayOrder[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/pacs/unmatched', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      setStudies(data.studies || []);
      setOrders(data.orders || []);
    } catch {
      // The list is an addition to the page: a failed load leaves the page as it was.
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => { void load(); });
  }, [load]);

  const act = async (id: string, action: 'attach' | 'dismiss') => {
    setError(null);
    setBusy(id);
    try {
      const response = await fetch('/api/pacs/unmatched', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, serviceRequestId: action === 'attach' ? choice[id] : undefined }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'The study could not be updated.');
      }
      await load();
    } catch {
      setError('The study could not be updated.');
    } finally {
      setBusy(null);
    }
  };

  if (studies.length === 0) return null;

  return (
    <Card aria-label="Unmatched imaging studies" data-testid="pacs-unmatched">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          Studies needing review
          <Badge variant="secondary">{studies.length}</Badge>
        </CardTitle>
        <CardDescription>
          Received from the X-ray device without a matching order. Check the patient before attaching: a study is never attached automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Study</TableHead>
              <TableHead>On the image</TableHead>
              <TableHead>Why</TableHead>
              <TableHead>Attach to open X-ray order</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {studies.map((study) => (
              <TableRow key={study.id} data-testid="pacs-unmatched-row">
                <TableCell>
                  <span className="font-medium">{study.description || 'Imaging study'}</span>
                  <span className="block text-xs text-muted-foreground">
                    {study.modality || '—'} • {study.numberOfInstances ?? 0} image{study.numberOfInstances === 1 ? '' : 's'}
                    {study.started ? ` • ${new Date(study.started).toLocaleString()}` : ''}
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  <span className="block">{study.dicomPatientName || 'No name'}</span>
                  <span className="block text-xs text-muted-foreground">
                    ID {study.dicomPatientId || '—'} • Accession # <span className="font-mono">{study.accessionNumber || '—'}</span>
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{REASONS[study.reason] || 'No matching order'}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Open X-ray order"
                      className="h-8 max-w-[18rem] rounded-md border bg-background px-2 text-sm"
                      value={choice[study.id] || ''}
                      onChange={(event) => setChoice((current) => ({ ...current, [study.id]: event.target.value }))}
                    >
                      <option value="">{orders.length ? 'Choose an order…' : 'No open X-ray orders'}</option>
                      {orders.map((order) => (
                        <option key={order.id} value={order.id}>
                          {[order.patientName, order.display, order.accessionNumber].filter(Boolean).join(' · ')}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" className="h-8" disabled={!choice[study.id] || busy === study.id} onClick={() => void act(study.id, 'attach')}>
                      Attach
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8" disabled={busy === study.id} onClick={() => void act(study.id, 'dismiss')}>
                      Dismiss
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
