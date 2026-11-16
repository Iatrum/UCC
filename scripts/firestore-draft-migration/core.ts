// Task 365: legacy Firestore treatment-plan drafts -> Medplum unsigned drafts.
// Pure planning/apply/rollback logic. No network or file access here: the CLI
// (migrate.ts) injects a FhirClient, the unit tests inject a fake one.
// Plan and rationale: .ai/PLAN-firestore-draft-migration.md
import { createHash } from 'node:crypto';

/** Must stay identical to lib/fhir/consultation-draft.ts (pinned by a parity unit test). */
export const KEY_SYSTEM = 'urn:ucc:consultation-draft';
export const CLINIC_SYSTEM = 'clinic';
/** Present on a document this migration wrote and nobody has edited since. */
export const MIGRATED_SYSTEM = 'urn:ucc:consultation-draft:legacy-firestore';
/** Present on a document this migration wrote and then rolled back. */
export const ROLLED_BACK_SYSTEM = 'urn:ucc:consultation-draft:legacy-firestore-rolled-back';
export const LEGACY_COLLECTION = 'consultation_treatment_plans';
export const EXPORT_FORMAT = 'ucc-legacy-treatment-drafts/v1';
export const MANIFEST_FORMAT = 'ucc-legacy-treatment-drafts-manifest/v1';
const EMPTY_JSON_BASE64 = 'e30=';
const TABS = ['items', 'services', 'packages', 'documents'];
const ID = /^[A-Za-z0-9.-]{1,64}$/;

export type LegacyDraft = {
  /** Firestore document id (the legacy route used the draftId as the document id). */
  id: string;
  draftId?: unknown; clinicId?: unknown; patientId?: unknown; consultationId?: unknown;
  entries?: unknown; createdAt?: unknown; updatedAt?: unknown;
};
export type ExportFile = { format: string; collection: string; exportedAt: string; count: number; drafts: LegacyDraft[] };

type Identifier = { system?: string; value?: string };
type Ref = { reference?: string };
export type Resource = {
  resourceType: string; id?: string; status?: string; active?: boolean;
  meta?: { versionId?: string; accounts?: Ref[]; account?: Ref | Ref[] };
  identifier?: Identifier[]; subject?: Ref; author?: Ref[];
  participant?: { individual?: Ref }[];
  content?: { attachment: { contentType?: string; data?: string } }[];
  [key: string]: unknown;
};
export interface FhirClient {
  /** Resolves undefined when the resource does not exist or was deleted. */
  read(type: string, id: string): Promise<Resource | undefined>;
  search(type: string, params: Record<string, string>): Promise<Resource[]>;
  /** Conditional create (If-None-Exist). Returns the existing resource when one matches. */
  create(resource: Resource, ifNoneExist: string): Promise<Resource>;
  /** Version-pinned update (If-Match). Must throw PreconditionError when the version moved. */
  update(resource: Resource, ifMatchVersion: string): Promise<Resource>;
}
export class PreconditionError extends Error {}
/** An error whose message is safe to print (never embeds resource content). */
export class SafeError extends Error {}

export type Options = {
  clinicId: string;
  /** Only migrate drafts last updated at or after this instant. */
  since?: Date;
  /** Operator-reviewed owners for drafts whose owner cannot be derived: legacy document id -> Practitioner id. */
  owners?: Record<string, string>;
  apply?: boolean;
  limit?: number;
  now?: () => Date;
};
export type Outcome = {
  /** sha256 of the legacy document path; safe to log (no patient identifier in clear). */
  source: string;
  legacyId: string;
  action: 'create' | 'restore' | 'skip' | 'error';
  reason: string;
  applied?: boolean;
  documentReferenceId?: string; versionId?: string; key?: string;
};
export type ManifestEntry = { source: string; key: string; documentReferenceId: string; versionId: string };
export type Manifest = { format: string; clinicId: string; createdAt: string; entries: ManifestEntry[] };

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export const sourceHash = (legacyId: string) => sha(`${LEGACY_COLLECTION}/${legacyId}`);
/** Same derivation as key() in lib/fhir/consultation-draft.ts. */
export function draftKey(clinicId: string, practitioner: string, patientId: string, consultationId: string | undefined, draftId: string) {
  return sha(JSON.stringify([clinicId, practitioner, patientId, consultationId || '', draftId]));
}
const hasIdentifier = (resource: Resource, system: string, value: string) =>
  !!resource.identifier?.some(i => i.system === system && i.value === value);
