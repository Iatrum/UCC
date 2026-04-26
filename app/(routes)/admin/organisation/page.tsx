import { getParentOrganizationFromMedplum } from "@/lib/fhir/admin-service";
import OrgForm from "./org-form";

export const dynamic = "force-dynamic";

export default async function OrganisationPage() {
  const organisation = await getParentOrganizationFromMedplum();
  return <OrgForm organisation={organisation} />;
}
