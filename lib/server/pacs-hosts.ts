import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { getPacsHostsFromOrganization } from '@/lib/fhir/pacs-allowlist';

/** Allowed PACS viewer hosts for one clinic. Any failure -> [] (default deny). */
export async function getPacsHostsForClinic(clinicId: string): Promise<string[]> {
  try {
    const medplum = await getAdminMedplum();
    const org = (await medplum.searchResources('Organization', { identifier: `clinic|${clinicId}`, _count: '1' }))?.[0];
    return org ? getPacsHostsFromOrganization(org) : [];
  } catch {
    return [];
  }
}
