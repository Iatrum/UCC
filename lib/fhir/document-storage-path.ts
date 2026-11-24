/**
 * Firebase Storage object paths for patient documents (Task 797).
 *
 * The documents route deletes the stored object with the Admin SDK, so the path saved on a
 * DocumentReference must never be client-chosen: it has to sit under that one patient's folder.
 * The multipart upload builds `patients/<patientId>/documents/<ts>-<uuid>-<safe name>` itself.
 */
export function patientDocumentStoragePrefix(patientId: string): string {
  return `patients/${patientId}/documents/`;
}

/** True only for a single file directly inside the patient's own documents folder. */
export function isPatientDocumentStoragePath(patientId: string, path: unknown): path is string {
  if (typeof path !== 'string' || path.length > 400) return false;
  const prefix = patientDocumentStoragePrefix(patientId);
  if (!path.startsWith(prefix)) return false;
  return /^[A-Za-z0-9._-]+$/.test(path.slice(prefix.length)) && !path.slice(prefix.length).startsWith('..');
}