const accountRefs = (resource: Resource) => {
  const single = resource.meta?.account;
  return [...(resource.meta?.accounts ?? []), ...(single ? (Array.isArray(single) ? single : [single]) : [])]
    .map(ref => ref.reference).filter((ref): ref is string => !!ref);
};
const sameSet = (a: string[], b: string[]) => {
  const left = new Set(a), right = new Set(b);
  return left.size === right.size && [...left].every(value => right.has(value));
};

/** Firestore Timestamp / Date / ISO string -> ISO string, otherwise undefined. */
export function toIso(value: unknown): string | undefined {
  const date = value && typeof (value as { toDate?: unknown }).toDate === 'function'
    ? (value as { toDate(): Date }).toDate()
    : typeof value === 'string' || value instanceof Date ? new Date(value) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}
/** One Firestore document -> one export record. Only the fields the migration needs are kept. */
export function toExportRecord(id: string, data: Record<string, unknown>): LegacyDraft {
  return {
    id, draftId: data.draftId, clinicId: data.clinicId, patientId: data.patientId, consultationId: data.consultationId,
    entries: data.entries, createdAt: toIso(data.createdAt), updatedAt: toIso(data.updatedAt),
  };
}

const optionalString = (value: unknown) => value === undefined || value === null || typeof value === 'string';
/** Returns the entries reduced to the TreatmentPlanEntry fields, or undefined when any entry is malformed. */
export function sanitizeEntries(entries: unknown, fallbackIso: string): Record<string, unknown>[] | undefined {
  if (!Array.isArray(entries)) return undefined;
  const seen = new Set<string>();
  const result: Record<string, unknown>[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') return undefined;
    const e = raw as Record<string, unknown>;
    const quantity = e.quantity, unitPrice = e.unitPrice;
    if (typeof e.id !== 'string' || !e.id || seen.has(e.id) || !TABS.includes(e.tab as string) ||
        typeof e.name !== 'string' || !e.name.trim() ||
        typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0 ||
        typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0 ||
        ![e.catalogRef, e.instruction, e.dosage, e.frequency, e.duration].every(optionalString) ||
        (e.meta != null && (typeof e.meta !== 'object' || Array.isArray(e.meta) ||
          !Object.values(e.meta as object).every(v => typeof v === 'string')))) {
      return undefined;
    }
    seen.add(e.id);
    const entry: Record<string, unknown> = {
      id: e.id, tab: e.tab, name: e.name, quantity, unitPrice,
      // Always recomputed, exactly as normalizeTreatmentPlanEntry does, so a corrupt stored total cannot reach billing.
      lineTotal: Number((quantity * unitPrice).toFixed(2)),
      createdAt: toIso(e.createdAt) ?? fallbackIso, updatedAt: toIso(e.updatedAt) ?? fallbackIso,
    };
    for (const field of ['catalogRef', 'instruction', 'dosage', 'frequency', 'duration'] as const) {
      if (typeof e[field] === 'string') entry[field] = e[field];
    }
    if (e.meta != null) entry.meta = { ...(e.meta as object) };
    result.push(entry);
  }
  return result;
}

type Planned =
  | { action: 'skip' | 'error'; reason: string }
  | { action: 'create' | 'restore'; reason: string; key: string; resource: Resource; existing?: Resource; patientAccounts: string[] };

function buildResource(o: { clinicId: string; key: string; source: string; patientId: string; practitioner: string;
  consultationId?: string; date: string; entries: unknown }): Resource {
  return {
    resourceType: 'DocumentReference', status: 'current', docStatus: 'preliminary',
    identifier: [
      { system: CLINIC_SYSTEM, value: o.clinicId }, { system: KEY_SYSTEM, value: o.key },
      { system: MIGRATED_SYSTEM, value: o.source },
    ],
    type: { coding: [{ system: KEY_SYSTEM, code: 'unsigned-draft' }] },
    subject: { reference: `Patient/${o.patientId}` }, author: [{ reference: o.practitioner }],
    ...(o.consultationId ? { context: { encounter: [{ reference: `Encounter/${o.consultationId}` }] } } : {}),
    date: o.date,
    content: [{ attachment: { contentType: 'application/json', data: Buffer.from(JSON.stringify(o.entries)).toString('base64') } }],
  };
}

