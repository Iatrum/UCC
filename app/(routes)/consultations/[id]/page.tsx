export const dynamic = 'force-dynamic';

function decodeHtml(html: string): string {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMedplumForRequest } from '@/lib/server/medplum-auth';
import { getConsultationFromMedplum } from '@/lib/fhir/consultation-service';
import { resolveClinicIdFromServerScope } from '@/lib/server/clinic';
import { formatPrescriptionLine } from '@/lib/prescriptions';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function ConsultationDetails({ params }: Props) {
  const { id } = await params;

  // Require authentication — throws if no valid session cookie
  let medplum;
  try {
    medplum = await getMedplumForRequest();
  } catch {
    redirect('/login');
  }

  const clinicId = await resolveClinicIdFromServerScope();

  const consultation = await getConsultationFromMedplum(id, clinicId, medplum);

  if (!consultation) {
    return (
      <div className="container max-w-4xl py-6">
        <p className="text-muted-foreground">Consultation not found or access denied.</p>
      </div>
    );
  }

  const dateLabel = consultation.date instanceof Date
    ? consultation.date.toLocaleDateString()
    : consultation.date
      ? new Date(consultation.date).toLocaleDateString()
      : '—';

  return (
    <div className="container max-w-4xl py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" className="p-0" asChild>
          <Link
            href={`/patients/${consultation.patientId}`}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Patient Profile
          </Link>
        </Button>
        <Button size="sm" asChild>
          <Link href={`/consultations/${id}/edit`}>Edit Consultation</Link>
        </Button>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Consultation Details</CardTitle>
            <CardDescription>{dateLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6">

              {/* Chief Complaint / SOAP Note */}
              <div>
                <h3 className="font-medium mb-2">Chief Complaint / Clinical Notes</h3>
                <div className="rich-text-display text-sm" dangerouslySetInnerHTML={{ __html: decodeHtml(consultation.chiefComplaint || '—') }} />
              </div>

              {/* Progress Note (AI-generated SOAP) */}
              {consultation.progressNote && (
                <div>
                  <h3 className="font-medium mb-2">Progress Note (SOAP)</h3>
                  <div className="rich-text-display text-sm" dangerouslySetInnerHTML={{ __html: decodeHtml(consultation.progressNote) }} />
                </div>
              )}

              {/* Diagnosis */}
              <div>
                <h3 className="font-medium mb-2">Diagnosis</h3>
                <p className="text-sm">{consultation.diagnosis || '—'}</p>
              </div>

              {/* Additional Notes */}
              {consultation.notes && (
                <div>
                  <h3 className="font-medium mb-2">Additional Notes</h3>
                  <div className="rich-text-display text-sm" dangerouslySetInnerHTML={{ __html: consultation.notes }} />
                </div>
              )}

              {/* Procedures */}
              {consultation.procedures && consultation.procedures.length > 0 && (
                <div>
                  <h3 className="font-medium mb-2">Procedures</h3>
                  <ul className="list-disc list-inside text-sm space-y-1">
                    {consultation.procedures.map((procedure, index) => (
                      <li key={index}>
                        {procedure.name}
                        {procedure.price ? ` — RM${procedure.price.toFixed(2)}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Prescriptions */}
              {consultation.prescriptions && consultation.prescriptions.length > 0 && (
                <div>
                  <h3 className="font-medium mb-2">Prescriptions</h3>
                  <ul className="space-y-1 text-sm">
                    {consultation.prescriptions.map((prescription, index) => (
                      <li key={index}>
                        {formatPrescriptionLine(prescription)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
