'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

interface BillingTableProps {
  consultations: BillableConsultation[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void | Promise<void>;
}

function getStatusBadge(status: QueueStatus | undefined | string) {
  switch (status) {
    case 'meds_and_bills':
      return <Badge variant="secondary" className="bg-yellow-400 text-zinc-900 hover:bg-yellow-500">Meds & Bills</Badge>;
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

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-sm text-muted-foreground">
        Loading billable consultations...
      </div>
    );
  }

  if (error) {
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
              <TableHead>Consultation Date</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length > 0 ? (
              filtered.map((consultation) => (
                <TableRow key={consultation.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/orders/checkout/${consultation.id}?patientId=${consultation.patientId}`}
                      className="text-primary hover:underline"
                    >
                      {consultation.patientFullName || 'N/A'}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDisplayDate(consultation.date)}</TableCell>
                  <TableCell>{getStatusBadge(consultation.queueStatus)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-4">
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
