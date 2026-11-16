// Fake MedplumClient for dispense/billing unit tests. Mirrors Medplum 5.2.8 behaviour verified on the dev
// server: If-Match is honoured only as a single-resource request HEADER (never inside Bundle entries),
// searches honour _count/_offset paging, createResourceIfNoneExist is a conditional create.
export function makeFake(initial: any[]) {
  const db = new Map<string, any>(initial.map((r) => [`${r.resourceType}/${r.id}`, r]));
  let seq = 0;
  const bump = (cur: any) => String(Number(cur?.meta?.versionId ?? 0) + 1);
  const api = {
    db,
    writes: 0,
    /** Runs once, right before the next resource write (simulate a competing request). */
    beforeWrite: undefined as undefined | ((type: string) => void),
    /** Fail the Nth next write of this resource type with a non-conflict error. */
    failWrites: { type: '', after: Infinity, count: 0 },
    failConflicts: 0,
    failDelete: false,
    failType: '' as string,
    async readResource(type: string, id: string) {
      const r = db.get(`${type}/${id}`);
      if (!r) throw new Error('not found');
      return structuredClone(r);
    },
    async searchResources(type: string, params: Record<string, string>) {
      let all = [...db.values()].filter((r) => r.resourceType === type);
      const idf = params.identifier;
      if (idf) {
        const [sys, val] = idf.split('|');
        all = all.filter((r) => r.identifier?.some((i: any) => i.system === sys && (!val || i.value === val)));
      }
      if (params.context) all = all.filter((r) => r.context?.reference === params.context);
      const offset = Number(params._offset ?? 0);
      const count = Number(params._count ?? 20);
      return structuredClone(all.slice(offset, offset + count));
    },
    guardWrite(type: string) {
      api.beforeWrite?.(type);
      api.beforeWrite = undefined;
      if (api.failConflicts > 0 && (!api.failType || api.failType === type)) { api.failConflicts -= 1; throw new Error('412 Precondition Failed'); }
      if (type === api.failWrites.type) {
        if (api.failWrites.count >= api.failWrites.after) throw new Error('500 write failed');
        api.failWrites.count += 1;
      }
      api.writes += 1;
    },
    async updateResource(resource: any, options?: any) {
      api.guardWrite(resource.resourceType);
      const key = `${resource.resourceType}/${resource.id}`;
      const cur = db.get(key);
      const m = options?.headers?.['If-Match'];
      if (m && cur && `W/"${cur.meta.versionId}"` !== m) throw new Error('412 Precondition Failed');
      const saved = { ...resource, meta: { ...(resource.meta ?? {}), versionId: bump(cur) } };
      db.set(key, saved);
      return structuredClone(saved);
    },
    async createResourceIfNoneExist(resource: any, query: string) {
      api.guardWrite(resource.resourceType);
      const [, value] = query.replace('identifier=', '').split('|');
      const hit = [...db.values()].find(
        (r) => r.resourceType === resource.resourceType && r.identifier?.some((i: any) => i.value === value)
      );
      if (hit) return structuredClone(hit);
      const id = `d${++seq}`;
      const saved = { ...resource, id, meta: { ...(resource.meta ?? {}), versionId: '1' } };
      db.set(`${resource.resourceType}/${id}`, saved);
      return structuredClone(saved);
    },
    async deleteResource(type: string, id: string) {
      if (api.failDelete) throw new Error('500 delete failed');
      db.delete(`${type}/${id}`);
    },
  };
  return api;
}
