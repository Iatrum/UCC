export interface ProcedureItem {
  id: string;
  name: string;
  codingSystem?: string;
  codingCode?: string;
  codingDisplay?: string;
  category?: string;
  defaultPrice: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

async function proceduresFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? `Procedure request failed (${res.status})`);
  }
  return res.json();
}

export async function getProcedures(): Promise<ProcedureItem[]> {
  try {
    const data = await proceduresFetch('/api/procedures');
    return data.procedures ?? [];
  } catch {
    return [];
  }
}

export async function getProcedureById(id: string): Promise<ProcedureItem | null> {
  try {
    const data = await proceduresFetch(`/api/procedures?id=${encodeURIComponent(id)}`);
    return data.procedure ?? null;
  } catch {
    return null;
  }
}

export async function createProcedure(
  data: Omit<ProcedureItem, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const result = await proceduresFetch('/api/procedures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return result.procedureId;
}

export async function updateProcedure(id: string, data: Partial<ProcedureItem>): Promise<void> {
  await proceduresFetch('/api/procedures', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ procedureId: id, ...data }),
  });
}

export async function deleteProcedure(id: string): Promise<void> {
  await proceduresFetch(`/api/procedures?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}
