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

interface BillingTableProps {
  consultations: BillableConsultation[];
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

export default function BillingTable({ consultations }: BillingTableProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    if (!searchQuery) return consultations;
    const q = searchQuery.toLowerCase();
    return consultations.filter(
      (c) => c.patientFullName && c.patientFullName.toLowerCase().includes(q)
    );
  }, [consultations, searchQuery]);

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
                  </TableCell>
                  <TableCell>{formatDisplayDate(consultation.date)}</TableCell>
                  <TableCell>{getStatusBadge(consultation.queueStatus)}</TableCell>
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