/** Read-only: decides what would happen to one legacy draft. Every refusal is a named skip reason. */
export async function planDraft(client: FhirClient, legacy: LegacyDraft, options: Options): Promise<Planned> {
  const skip = (reason: string): Planned => ({ action: 'skip', reason });
  const now = (options.now ?? (() => new Date()))();
  if (typeof legacy.id !== 'string' || !legacy.id) return skip('invalid-document-id');
  if (legacy.draftId !== undefined && legacy.draftId !== legacy.id) return skip('inconsistent-draft-id');
  if (typeof legacy.clinicId === 'string' && legacy.clinicId && legacy.clinicId !== options.clinicId) return skip('other-clinic');
  if (!Array.isArray(legacy.entries) || legacy.entries.length === 0) return skip('empty');
  const updatedAt = toIso(legacy.updatedAt);
  if (options.since && (!updatedAt || new Date(updatedAt) < options.since)) return skip(updatedAt ? 'older-than-since' : 'no-timestamp');
  const patientId = legacy.patientId;
  if (typeof patientId !== 'string' || !ID.test(patientId)) return skip('invalid-patient-id');
  // The only draft id the current UI can read back is profile-treatment-<patient>-<consultation|pending>.
  const prefix = `profile-treatment-${patientId}-`;
  if (!legacy.id.startsWith(prefix)) return skip('unreachable-draft-id');
  const suffix = legacy.id.slice(prefix.length);
  const consultationId = suffix === 'pending' ? undefined : suffix;
  if (consultationId && !ID.test(consultationId)) return skip('unreachable-draft-id');
  if ((legacy.consultationId || undefined) !== undefined && legacy.consultationId !== consultationId) return skip('inconsistent-consultation');
  const entries = sanitizeEntries(legacy.entries, updatedAt ?? now.toISOString());
  if (!entries) return skip('invalid-entries');

  const patient = await client.read('Patient', patientId);
  if (!patient) return skip('patient-missing');
  if (!hasIdentifier(patient, CLINIC_SYSTEM, options.clinicId)) {
    return skip(legacy.clinicId ? 'patient-clinic-mismatch' : 'other-clinic');
  }
  let derivedOwner: string | undefined;
  if (consultationId) {
    const encounter = await client.read('Encounter', consultationId);
    if (!encounter) return skip('encounter-missing');
    if (encounter.subject?.reference !== `Patient/${patientId}`) return skip('encounter-patient-mismatch');
    if (!hasIdentifier(encounter, CLINIC_SYSTEM, options.clinicId)) return skip('encounter-clinic-mismatch');
    const practitioners = [...new Set((encounter.participant ?? []).map(p => p.individual?.reference)
      .filter((ref): ref is string => !!ref && /^Practitioner\/[A-Za-z0-9.-]{1,64}$/.test(ref)))];
    if (practitioners.length > 1 && !options.owners?.[legacy.id]) return skip('owner-ambiguous');
    derivedOwner = practitioners[0];
  }
  const mapped = options.owners?.[legacy.id];
  if (mapped !== undefined && !ID.test(mapped)) return skip('invalid-owner-map-entry');
  const practitioner = mapped ? `Practitioner/${mapped}` : derivedOwner;
  if (!practitioner) return skip('owner-unresolved');
  const owner = await client.read('Practitioner', practitioner.split('/')[1]);
  if (!owner || owner.active === false) return skip('owner-missing-or-inactive');

  const key = draftKey(options.clinicId, practitioner, patientId, consultationId, legacy.id);
  const source = sourceHash(legacy.id);
  const resource = buildResource({ clinicId: options.clinicId, key, source, patientId, practitioner, consultationId,
    date: updatedAt ?? now.toISOString(), entries });
  const patientAccounts = accountRefs(patient);
  const targets = await client.search('DocumentReference', { identifier: `${KEY_SYSTEM}|${key}` });
  if (targets.length > 1) return skip('target-ambiguous');
  const target = targets[0];
  if (!target) return { action: 'create', reason: 'new', key, resource, patientAccounts };
  if (target.subject?.reference !== resource.subject?.reference || target.author?.length !== 1 ||
      target.author[0].reference !== practitioner || !hasIdentifier(target, CLINIC_SYSTEM, options.clinicId)) {
    return skip('target-conflict');
  }
  if (hasIdentifier(target, ROLLED_BACK_SYSTEM, source) && target.status === 'superseded') {
    return { action: 'restore', reason: 'previously-rolled-back', key, resource, existing: target, patientAccounts };
  }
  if (hasIdentifier(target, MIGRATED_SYSTEM, source)) {
    return skip(target.status === 'current' ? 'already-migrated' : 'target-cleared-by-user');
  }
  // Anything else was written by the application after rollout: the clinician's newer work always wins.
  return skip(target.status === 'current' ? 'target-has-newer-draft' : 'target-cleared-by-user');
}

