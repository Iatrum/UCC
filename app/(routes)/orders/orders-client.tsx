'use client';

import { useState, useMemo } from 'react';
import { Consultation } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, MoreHorizontal } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDisplayDate } from "@/lib/utils";
import { BillableConsultation, QueueStatus } from '@/lib/types';
import dynamic from "next/dynamic";
const BillModal = dynamic(() => import("@/components/billing/bill-modal"), { ssr: false });
const McModal = dynamic(() => import("@/components/mc/mc-modal"), { ssr: false });

interface OrdersClientProps {
  initialConsultations: BillableConsultation[];
  otcContext?: {
    patientId: string;
    patientName?: string;
  };
}

export default function OrdersClient({ initialConsultations, otcContext }: OrdersClientProps) {
  const [consultations] = useState<BillableConsultation[]>(initialConsultations);
  const [searchQuery, setSearchQuery] = useState(otcContext?.patientName || "");
  const { toast } = useToast();

  // State for Bill Modal
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);
  const [currentBillData, setCurrentBillData] = useState<{ patient: Patient | null; consultation: Consultation | null } | null>(null);
  const [billLoading, setBillLoading] = useState(false);

  // State for MC Modal
  const [isMcModalOpen, setIsMcModalOpen] = useState(false);
  const [currentMcData, setCurrentMcData] = useState<{ patient: Patient | null; consultation: Consultation | null } | null>(null);
  const [mcLoading, setMcLoading] = useState(false);

  const filteredConsultations = useMemo(() => {
    if (!searchQuery) {
      return consultations;
    }
    const searchLower = searchQuery.toLowerCase();
    return consultations.filter((consultation) => {
      return (
        consultation.patientFullName &&
        consultation.patientFullName.toLowerCase().includes(searchLower)
      );
    });
  }, [consultations, searchQuery]);

  const fetchDetails = async (consultationId: string, patientId: string) => {
    const res = await fetch(`/api/orders?consultationId=${consultationId}&patientId=${patientId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch details');
    }
    const data = await res.json();
    return data;
  };

  const handleGenerate = async (consultationId: string, patientId: string, type: 'Bill' | 'MC' | 'Referral') => {
    const isBill = type === 'Bill';
    const setLoading = isBill ? setBillLoading : setMcLoading;
    const setCurrentData = isBill ? setCurrentBillData : setCurrentMcData;
    const setModalOpen = isBill ? setIsBillModalOpen : setIsMcModalOpen;

    if (type === 'Referral') {
      console.log(`Generating ${type} for consultation ${consultationId}, patient ${patientId}`);
      toast({ title: `Generating ${type}... (Not implemented)` });
      return;
    }

    setLoading(true);
    setCurrentData(null);
    setModalOpen(true);
    try {
      const { patient, consultation } = await fetchDetails(consultationId, patientId);
      if (!patient || !consultation) throw new Error('Failed to fetch details.');
      setCurrentData({ patient, consultation });
    } catch (err) {
      console.error(`Error fetching data for ${type}:`, err);
      toast({ title: `Error generating ${type}`, description: err instanceof Error ? err.message : 'Could not load details.', variant: 'destructive' });
      setModalOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: QueueStatus | undefined | string) => {
    switch (status) {
      case 'meds_and_bills':
        return <Badge variant="secondary" className="bg-yellow-400 text-zinc-900 hover:bg-yellow-500">Meds & Bills</Badge>;
      case 'completed':
        return <Badge variant="outline">Completed</Badge>;
      default:
        return <Badge variant="secondary">{status || 'Unknown'}</Badge>;
    }
  };

  return (
    <div className="space-y-6 container mx-auto py-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Billing & Documents</h1>
          <p className="text-muted-foreground">
            Generate bills, MCs, and referral letters for completed consultations.
          </p>
        </div>
      </div>

      {otcContext ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6">
            <p className="text-sm font-medium">OTC registration handoff received</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Patient {otcContext.patientName || otcContext.patientId} was sent from registration. Use search and complete billing actions for this patient.
            </p>
            <div className="mt-3">
              <Link href={`/patients/${otcContext.patientId}`} className="text-sm underline">
                Open patient profile
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Completed Consultations</CardTitle>
          <CardDescription>Select a consultation to generate documents.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative w-full mb-4">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by patient name..."
              className="pl-9 pr-4 py-2 w-full rounded-md border border-input bg-transparent"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="mt-6 relative border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Consultation Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredConsultations.length > 0 ? (
                  filteredConsultations.map((consultation) => (
                    <TableRow key={consultation.id}>
                      <TableCell className="font-medium">
                        <Link href={`/patients/${consultation.patientId}`} className="hover:underline">
                          {consultation.patientFullName || 'N/A'}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDisplayDate(consultation.date)}</TableCell>
                      <TableCell>{getStatusBadge(consultation.queueStatus)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleGenerate(consultation.id!, consultation.patientId, 'Bill')}>
                            Bill
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleGenerate(consultation.id!, consultation.patientId, 'MC')}>
                            MC
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleGenerate(consultation.id!, consultation.patientId, 'Referral')}>
                            Referral
                          </Button>
                        </div>
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
        </CardContent>
      </Card>

      <BillModal
        isOpen={isBillModalOpen}
        onClose={() => setIsBillModalOpen(false)}
        isLoading={billLoading}
        data={currentBillData}
      />

      <McModal
        isOpen={isMcModalOpen}
        onClose={() => setIsMcModalOpen(false)}
        isLoading={mcLoading}
        data={currentMcData}
      />
    </div>
  );
} 
