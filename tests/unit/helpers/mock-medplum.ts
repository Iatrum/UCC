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

export function createMockMedplum(initial: Res[] = []) {
  const db = new Map<string, Res>(initial.map((r) => [`${r.resourceType}/${r.id}`, r]));
  const writes: { op: 'create' | 'update' | 'post'; resource?: Res; path?: string; body?: any }[] = [];
  let seq = 0;

  const matches = (r: Res, params: Record<string, string>) => {
    for (const [key, value] of Object.entries(params)) {
      if (key.startsWith('_')) continue;
      if (key === 'identifier') {
        const [system, val] = value.split('|');
        if (!r.identifier?.some((i: any) => i.system === system && (!val || i.value === val))) return false;
      } else if (key === 'subject') {
        if (r.subject?.reference !== value) return false;
      } else if (key === 'schedule') {
        if (r.schedule?.reference !== value) return false;
      } else if (key === 'status') {
        if (!value.split(',').includes(r.status)) return false;
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
    async searchResources(type: string, params: Record<string, string> = {}) {
      const all = [...db.values()].filter((r) => r.resourceType === type && matches(r, params));
      return structuredClone(all.slice(0, Number(params._count ?? 20)));
    },
    async searchOne(type: string, params: Record<string, string> = {}) {
      return (await client.searchResources(type, { ...params, _count: '1' }))[0];
    },
    async createResource(resource: Res) {
      const created = { ...structuredClone(resource), id: resource.id ?? `${resource.resourceType.toLowerCase()}-${++seq}` };
      db.set(`${created.resourceType}/${created.id}`, created);
      writes.push({ op: 'create', resource: structuredClone(created) });
      return structuredClone(created);
    },
    async updateResource(resource: Res) {
      db.set(`${resource.resourceType}/${resource.id}`, structuredClone(resource));
      writes.push({ op: 'update', resource: structuredClone(resource) });
      return structuredClone(resource);
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
    creates: (type?: string) => writes.filter((w) => w.op === 'create' && (!type || w.resource!.resourceType === type)).map((w) => w.resource!),
    updates: (type?: string) => writes.filter((w) => w.op === 'update' && (!type || w.resource!.resourceType === type)).map((w) => w.resource!),
    stored: (type: string, id: string) => db.get(`${type}/${id}`),
  };
}
