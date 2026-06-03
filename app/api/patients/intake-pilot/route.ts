import { NextRequest, NextResponse } from "next/server";
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";
import { savePatientToMedplumWithAdmin, type PatientData } from "@/lib/fhir/patient-service";
import {
  REGISTRATION_QUESTIONNAIRE_URL,
  REGISTRATION_QUESTIONNAIRE_VERSION,
  MYHIE_QUESTIONNAIRE_RESPONSE_PROFILE_URL,
  createRegistrationQuestionnaireResponseWithAdmin,
} from "@/lib/fhir/intake-questionnaire-service";

function validatePatientData(patientData: PatientData): string | null {
  if (!patientData.fullName || !patientData.nric || !patientData.dateOfBirth || !patientData.gender) {
    return "Missing required fields: fullName, nric, dateOfBirth, gender";
  }
  return null;
}

function logPilotEvent(payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      event: "patient_registration_v1_pilot",
      timestamp: new Date().toISOString(),
      ...payload,
    })
  );
}

export async function POST(request: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(request);
    const patientData = (await request.json()) as PatientData;

    const validationError = validatePatientData(patientData);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const patientId = await savePatientToMedplumWithAdmin(patientData, clinicId ?? undefined);

    try {
      const { questionnaire, questionnaireResponse: savedResponse, comparison } =
        await createRegistrationQuestionnaireResponseWithAdmin(patientData, clinicId);

      logPilotEvent({
        questionnaireCanonicalUrl: REGISTRATION_QUESTIONNAIRE_URL,
        questionnaireVersion: REGISTRATION_QUESTIONNAIRE_VERSION,
        questionnaireResponseId: savedResponse.id ?? null,
        myhieProfileTagged:
          savedResponse.meta?.profile?.includes(MYHIE_QUESTIONNAIRE_RESPONSE_PROFILE_URL) ?? false,
        patientCreationSuccess: true,
        questionnaireResponseSuccess: true,
        patientId,
        mismatchFields: comparison.mismatches.map((m) => m.field),
        mismatchCount: comparison.mismatches.length,
      });

      return NextResponse.json({
        success: true,
        patientId,
        questionnaireResponseId: savedResponse.id,
        questionnaireVersion: questionnaire.version ?? REGISTRATION_QUESTIONNAIRE_VERSION,
        mismatchFields: comparison.mismatches.map((m) => m.field),
        mismatchCount: comparison.mismatches.length,
      });
    } catch (error) {
      logPilotEvent({
        questionnaireCanonicalUrl: REGISTRATION_QUESTIONNAIRE_URL,
        questionnaireVersion: REGISTRATION_QUESTIONNAIRE_VERSION,
        questionnaireResponseId: null,
        myhieProfileTagged: false,
        patientCreationSuccess: true,
        questionnaireResponseSuccess: false,
        patientId,
        mismatchFields: [],
        mismatchCount: 0,
        error: error instanceof Error ? error.message : "Unknown questionnaire response error",
      });

      return NextResponse.json({
        success: true,
        patientId,
        questionnaireVersion: REGISTRATION_QUESTIONNAIRE_VERSION,
        questionnaireResponseWarning:
          error instanceof Error ? error.message : "Questionnaire response was not saved",
      });
    }
  } catch (error) {
    return handleRouteError(error, "POST /api/patients/intake-pilot");
  }
}
