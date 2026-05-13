import type { MedplumClient } from "@medplum/core";
import type { Questionnaire, QuestionnaireItem, QuestionnaireResponse } from "@medplum/fhirtypes";
import type { PatientData } from "./patient-service";

export const REGISTRATION_QUESTIONNAIRE_URL = "https://ucc.emr/fhir/Questionnaire/patient-registration";
export const REGISTRATION_QUESTIONNAIRE_NAME = "UccPatientRegistration";
export const REGISTRATION_QUESTIONNAIRE_VERSION = "1.0.0";
export const MYHIE_QUESTIONNAIRE_RESPONSE_PROFILE_URL =
  "http://fhir.hie.moh.gov.my/StructureDefinition/QuestionnaireResponse-my-core";

type IntakeComparisonField =
  | "fullName"
  | "nric"
  | "dateOfBirth"
  | "gender"
  | "email"
  | "phone"
  | "address"
  | "postalCode"
  | "emergencyContact.name"
  | "emergencyContact.relationship"
  | "emergencyContact.phone"
  | "medicalHistory.allergies";

export interface IntakeComparisonMismatch {
  field: IntakeComparisonField;
  questionnaireValue: string;
  patientPayloadValue: string;
}

export interface IntakeComparisonResult {
  mismatches: IntakeComparisonMismatch[];
  questionnaireValues: Record<IntakeComparisonField, string>;
  patientValues: Record<IntakeComparisonField, string>;
}

const LINK_ID = {
  personal: "personal-information",
  fullName: "full-name",
  nric: "nric",
  dateOfBirth: "date-of-birth",
  gender: "gender",
  contact: "contact-information",
  email: "email",
  phone: "phone",
  address: "address",
  postalCode: "postal-code",
  emergency: "emergency-contact",
  emergencyName: "emergency-contact-name",
  emergencyRelationship: "emergency-contact-relationship",
  emergencyPhone: "emergency-contact-phone",
  medicalHistory: "medical-history",
  allergies: "allergies",
} as const;

type QuestionnaireResponseItemType = NonNullable<QuestionnaireResponse["item"]>[number];
type QuestionnaireResponseAnswerType = NonNullable<QuestionnaireResponseItemType["answer"]>;

function section(linkId: string, text: string, items: QuestionnaireItem[]): QuestionnaireItem {
  return {
    linkId,
    text,
    type: "group",
    item: items,
  };
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAllergies(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => trimString(v)).filter(Boolean);
}

function buildRegistrationQuestionnaire(): Questionnaire {
  return {
    resourceType: "Questionnaire",
    url: REGISTRATION_QUESTIONNAIRE_URL,
    name: REGISTRATION_QUESTIONNAIRE_NAME,
    version: REGISTRATION_QUESTIONNAIRE_VERSION,
    status: "active",
    title: "UCC Patient Registration (Pilot)",
    experimental: true,
    subjectType: ["Patient"],
    item: [
      section(LINK_ID.personal, "Personal Information", [
        { linkId: LINK_ID.fullName, text: "Full Name", type: "string", required: true },
        { linkId: LINK_ID.nric, text: "NRIC", type: "string", required: true },
        { linkId: LINK_ID.dateOfBirth, text: "Date of Birth", type: "date", required: true },
        {
          linkId: LINK_ID.gender,
          text: "Gender",
          type: "choice",
          required: true,
          answerOption: [
            { valueCoding: { code: "male", display: "Male" } },
            { valueCoding: { code: "female", display: "Female" } },
            { valueCoding: { code: "other", display: "Other" } },
          ],
        },
      ]),
      section(LINK_ID.contact, "Contact Information", [
        { linkId: LINK_ID.email, text: "Email", type: "string" },
        { linkId: LINK_ID.phone, text: "Phone", type: "string", required: true },
        { linkId: LINK_ID.address, text: "Address", type: "text" },
        { linkId: LINK_ID.postalCode, text: "Postal Code", type: "string" },
      ]),
      section(LINK_ID.emergency, "Emergency Contact", [
        { linkId: LINK_ID.emergencyName, text: "Contact Name", type: "string" },
        { linkId: LINK_ID.emergencyRelationship, text: "Relationship", type: "string" },
        { linkId: LINK_ID.emergencyPhone, text: "Contact Number", type: "string" },
      ]),
      section(LINK_ID.medicalHistory, "Medical History", [
        { linkId: LINK_ID.allergies, text: "Allergies", type: "string", repeats: true },
      ]),
    ],
  };
}

