'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDisplayDate } from '@/lib/utils';
import { BillableConsultation, QueueStatus } from '@/lib/types';
import { resolveLoadView, showStaleBanner } from '@/lib/load-state';

interface BillingTableProps {
  consultations: BillableConsultation[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void | Promise<void>;
}

function getStatusBadge(status: QueueStatus | undefined | string) {
  switch (status) {
    case 'meds_and_bills':
      return <Badge variant="secondary" className="bg-yellow-400 text-zinc-900 hover:bg-yellow-500">Ready to bill</Badge>;
    case 'completed':
      return <Badge variant="outline">Completed</Badge>;
    default:
      return <Badge variant="secondary">{status || 'Unknown'}</Badge>;
  }
}

export default function BillingTable({ consultations, loading, error, onRetry }: BillingTableProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    if (!searchQuery) return consultations;
    const q = searchQuery.toLowerCase();
    return consultations.filter(
      (c) => c.patientFullName && c.patientFullName.toLowerCase().includes(q)
    );
  }, [consultations, searchQuery]);

  const view = resolveLoadView({ loading: Boolean(loading), error: error ?? null, hasData: consultations.length > 0 });
  const staleBanner = showStaleBanner({ error: error ?? null, hasData: consultations.length > 0 });

  if (view === 'loading') {
    return (
      <div role="status" aria-live="polite" className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-sm text-muted-foreground">
        Loading billable consultations...
      </div>
    );
  }

  if (view === 'error') {
    return (
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-800">
        <p>{error}</p>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={() => void onRetry()}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {staleBanner ? (
        <div role="status" aria-live="polite" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <span>{error} Showing the last loaded list.</span>
          {onRetry ? (
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void onRetry()}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="relative w-full mb-4">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by patient name..."
          className="pl-9 pr-4 py-2 w-full rounded-md border border-input bg-transparent"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="relative border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient Name</TableHead>
              <TableHead className="hidden sm:table-cell">Consultation Date</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length > 0 ? (
              filtered.map((consultation) => (
                <TableRow
                  key={consultation.id}
                  className="relative cursor-pointer focus-within:bg-muted/50"
                >
                  <TableCell className="font-medium">
                    <Link
                      href={`/orders/checkout/${consultation.id}?patientId=${consultation.patientId}`}
                      className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm after:absolute after:inset-0 after:content-['']"
                    >
                      {consultation.patientFullName || 'N/A'}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal text-muted-foreground sm:hidden">
                      <span>{formatDisplayDate(consultation.date)}</span>
                      {getStatusBadge(consultation.queueStatus)}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{formatDisplayDate(consultation.date)}</TableCell>
                  <TableCell className="hidden sm:table-cell">{getStatusBadge(consultation.queueStatus)}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline" className="relative z-10">
                      <Link
                        href={`/orders/checkout/${consultation.id}?patientId=${consultation.patientId}`}
                        aria-label={`Open checkout for ${consultation.patientFullName || 'patient'}`}
                      >
                        Open checkout
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-4">
                  No billable consultations found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
