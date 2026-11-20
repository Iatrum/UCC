// Small in-memory MedplumClient mock for service-level unit tests (Task 639). Fake data only.
// Supports exactly what the clinic-tenancy / triage / scheduling / appointment services call:
// readResource, searchResources, searchOne, createResource, updateResource, post ($set-accounts).
// Deterministic: ids are sequential, no clock access.
import { OperationOutcomeError, notFound, type MedplumClient } from '@medplum/core';

export const CLINIC_A = 'fake-clinic-a';
export const CLINIC_B = 'fake-clinic-b';

type Res = { resourceType: string; id?: string; [k: string]: any };

/** Organization + account HealthcareService for a clinic, so resolveClinicTenant succeeds. */
export function tenantResources(clinicId: string): Res[] {
  const identifier = [{ system: 'clinic', value: clinicId }];
  return [
    { resourceType: 'Organization', id: `org-${clinicId}`, identifier },
    { resourceType: 'HealthcareService', id: `acct-${clinicId}`, identifier },
  ];
}

/**
 * `versioning: true` (Task 643) stamps meta.versionId on create/update and enforces a single-resource
 * `If-Match` header (412 on mismatch), like Medplum 5.2.8. Off by default so Task 639 tests keep exact shapes.
 */
export function createMockMedplum(initial: Res[] = [], opts: { versioning?: boolean } = {}) {
  const db = new Map<string, Res>(initial.map((r) => [`${r.resourceType}/${r.id}`, r]));
  const writes: { op: 'create' | 'update' | 'post' | 'delete'; resource?: Res; path?: string; body?: any }[] = [];
  let seq = 0;
  const searches: { type: string; params: [string, string][] }[] = [];

  // Task 702: a string query may repeat a param (identifier=a&identifier=b is AND). Object params stay single-valued.
  const parseQuery = (q: string | Record<string, string>): [string, string][] =>
    typeof q === 'string' ? [...new URLSearchParams(q).entries()] : Object.entries(q);
  const refIds = (r: Res) =>
    [r.managingOrganization?.reference, ...(r.meta?.compartment ?? []).map((c: any) => c.reference), ...[r.meta?.account].flat().map((a: any) => a?.reference)].filter(Boolean);

  const matches = (r: Res, params: [string, string][]) => {
    for (const [key, value] of params) {
      if (key === '_compartment') {
        if (!value.split(',').some((v) => refIds(r).includes(v))) return false;
        continue;
      }
      if (key.startsWith('_')) continue;
      if (key === 'identifier') {
        const [system, val] = value.split('|');
        if (!r.identifier?.some((i: any) => i.system === system && (!val || i.value === val))) return false;
      } else if (key === 'organization') {
        if (!value.split(',').includes(r.managingOrganization?.reference)) return false;
      } else if (key === 'subject') {
        if (r.subject?.reference !== value) return false;
      } else if (key === 'schedule') {
        if (r.schedule?.reference !== value) return false;
      } else if (key === 'status') {
        if (!value.split(',').includes(r.status)) return false;
      } else if (key === 'context') {
        if (r.context?.reference !== value) return false;
      } else if (key === 'date') {
        // Appointment `ge<iso>` only. FHIR period semantics: matches when the period ends at/after the value.
        if (value.startsWith('ge') && !((r.end ?? r.start ?? '') >= value.slice(2))) return false;
      } else {
        throw new Error(`mock-medplum: unsupported search param ${key}`);
      }
    }
    return true;
  };

  const client = {
    async readResource(type: string, id: string) {
      const r = db.get(`${type}/${id}`);
      if (!r) throw new OperationOutcomeError(notFound);
      return structuredClone(r);
    },
    async searchResources(type: string, query: string | Record<string, string> = {}) {
      const params = parseQuery(query);
      const get = (k: string) => params.find(([key]) => key === k)?.[1];
      searches.push({ type, params });
      const all = [...db.values()].filter((r) => r.resourceType === type && matches(r, params));
      const offset = Number(get('_offset') ?? 0);
      return structuredClone(all.slice(offset, offset + Number(get('_count') ?? 20)));
    },
    async searchOne(type: string, params: Record<string, string> = {}) {
      return (await client.searchResources(type, { ...params, _count: '1' }))[0];
    },
    async createResource(resource: Res) {
      const created = { ...structuredClone(resource), id: resource.id ?? `${resource.resourceType.toLowerCase()}-${++seq}` };
      if (opts.versioning) created.meta = { ...(created.meta ?? {}), versionId: '1' };
      db.set(`${created.resourceType}/${created.id}`, created);
      writes.push({ op: 'create', resource: structuredClone(created) });
      return structuredClone(created);
    },
    async updateResource(resource: Res, options?: { headers?: Record<string, string> }) {
      const key = `${resource.resourceType}/${resource.id}`;
      let saved = structuredClone(resource);
      if (opts.versioning) {
        const cur = db.get(key);
        const wanted = options?.headers?.['If-Match'];
        if (wanted && cur && `W/"${cur.meta?.versionId}"` !== wanted) throw new Error('412 Precondition Failed');
        saved = { ...saved, meta: { ...(saved.meta ?? {}), versionId: String(Number(cur?.meta?.versionId ?? 0) + 1) } };
      }
      db.set(key, saved);
      writes.push({ op: 'update', resource: structuredClone(saved) });
      return structuredClone(saved);
    },
    /** FHIR conditional create; every `identifier=system|value` param must match (AND). */
    async createResourceIfNoneExist(resource: Res, query: string) {
      const wanted = query.split('&').map((q) => q.replace('identifier=', '').split('|'));
      const hit = [...db.values()].find(
        (r) =>
          r.resourceType === resource.resourceType &&
          wanted.every(([sys, val]) => r.identifier?.some((i: any) => i.system === sys && i.value === val))
      );
      return hit ? structuredClone(hit) : client.createResource(resource);
    },
    async deleteResource(type: string, id: string) {
      db.delete(`${type}/${id}`);
      writes.push({ op: 'delete', resource: { resourceType: type, id } });
    },
    async post(path: string, body: any) {
      writes.push({ op: 'post', path, body: structuredClone(body) });
      return {};
    },
  };

  return {
    client: client as unknown as MedplumClient,
    db,
    writes,
    searches,
    creates: (type?: string) => writes.filter((w) => w.op === 'create' && (!type || w.resource!.resourceType === type)).map((w) => w.resource!),
    updates: (type?: string) => writes.filter((w) => w.op === 'update' && (!type || w.resource!.resourceType === type)).map((w) => w.resource!),
    stored: (type: string, id: string) => db.get(`${type}/${id}`),
  };
}
