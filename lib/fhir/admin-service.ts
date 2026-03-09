/**
 * Admin Service - Server-side helpers for admin portal
 * Uses Medplum client credentials to access all organisations.
 */
import { getMedplumClient } from "./patient-service";

export interface ClinicSummary {
  id: string;
  name: string;
  subdomain: string;
  phone?: string;
  address?: string;
  logoUrl?: string;
}

const CLINIC_IDENTIFIER_SYSTEM = "clinic";
const ORG_LOGO_EXTENSION_URL = "https://ucc.emr/organization-logo-url";

export async function getOrganizationsFromMedplum(): Promise<ClinicSummary[]> {
  const medplum = await getMedplumClient();
  const bundle = await medplum.searchResources("Organization", { _count: "100" });

  return (bundle ?? []).map((org) => {
    const subdomain =
      org.identifier?.find((id) => id.system === CLINIC_IDENTIFIER_SYSTEM)
        ?.value ?? org.id ?? "";
    const phone = org.telecom?.find((t) => t.system === "phone")?.value;
    const address = org.address?.[0]?.text;
    const logoExt = org.extension?.find((e) => e.url === ORG_LOGO_EXTENSION_URL);
    const logoUrl =
      (logoExt as any)?.valueUrl ?? (logoExt as any)?.valueString ?? undefined;

    return {
      id: org.id ?? "",
      name: org.name ?? "Unnamed clinic",
      subdomain,
      phone,
      address,
      logoUrl,
    };
  });
}

export interface PractitionerSummary {
  id: string;
  name: string;
  email?: string;
  organizations?: Array<{ id: string; name: string }>;
}

export interface InvitePractitionerInput {
  firstName: string;
  lastName: string;
  email: string;
  clinicId: string;
  sendEmail?: boolean;
}

function getIdFromReference(reference?: string): string | undefined {
  if (!reference) return undefined;
  const [resourceType, id] = reference.split("/");
  if (!resourceType || !id) return undefined;
  return id;
}

export async function getPractitionersFromMedplum(): Promise<PractitionerSummary[]> {
  const medplum = await getMedplumClient();
  const [practitioners, roles, organizations] = await Promise.all([
    medplum.searchResources("Practitioner", { _count: "200" }),
    medplum.searchResources("PractitionerRole", { _count: "500" }),
    medplum.searchResources("Organization", { _count: "200" }),
  ]);

  const orgById = new Map<string, { id: string; name: string }>();
  for (const org of organizations ?? []) {
    if (!org.id) continue;
    orgById.set(org.id, { id: org.id, name: org.name ?? "Unnamed clinic" });
  }

  const orgIdsByPractitioner = new Map<string, Set<string>>();
  for (const role of roles ?? []) {
    const practitionerId = getIdFromReference(role.practitioner?.reference);
    const orgId = getIdFromReference(role.organization?.reference);
    if (!practitionerId || !orgId) continue;
    const set = orgIdsByPractitioner.get(practitionerId) ?? new Set<string>();
    set.add(orgId);
    orgIdsByPractitioner.set(practitionerId, set);
  }

  return (practitioners ?? []).map((p) => {
    const name =
      p.name?.[0]?.text ??
      [p.name?.[0]?.given?.join(" "), p.name?.[0]?.family]
        .filter(Boolean)
        .join(" ") ??
      "Unknown";
    const email = p.telecom?.find((t) => t.system === "email")?.value;
    const orgIds = p.id ? Array.from(orgIdsByPractitioner.get(p.id) ?? []) : [];
    const practitionerOrgs = orgIds
      .map((id) => orgById.get(id))
      .filter((value): value is { id: string; name: string } => Boolean(value));
    return { id: p.id ?? "", name, email, organizations: practitionerOrgs };
  });
}

export async function invitePractitionerToMedplum(input: InvitePractitionerInput): Promise<void> {
  const medplum = await getMedplumClient();
  const projectId =
    process.env.MEDPLUM_PROJECT_ID ||
    process.env.NEXT_PUBLIC_MEDPLUM_PROJECT_ID ||
    medplum.getProject()?.id;

  if (!projectId) {
    throw new Error("Medplum project ID not configured");
  }

  const outcome = await medplum.invite(projectId, {
    resourceType: "Practitioner",
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    sendEmail: input.sendEmail ?? true,
    upsert: true,
  });

  if ((outcome as any)?.resourceType === "OperationOutcome") {
    const issue = (outcome as any)?.issue?.[0];
    const details = issue?.details?.text || issue?.diagnostics || "Invite failed";
    throw new Error(details);
  }

  let practitionerId: string | undefined;
  const profileRef = (outcome as any)?.profile?.reference as string | undefined;
  if (profileRef?.startsWith("Practitioner/")) {
    practitionerId = getIdFromReference(profileRef);
  }

  if (!practitionerId) {
    const matches = await medplum.searchResources("Practitioner", {
      telecom: input.email,
      _count: "10",
    });
    const matched = (matches ?? []).find((p) =>
      p.telecom?.some((t) => t.system === "email" && t.value?.toLowerCase() === input.email.toLowerCase())
    );
    practitionerId = matched?.id;
  }

  if (!practitionerId) {
    throw new Error(
      "Invitation created, but practitioner record was not found for clinic assignment yet. Ask user to accept invite, then re-assign."
    );
  }

  const practitionerRef = `Practitioner/${practitionerId}`;
  const clinicRef = `Organization/${input.clinicId}`;
  const existingRole = await medplum.searchOne("PractitionerRole", {
    practitioner: practitionerRef,
    organization: clinicRef,
  });

  if (!existingRole) {
    await medplum.createResource({
      resourceType: "PractitionerRole",
      active: true,
      practitioner: { reference: practitionerRef },
      organization: { reference: clinicRef },
    });
  }
}