function questionnaireNeedsUpdate(existing: Questionnaire): boolean {
  if (existing.version !== REGISTRATION_QUESTIONNAIRE_VERSION) return true;
  if (existing.name !== REGISTRATION_QUESTIONNAIRE_NAME) return true;
  if (existing.url !== REGISTRATION_QUESTIONNAIRE_URL) return true;
  if (!existing.item || existing.item.length === 0) return true;
  return false;
}

export async function ensureRegistrationQuestionnaire(
  medplum: MedplumClient
): Promise<Questionnaire> {
  const existing = await medplum.searchOne("Questionnaire", {
    url: REGISTRATION_QUESTIONNAIRE_URL,
    _count: "1",
  });
  const canonical = buildRegistrationQuestionnaire();

  if (!existing) {
    return medplum.createResource<Questionnaire>(canonical);
  }

  if (!questionnaireNeedsUpdate(existing)) {
    return existing;
  }

  return medplum.updateResource<Questionnaire>({
    ...existing,
    ...canonical,
    id: existing.id,
  });
}

function toResponseItem(
  linkId: string,
  answers: QuestionnaireResponseAnswerType
): QuestionnaireResponseItemType {
  return {
    linkId,
    answer: answers,
  };
}

export function buildRegistrationQuestionnaireResponse(
  patientData: PatientData,
  questionnaire: Pick<Questionnaire, "id" | "url">
): QuestionnaireResponse {
  const allergies = normalizeAllergies(patientData.medicalHistory?.allergies);

  const personalItems: QuestionnaireResponseItemType[] = [
    toResponseItem(LINK_ID.fullName, [{ valueString: trimString(patientData.fullName) }]),
    toResponseItem(LINK_ID.nric, [{ valueString: trimString(patientData.nric) }]),
    toResponseItem(LINK_ID.dateOfBirth, [{ valueDate: trimString(patientData.dateOfBirth) }]),
    toResponseItem(LINK_ID.gender, [
      { valueCoding: { code: trimString(patientData.gender), display: trimString(patientData.gender) } },
    ]),
  ];

  const contactItems: QuestionnaireResponseItemType[] = [
    toResponseItem(LINK_ID.email, [{ valueString: trimString(patientData.email) }]),
    toResponseItem(LINK_ID.phone, [{ valueString: trimString(patientData.phone) }]),
    toResponseItem(LINK_ID.address, [{ valueString: trimString(patientData.address) }]),
    toResponseItem(LINK_ID.postalCode, [{ valueString: trimString(patientData.postalCode) }]),
  ];

  const emergencyItems: QuestionnaireResponseItemType[] = [
    toResponseItem(LINK_ID.emergencyName, [{ valueString: trimString(patientData.emergencyContact?.name) }]),
    toResponseItem(LINK_ID.emergencyRelationship, [
      { valueString: trimString(patientData.emergencyContact?.relationship) },
    ]),
    toResponseItem(LINK_ID.emergencyPhone, [{ valueString: trimString(patientData.emergencyContact?.phone) }]),
  ];

  const medicalItems: QuestionnaireResponseItemType[] = [
    toResponseItem(
      LINK_ID.allergies,
      allergies.length ? allergies.map((allergy) => ({ valueString: allergy })) : [{ valueString: "" }]
    ),
  ];

  return {
    resourceType: "QuestionnaireResponse",
    status: "completed",
    questionnaire: questionnaire.url
      ? questionnaire.url
      : questionnaire.id
        ? `Questionnaire/${questionnaire.id}`
        : REGISTRATION_QUESTIONNAIRE_URL,
    authored: new Date().toISOString(),
    item: [
      { linkId: LINK_ID.personal, item: personalItems },
      { linkId: LINK_ID.contact, item: contactItems },
      { linkId: LINK_ID.emergency, item: emergencyItems },
      { linkId: LINK_ID.medicalHistory, item: medicalItems },
    ],
    meta: {
      profile: [MYHIE_QUESTIONNAIRE_RESPONSE_PROFILE_URL],
    },
  };
}

