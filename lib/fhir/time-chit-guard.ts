import { isModuleEnabledForClinic } from '@/lib/module-registry';
import { ConflictError, ForbiddenError } from '@/lib/server/route-helpers';
import { isTimeChitProcedure, timeChitError, timeChitHours } from '@/lib/time-chit';

type DocumentProcedure = { notes?: string; procedureId?: string; name?: string };
/** Run before any writes, including replacement/deletion of existing documents. */
export async function assertTimeChitMutationAllowed(
  incoming: DocumentProcedure[], existing: DocumentProcedure[], clinicId?: string | null
): Promise<void> {
  if (![...incoming, ...existing].some(isTimeChitProcedure)) return;
  if (!clinicId || !await isModuleEnabledForClinic('time-chit', clinicId))
    throw new ForbiddenError('Time Chit is disabled for this clinic.');
  for (const proc of incoming.filter(isTimeChitProcedure)) {
    let details: Record<string, unknown>;
    try { details = JSON.parse(proc.notes || '{}'); } catch { throw new ConflictError('Invalid Time Chit details.'); }
    if (!details || typeof details !== 'object') throw new ConflictError('Invalid Time Chit details.');
    const error = timeChitError(details);
    if (error) throw new ConflictError(error);
    proc.notes = JSON.stringify({ ...details, kind: 'time-chit', tcHours: timeChitHours(String(details.tcTimeIn), String(details.tcTimeOut)) });
  }
}