function rolledBack(doc: Resource, source: string): Resource {
  return {
    ...doc, status: 'superseded',
    identifier: [...(doc.identifier ?? []).filter(i => i.system !== MIGRATED_SYSTEM && i.system !== ROLLED_BACK_SYSTEM),
      { system: MIGRATED_SYSTEM, value: source }, { system: ROLLED_BACK_SYSTEM, value: source }],
    content: [{ attachment: { contentType: 'application/json', data: EMPTY_JSON_BASE64 } }],
  };
}

export class AbortRun extends Error {}

/**
 * Plans every legacy draft and, with options.apply, writes the planned ones.
 * Never updates or deletes a document the application wrote. Aborts the whole run (after undoing that
 * one document) if the server does not place a migrated draft in the patient's clinic account.
 */
export async function migrate(client: FhirClient, drafts: LegacyDraft[], options: Options): Promise<{ outcomes: Outcome[]; manifest: ManifestEntry[]; aborted?: string }> {
  const outcomes: Outcome[] = [];
  const manifest: ManifestEntry[] = [];
  const seen = new Set<string>();
  let written = 0;
  for (const legacy of drafts) {
    const legacyId = typeof legacy?.id === 'string' ? legacy.id : '';
    const source = sourceHash(legacyId);
    const base = { source, legacyId };
    if (seen.has(legacyId)) { outcomes.push({ ...base, action: 'skip', reason: 'duplicate-in-export' }); continue; }
    seen.add(legacyId);
    const planned: Planned = await planDraft(client, legacy, options)
      .catch(() => ({ action: 'error' as const, reason: 'lookup-failed' }));
    if (!('resource' in planned)) { outcomes.push({ ...base, ...planned }); continue; }
    const outcome: Outcome = { ...base, action: planned.action, reason: planned.reason, key: planned.key, applied: false };
    outcomes.push(outcome);
    if (!options.apply) continue;
    if (options.limit !== undefined && written >= options.limit) { outcome.reason = 'limit-reached'; continue; }
    try {
      let saved: Resource;
      if (planned.action === 'create') {
        saved = await client.create(planned.resource, `identifier=${KEY_SYSTEM}|${planned.key}`);
        // If-None-Exist returned somebody else's document: a clinician saved a draft between plan and write.
        if (!hasIdentifier(saved, MIGRATED_SYSTEM, source) ||
            saved.content?.[0]?.attachment.data !== planned.resource.content?.[0]?.attachment.data) {
          outcome.action = 'skip'; outcome.reason = 'target-has-newer-draft'; continue;
        }
      } else {
        const existing = planned.existing!;
        saved = await client.update({ ...planned.resource, id: existing.id, meta: existing.meta }, existing.meta?.versionId ?? '');
      }
      if (!saved.id || !saved.meta?.versionId) throw new Error('write returned no id/version');
      written++;
      outcome.applied = true; outcome.documentReferenceId = saved.id; outcome.versionId = saved.meta.versionId;
      const entry = { source, key: planned.key, documentReferenceId: saved.id, versionId: saved.meta.versionId };
      const fresh = await client.read('DocumentReference', saved.id);
      if (!fresh || !sameSet(accountRefs(fresh), planned.patientAccounts)) {
        // The owner could not see this draft through the clinic policy, or it would sit outside the clinic. Undo and stop.
        try {
          await client.update(rolledBack(fresh ?? saved, source), (fresh ?? saved).meta?.versionId ?? '');
          outcome.reason = 'clinic-account-mismatch-undone';
        } catch {
          outcome.reason = 'clinic-account-mismatch-UNDO-FAILED';
          manifest.push(entry);
        }
        outcome.action = 'error';
        return { outcomes, manifest, aborted: outcome.reason };
      }
      manifest.push(entry);
    } catch (error) {
      outcome.action = 'error';
      outcome.reason = error instanceof PreconditionError ? 'target-changed-during-write' : 'write-failed';
    }
  }
  return { outcomes, manifest };
}

