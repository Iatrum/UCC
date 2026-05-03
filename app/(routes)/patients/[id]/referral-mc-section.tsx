"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { PDFViewer, pdf } from "@react-pdf/renderer";
import { Download, FileText, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { getPatientReferrals, deleteReferral, type Referral } from "@/lib/fhir/referral-client";
import ReferralDocument from "@/components/referrals/referral-document";
import { fetchOrganizationDetails, type OrganizationDetails } from "@/lib/org";

function formatDateLabel(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, "dd MMM yyyy");
}

interface ReferralMCSectionProps {
  patient: any;
}

export default function ReferralMCSection({ patient }: ReferralMCSectionProps) {
  const { toast } = useToast();
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<Referral | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [organization, setOrganization] = useState<OrganizationDetails | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await getPatientReferrals(patient.id);
        if (!active) return;
        setReferrals(list as any);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [patient.id]);

  useEffect(() => {
    let active = true;
    (async () => {
      const orgDetails = await fetchOrganizationDetails();
      if (!active) return;
      setOrganization(orgDetails);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleDelete(referralId: string) {
    setDeleting(referralId);
    try {
      await deleteReferral(referralId);
      setReferrals((prev) => prev.filter((r) => r.id !== referralId));
      toast({ title: "Document deleted" });
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Failed to delete document.", variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Patient Documents</CardTitle>
          <CardDescription>Saved MCs, referral letters, and other patient documents.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading documents…
            </div>
          )}
          {!loading && referrals.length === 0 && (
            <p className="text-sm text-muted-foreground">No saved documents.</p>
          )}
          {referrals.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{r.specialty} Referral</p>
                  <p className="text-sm text-muted-foreground">
                    {[r.facility, r.department].filter(Boolean).join(" • ")}
                    {r.date ? ` — ${format(new Date(r.date), "dd MMM yyyy")}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setViewing(r)}>
                  View
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleting === r.id}
                  onClick={() => handleDelete(r.id)}
                >
                  {deleting === r.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 text-destructive" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="w-[95vw] overflow-hidden p-0 sm:max-w-5xl">
          <div className="flex h-[90vh] flex-col">
            <DialogHeader className="space-y-2 border-b px-6 py-4">
              <DialogTitle>Referral Letter</DialogTitle>
              <DialogDescription>{viewing ? `${viewing.specialty} — ${viewing.facility}` : ""}</DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 px-6 py-4">
              {viewing && (
                <div className="flex h-full flex-col gap-4">
                  <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
                    <PDFViewer className="h-full w-full">
                      <ReferralDocument
                        letterText={(viewing as any).letterText || ""}
                        organization={organization}
                        metadata={{
                          dateLabel: viewing.date ? format(new Date(viewing.date), "dd MMM yyyy") : null,
                          patientName: patient.fullName,
                          patientId: patient.nric,
                          patientDateOfBirth: formatDateLabel(patient.dateOfBirth),
                          patientPhone: patient.phone ?? null,
                          patientEmail: patient.email ?? null,
                          specialty: viewing.specialty,
                          facility: viewing.facility,
                          department: viewing.department ?? null,
                          doctorName: viewing.doctorName ?? null,
                          toLine: [viewing.department, viewing.facility].filter(Boolean).join(", ") || null,
                          fromLine: organization?.name ?? null,
                        }}
                      />
                    </PDFViewer>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t px-6 py-4">
              <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
              <Button
                onClick={async () => {
                  if (!viewing) return;
                  const blob = await pdf(
                    <ReferralDocument
                      letterText={(viewing as any).letterText || ""}
                      organization={organization}
                      metadata={{
                        dateLabel: viewing.date ? format(new Date(viewing.date), "dd MMM yyyy") : null,
                        patientName: patient.fullName,
                        patientId: patient.nric,
                        patientDateOfBirth: formatDateLabel(patient.dateOfBirth),
                        patientPhone: patient.phone ?? null,
                        patientEmail: patient.email ?? null,
                        specialty: viewing.specialty,
                        facility: viewing.facility,
                        department: viewing.department ?? null,
                        doctorName: viewing.doctorName ?? null,
                        toLine: [viewing.department, viewing.facility].filter(Boolean).join(", ") || null,
                        fromLine: organization?.name ?? null,
                      }}
                    />
                  ).toBlob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `referral-${patient.id}.pdf`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                disabled={!viewing}
              >
                <Download className="mr-2 h-4 w-4" /> Download PDF
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
