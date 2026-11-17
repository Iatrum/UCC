import { withRegistrationTag } from '@/lib/fhir/patient-registration';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getAdminMedplum } from '@/lib/server/medplum-auth';
import { makeClinicStamper } from '@/lib/fhir/write-containment';

type ConsultationData = {
  id: string;
  patientName: string;
  patientIc: string;
  patientDob?: string;
  patientGender?: string;
  patientPhone?: string;
  patientAddress?: string;
  consultationDate: string;
  diagnosis: string;
  treatment: string;
  notes?: string;
  medications?: Array<{
    name: string;
    dosage: string;
    frequency: string;
    duration: string;
  }>;
};

/**
 * Bulk migration: Firebase → Medplum.
 *
 * Uses the service account (getAdminMedplum) because this is a one-off migration
 * job that may need to create many resources across all patients.
 * Practitioner tokens are for routine clinical API use only.
 *
 * Must be called with Authorization: Bearer <MEDPLUM_BULK_EXPORT_SECRET>
 * to prevent public access while keeping admin FHIR write access.
 */
export async function POST(request: NextRequest) {
  try {
    const bulkSecret = process.env.MEDPLUM_BULK_EXPORT_SECRET;
    if (!bulkSecret) {
      return NextResponse.json(
        { error: 'Bulk export is disabled. Set MEDPLUM_BULK_EXPORT_SECRET env var.' },
        { status: 503 }
      );
    }

    const auth = request.headers.get('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || token !== bulkSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, clinicId } = await request.json();

    if (action !== 'export_all') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    // Task 350: fail closed - one clinic per run; never export across clinics.
    if (typeof clinicId !== 'string' || !/^[A-Za-z0-9.-]+$/.test(clinicId)) {
      return NextResponse.json({ error: 'clinicId is required' }, { status: 400 });
    }

    const medplum = await getAdminMedplum();
    let clinic;
    try {
      clinic = await makeClinicStamper(medplum, clinicId);
    } catch {
      return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });
    }
    const { stamp, isOwn, patientSearch } = clinic;

    // Fetch only this clinic's consultations (documents without a clinicId are never exported).
    const consultationsSnapshot = await adminDb.collection('consultations').where('clinicId', '==', clinicId).get();
    const consultations: ConsultationData[] = [];

    consultationsSnapshot.forEach((doc) => {
      consultations.push({ id: doc.id, ...doc.data() } as ConsultationData);
    });

    console.log(`📦 Found ${consultations.length} consultations to export`);

    const results = {
      total: consultations.length,
      successful: 0,
      failed: 0,
      errors: [] as Array<{ id: string; error: string }>,
    };

    // Export each consultation
    for (const consultation of consultations) {
      try {
        // 1. Create or get Patient resource
        const matches = consultation.patientIc ? await medplum.searchResources('Patient', {
          ...patientSearch, identifier: consultation.patientIc,
        }, { cache: 'no-cache', headers: { 'X-Medplum': 'extended' } }) : [];

        // Re-use only a Patient owned by this clinic; otherwise create one in this clinic.
        let patient: any = matches.find((candidate) => isOwn(candidate));
        if (!patient) {
          patient = await medplum.createResource(withRegistrationTag(stamp({
            resourceType: 'Patient',
            identifier: [
              {
                system: 'urn:ic',
                value: consultation.patientIc,
              },
            ],
            name: [
              {
                text: consultation.patientName,
                family: consultation.patientName.split(' ').pop(),
                given: consultation.patientName.split(' ').slice(0, -1),
              },
            ],
            birthDate: consultation.patientDob,
            gender: consultation.patientGender?.toLowerCase() as 'male' | 'female' | 'other',
            telecom: consultation.patientPhone
              ? [{ system: 'phone', value: consultation.patientPhone }]
              : undefined,
            address: consultation.patientAddress
              ? [{ text: consultation.patientAddress }]
              : undefined,
          })));
          console.log(`✅ Created Patient: ${(patient as any).id}`);
        }

        // 2. Create Encounter resource
        const encounter = await medplum.createResource(stamp({
          resourceType: 'Encounter',
          status: 'finished',
          class: {
            system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
            code: 'AMB',
            display: 'ambulatory',
          },
          subject: {
            reference: `Patient/${(patient as any).id}`,
            display: consultation.patientName,
          },
          period: {
            start: consultation.consultationDate,
            end: consultation.consultationDate,
          },
        }));
        console.log(`✅ Created Encounter: ${(encounter as any).id}`);

        // 3. Create Condition (Diagnosis) resource
        if (consultation.diagnosis) {
          const condition = await medplum.createResource(stamp({
            resourceType: 'Condition',
            subject: {
              reference: `Patient/${(patient as any).id}`,
            },
            encounter: {
              reference: `Encounter/${(encounter as any).id}`,
            },
            code: {
              text: consultation.diagnosis,
            },
            recordedDate: consultation.consultationDate,
          }));
          console.log(`✅ Created Condition: ${(condition as any).id}`);
        }

        // 4. Create Procedure (Treatment) resource
        if (consultation.treatment) {
          const procedure = await medplum.createResource(stamp({
            resourceType: 'Procedure',
            status: 'completed',
            subject: {
              reference: `Patient/${(patient as any).id}`,
            },
            encounter: {
              reference: `Encounter/${(encounter as any).id}`,
            },
            code: {
              text: consultation.treatment,
            },
            performedDateTime: consultation.consultationDate,
          }));
          console.log(`✅ Created Procedure: ${(procedure as any).id}`);
        }

        // 5. Create Observation (Notes) if present
        if (consultation.notes) {
          const observation = await medplum.createResource(stamp({
            resourceType: 'Observation',
            status: 'final',
            subject: {
              reference: `Patient/${(patient as any).id}`,
            },
            encounter: {
              reference: `Encounter/${(encounter as any).id}`,
            },
            code: {
              text: 'Clinical Notes',
            },
            valueString: consultation.notes,
            effectiveDateTime: consultation.consultationDate,
          }));
          console.log(`✅ Created Observation: ${(observation as any).id}`);
        }

        // 6. Create MedicationRequest resources
        if (consultation.medications && consultation.medications.length > 0) {
          for (const med of consultation.medications) {
            const medicationRequest = await medplum.createResource(stamp({
              resourceType: 'MedicationRequest',
              status: 'active',
              intent: 'order',
              subject: {
                reference: `Patient/${(patient as any).id}`,
              },
              encounter: {
                reference: `Encounter/${(encounter as any).id}`,
              },
              medicationCodeableConcept: {
                text: med.name,
              },
              dosageInstruction: [
                {
                  text: `${med.dosage} - ${med.frequency} for ${med.duration}`,
                  timing: {
                    repeat: {
                      frequency: 1,
                      period: 1,
                      periodUnit: 'd',
                    },
                  },
                  doseAndRate: [
                    {
                      doseQuantity: {
                        value: parseFloat(med.dosage) || 1,
                        unit: 'tablet',
                      },
                    },
                  ],
                },
              ],
              authoredOn: consultation.consultationDate,
            }));
            console.log(`✅ Created MedicationRequest: ${(medicationRequest as any).id}`);
          }
        }

        results.successful++;
        console.log(`✅ Successfully exported consultation ${consultation.id}`);
      } catch (error: any) {
        results.failed++;
        const errorMsg = error.message || String(error);
        results.errors.push({ id: consultation.id, error: errorMsg });
        console.error(`❌ Failed to export consultation ${consultation.id}:`, errorMsg);
      }
    }

    console.log('📊 Export Summary:', results);

    return NextResponse.json({
      success: true,
      message: `Exported ${results.successful}/${results.total} consultations`,
      results,
    });
  } catch (error: any) {
    console.error('❌ Export failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to export consultations',
      },
      { status: 500 }
    );
  }
}