export type RollbackOutcome = { source: string; documentReferenceId: string; action: 'rollback' | 'skip' | 'error'; reason: string; applied?: boolean };

/**
 * Undoes exactly what one apply run wrote, using its manifest. A draft a clinician has edited or cleared
 * since is theirs and is left alone. The undo is the application's own "cleared draft" state.
 */
export async function rollback(client: FhirClient, manifest: Manifest, options: { clinicId: string; apply?: boolean }): Promise<RollbackOutcome[]> {
  if (manifest.format !== MANIFEST_FORMAT) throw new SafeError('Unrecognised manifest format');
  if (manifest.clinicId !== options.clinicId) throw new SafeError('Manifest belongs to a different clinic');
  const outcomes: RollbackOutcome[] = [];
  for (const entry of manifest.entries) {
    const base = { source: entry.source, documentReferenceId: entry.documentReferenceId };
    try {
      const doc = await client.read('DocumentReference', entry.documentReferenceId);
      if (!doc) { outcomes.push({ ...base, action: 'skip', reason: 'already-gone' }); continue; }
      if (!hasIdentifier(doc, KEY_SYSTEM, entry.key) || !hasIdentifier(doc, CLINIC_SYSTEM, options.clinicId)) {
        outcomes.push({ ...base, action: 'error', reason: 'not-the-recorded-draft' }); continue;
      }
      if (hasIdentifier(doc, ROLLED_BACK_SYSTEM, entry.source)) { outcomes.push({ ...base, action: 'skip', reason: 'already-rolled-back' }); continue; }
      if (!hasIdentifier(doc, MIGRATED_SYSTEM, entry.source) || doc.meta?.versionId !== entry.versionId || doc.status !== 'current') {
        outcomes.push({ ...base, action: 'skip', reason: 'changed-by-clinician-kept' }); continue;
      }
      if (!options.apply) { outcomes.push({ ...base, action: 'rollback', reason: 'unmodified', applied: false }); continue; }
      await client.update(rolledBack(doc, entry.source), entry.versionId);
      outcomes.push({ ...base, action: 'rollback', reason: 'unmodified', applied: true });
    } catch (error) {
      outcomes.push(error instanceof PreconditionError
        ? { ...base, action: 'skip', reason: 'changed-by-clinician-kept' }
        : { ...base, action: 'error', reason: 'rollback-failed' });
    }
  }
  return outcomes;
}

export function parseExport(raw: unknown): ExportFile {
  const file = raw as ExportFile;
  if (!file || file.format !== EXPORT_FORMAT || file.collection !== LEGACY_COLLECTION || !Array.isArray(file.drafts) ||
      file.count !== file.drafts.length) {
    throw new SafeError('Not a complete legacy treatment-draft export');
  }
  return file;
}
export function summarize(outcomes: { action: string; reason: string; applied?: boolean }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of outcomes) {
    const label = `${o.action}:${o.reason}${o.applied ? ' (written)' : ''}`;
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/** Only local dev Medplum unless the operator names the exact remote https host on the command line. */
export function assertAllowedBaseUrl(baseUrl: string, allowRemoteHost?: string): URL {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new SafeError('MEDPLUM_BASE_URL is not a URL'); }
  if (url.username || url.password || url.search || url.hash) throw new SafeError('MEDPLUM_BASE_URL must not carry credentials or a query');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port === '8113';
  if (local) return url;
  if (!allowRemoteHost || url.protocol !== 'https:' || url.hostname !== allowRemoteHost) {
    throw new SafeError('Refusing a non-local Medplum: pass --allow-remote-host with the exact https hostname of MEDPLUM_BASE_URL');
  }
  return url;
}