function getResponseItems(response: QuestionnaireResponse): QuestionnaireResponseItemType[] {
  return response.item ?? [];
}

function findItem(items: QuestionnaireResponseItemType[], linkId: string): QuestionnaireResponseItemType | undefined {
  for (const item of items) {
    if (item.linkId === linkId) return item;
    if (item.item?.length) {
      const nested = findItem(item.item, linkId);
      if (nested) return nested;
    }
  }
  return undefined;
}

function getStringAnswer(response: QuestionnaireResponse, linkId: string): string {
  const item = findItem(getResponseItems(response), linkId);
  const answer = item?.answer?.[0];
  if (!answer) return "";
  if (typeof answer.valueString === "string") return answer.valueString.trim();
  if (typeof answer.valueDate === "string") return answer.valueDate.trim();
  if (answer.valueCoding?.code) return answer.valueCoding.code.trim();
  return "";
}

function getStringAnswers(response: QuestionnaireResponse, linkId: string): string[] {
  const item = findItem(getResponseItems(response), linkId);
  return (
    item?.answer
      ?.map((answer: QuestionnaireResponseAnswerType[number]) => answer.valueString?.trim())
      .filter((value: string | undefined): value is string => Boolean(value)) ?? []
  );
}

function normalizePatientValues(patientData: PatientData): Record<IntakeComparisonField, string> {
  const allergies = normalizeAllergies(patientData.medicalHistory?.allergies).sort((a, b) =>
    a.localeCompare(b)
  );

  return {
    fullName: trimString(patientData.fullName),
    nric: trimString(patientData.nric),
    dateOfBirth: trimString(patientData.dateOfBirth),
    gender: trimString(patientData.gender),
    email: trimString(patientData.email),
    phone: trimString(patientData.phone),
    address: trimString(patientData.address),
    postalCode: trimString(patientData.postalCode),
    "emergencyContact.name": trimString(patientData.emergencyContact?.name),
    "emergencyContact.relationship": trimString(patientData.emergencyContact?.relationship),
    "emergencyContact.phone": trimString(patientData.emergencyContact?.phone),
    "medicalHistory.allergies": allergies.join("|"),
  };
}

function normalizeQuestionnaireValues(
  response: QuestionnaireResponse
): Record<IntakeComparisonField, string> {
  const allergies = getStringAnswers(response, LINK_ID.allergies).sort((a, b) => a.localeCompare(b));
  return {
    fullName: getStringAnswer(response, LINK_ID.fullName),
    nric: getStringAnswer(response, LINK_ID.nric),
    dateOfBirth: getStringAnswer(response, LINK_ID.dateOfBirth),
    gender: getStringAnswer(response, LINK_ID.gender),
    email: getStringAnswer(response, LINK_ID.email),
    phone: getStringAnswer(response, LINK_ID.phone),
    address: getStringAnswer(response, LINK_ID.address),
    postalCode: getStringAnswer(response, LINK_ID.postalCode),
    "emergencyContact.name": getStringAnswer(response, LINK_ID.emergencyName),
    "emergencyContact.relationship": getStringAnswer(response, LINK_ID.emergencyRelationship),
    "emergencyContact.phone": getStringAnswer(response, LINK_ID.emergencyPhone),
    "medicalHistory.allergies": allergies.join("|"),
  };
}

export function compareQuestionnaireResponseToPatientPayload(
  response: QuestionnaireResponse,
  patientData: PatientData
): IntakeComparisonResult {
  const questionnaireValues = normalizeQuestionnaireValues(response);
  const patientValues = normalizePatientValues(patientData);

  const fields: IntakeComparisonField[] = [
    "fullName",
    "nric",
    "dateOfBirth",
    "gender",
    "email",
    "phone",
    "address",
    "postalCode",
    "emergencyContact.name",
    "emergencyContact.relationship",
    "emergencyContact.phone",
    "medicalHistory.allergies",
  ];

  const mismatches = fields
    .filter((field) => questionnaireValues[field] !== patientValues[field])
    .map((field) => ({
      field,
      questionnaireValue: questionnaireValues[field],
      patientPayloadValue: patientValues[field],
    }));

  return {
    mismatches,
    questionnaireValues,
    patientValues,
  };
}
