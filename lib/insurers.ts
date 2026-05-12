export interface Insurer {
  id?: string;
  name: string;
  value: string;
  createdAt?: string;
  updatedAt?: string;
}

async function readJson(response: Response): Promise<any> {
  return response.json().catch(() => null);
}

function assertSuccess(data: any, fallback: string): void {
  if (!data?.success) {
    throw new Error(data?.error || fallback);
  }
}

export async function fetchInsurers(): Promise<Insurer[]> {
  const response = await fetch("/api/settings/insurers", { cache: "no-store" });
  const data = await readJson(response);
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || "Failed to load insurers");
  }
  return data.insurers ?? [];
}

export async function addInsurer(insurer: Omit<Insurer, "id">): Promise<string> {
  const response = await fetch("/api/settings/insurers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(insurer),
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(data?.error || "Failed to add insurer");
  }
  assertSuccess(data, "Failed to add insurer");
  return data.insurer.id;
}

export async function updateInsurer(id: string, insurer: Partial<Omit<Insurer, "id">>): Promise<void> {
  const response = await fetch("/api/settings/insurers", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...insurer }),
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(data?.error || "Failed to update insurer");
  }
  assertSuccess(data, "Failed to update insurer");
}

export async function deleteInsurer(id: string): Promise<void> {
  const response = await fetch(`/api/settings/insurers?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(data?.error || "Failed to delete insurer");
  }
  assertSuccess(data, "Failed to delete insurer");
}
