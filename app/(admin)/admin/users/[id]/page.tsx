import { notFound } from "next/navigation";
import {
  getOrganizationsFromMedplum,
  getPractitionerFromMedplum,
} from "@/lib/fhir/admin-service";
import { getCurrentProfile } from "@/lib/server/medplum-auth";
import UserEditForm from "./user-edit-form";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditUserPage({ params }: Props) {
  const { id } = await params;
  const [user, clinics, currentProfile] = await Promise.all([
    getPractitionerFromMedplum(id),
    getOrganizationsFromMedplum().catch(() => []),
    getCurrentProfile().catch(() => null),
  ]);
  if (!user) {
    notFound();
  }
  const isSelf =
    currentProfile?.resourceType === "Practitioner" && currentProfile.id === id;
  return <UserEditForm user={user} clinics={clinics} isSelf={isSelf} />;
}
