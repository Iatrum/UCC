import type { Organization } from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';
// Mirrors lib/module-settings.ts: the same per-clinic module toggle an admin flips in /admin/clinics.
const moduleExtensionUrl = 'https://ucc.emr/organization-enabled-module-ids';
const defaultBranchEnabledModuleIds = ['appointments', 'inventory', 'analytics', 'follow-up'];
/** Turn a module on/off for a clinic; returns a restore function that leaves the clinic config as found. */
export async function setClinicModule(m: MedplumClient, clinicId: string, moduleId: 'poct' | 'pacs', enabled: boolean) {
  const org = await m.searchOne('Organization', { identifier: `clinic|${clinicId}` });
  if (!org?.id) throw new Error(`Organization for clinic ${clinicId} not found`);
  const existing = org.extension?.find((ext) => ext.url === moduleExtensionUrl);
  const ids: string[] = existing?.valueString ? JSON.parse(existing.valueString) : [...defaultBranchEnabledModuleIds];
  if (ids.includes(moduleId) === enabled) return async () => {};
  const next = enabled ? [...ids, moduleId] : ids.filter((id) => id !== moduleId);
  await m.updateResource<Organization>({ ...org, extension: [...(org.extension?.filter((e) => e.url !== moduleExtensionUrl) ?? []), { url: moduleExtensionUrl, valueString: JSON.stringify(next) }] });
  await settleModuleMemo();
  return async () => {
    const latest = await m.readResource('Organization', org.id!);
    await m.updateResource<Organization>({ ...latest, extension: [...(latest.extension?.filter((e) => e.url !== moduleExtensionUrl) ?? []), ...(existing ? [existing] : [])] });
    await settleModuleMemo();
  };
}

/** The app memoises per-clinic module ids for 5 s (lib/server/module-ids-memo.ts, Task 547). Direct Medplum writes bypass its invalidation, so wait it out before the UI/API is expected to see the change. */
export const settleModuleMemo = () => new Promise<void>((resolve) => setTimeout(resolve, 5_500));
