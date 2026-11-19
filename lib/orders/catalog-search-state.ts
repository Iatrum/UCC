export type CatalogSearchState = "idle" | "loading" | "empty" | "results";

/**
 * Decide what the composer search results area shows.
 * While catalogs are still loading, an empty result list must NOT read as
 * "no matches" (Task 613) — show a loading state instead.
 */
export function getCatalogSearchState(input: {
  loading: boolean;
  query: string;
  resultCount: number;
}): CatalogSearchState {
  if (input.resultCount > 0) return "results";
  if (input.loading) return "loading";
  return input.query.trim() ? "empty" : "idle";
}
