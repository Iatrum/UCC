export interface ProcedureItem {
  id: string;
  name: string;
  // FHIR coding for CodeableConcept: a single preferred coding entry
  codingSystem?: string; // e.g., http://www.ama-assn.org/go/cpt or http://snomed.info/sct
  codingCode?: string;   // e.g., CPT code or SNOMED code
  codingDisplay?: string; // human-readable
  category?: string;
  defaultPrice: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export async function getProcedures(): Promise<ProcedureItem[]> {
  const response = await fetch('/api/procedures', { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || 'Failed to get procedures');
  }
  return data.procedures ?? [];
}

export async function createProcedure(data: Omit<ProcedureItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const response = await fetch('/api/procedures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || 'Failed to create procedure');
  }
  return payload.procedureId;
}

export async function updateProcedure(id: string, data: Partial<ProcedureItem>): Promise<void> {
  const response = await fetch('/api/procedures', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ procedureId: id, ...data }),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || 'Failed to update procedure');
  }
}

export async function deleteProcedure(id: string): Promise<void> {
  const response = await fetch(`/api/procedures?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const payload = await response.json();
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || 'Failed to delete procedure');
  }
}

export async function getProcedureById(id: string): Promise<ProcedureItem | null> {
  const response = await fetch(`/api/procedures?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(data?.error || 'Failed to get procedure');
  }
  return data.procedure ?? null;
}


