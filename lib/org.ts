export interface OrganizationDetails {
  logoUrl?: string | null;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
}

export async function fetchOrganizationDetails(): Promise<OrganizationDetails | null> {
  try {
    const response = await fetch("/api/organization", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data?.success) {
      return null;
    }
    return data.organization ?? null;
  } catch (error) {
    console.error("Failed to fetch organization details:", error);
    return null;
  }
}

/**
 * Letterhead details for a printable document. The page loads the organization
 * in an effect, so a document opened before that fetch finished (or after it
 * failed) must fetch it itself instead of printing a blank letterhead.
 */
export async function resolveOrganizationDetails(
  current: OrganizationDetails | null,
  fetcher: () => Promise<OrganizationDetails | null> = fetchOrganizationDetails
): Promise<OrganizationDetails | null> {
  return current ?? (await fetcher());
}

export async function saveOrganizationDetails(details: OrganizationDetails): Promise<void> {
  const response = await fetch("/api/organization", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(details),
  });

  const data = await response.json();
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || "Failed to save organization details");
  }
}
