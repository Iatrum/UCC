# Task 613
Composer showed "No matches" while lazily loaded catalogs were fetching: the workspace never passed `loadingCatalog`. Added `catalogsLoading` state (cleared in finally), pure helper `lib/orders/catalog-search-state.ts`, and composer now shows "Loading…" instead of "No matches" until loaded. Catalog fetches are unchanged, so results stay clinic-scoped.
