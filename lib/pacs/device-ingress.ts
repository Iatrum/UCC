import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { ingestPacsStudy, type IngestOutcome } from './study-ingest';
import type { OrthancStudy } from './orthanc-client';

/**
 * Device ingress has no user session, so it writes with the server client, like the other device
 * ingress paths. The caller MUST pass the clinic of the authenticated Device (authenticateDeviceKey).
 */
export async function ingestPacsStudyForDevice(study: OrthancStudy, deviceClinicId: string): Promise<IngestOutcome> {
  return ingestPacsStudy(study, await getAdminMedplum(), deviceClinicId);
}
