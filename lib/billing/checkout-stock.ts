// Pure checkout stock helpers (Task 504). No I/O, safe for client components and unit tests.
// Mirrors the server's matching in lib/fhir/dispense-service.ts (inventoryCandidates, dispensedUnits)
// so the checkout screen predicts what POST /api/billing will deduct. It is a read-only preview.

export type StockCatalogItem = { id: string; name: string; strengths?: string[]; stock: number; unit?: string };
export type StockLine = { id: string; name: string; type?: string; quantity: number };
export type LineStock = {
  /** matched: one catalog item; unmatched: none; ambiguous: several (server will not guess). */
  match: "matched" | "unmatched" | "ambiguous";
  unit?: string;
  onHand?: number;
  /** Units the whole bill takes from this medicine (lines of the same medicine are summed). */
  needed?: number;
  /** True when on-hand stock is below what the bill will deduct (stock would go negative). */
  low?: boolean;
};

const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
const wholeUnits = (q: number) => (Number.isFinite(q) && q > 0 ? Math.ceil(q) : 0);

function candidates(name: string, catalog: StockCatalogItem[]): StockCatalogItem[] {
  const target = norm(name);
  if (!target) return [];
  return catalog.filter((med) => {
    const base = norm(med.name);
    if (!base) return false;
    if (base === target) return true;
    return (med.strengths ?? []).some((s) => norm(`${base} ${s}`) === target);
  });
}

/** Stock preview per medicine line (only `Item` lines touch stock). Keyed by line id. */
export function computeLineStock(lines: StockLine[], catalog: StockCatalogItem[]): Map<string, LineStock> {
  const result = new Map<string, LineStock>();
  const demand = new Map<string, number>();
  const matched: Array<{ line: StockLine; item: StockCatalogItem; units: number }> = [];
  for (const line of lines) {
    if (line.type && line.type !== "Item") continue;
    const units = wholeUnits(Number(line.quantity));
    if (units === 0) continue;
    const hits = candidates(line.name, catalog);
    if (hits.length === 1) {
      demand.set(hits[0].id, (demand.get(hits[0].id) ?? 0) + units);
      matched.push({ line, item: hits[0], units });
    } else {
      result.set(line.id, { match: hits.length > 1 ? "ambiguous" : "unmatched" });
    }
  }
  for (const { line, item } of matched) {
    const needed = demand.get(item.id) ?? 0;
    result.set(line.id, { match: "matched", unit: item.unit, onHand: item.stock, needed, low: item.stock < needed });
  }
  return result;
}

export type CheckoutStockNotice = {
  title: string;
  lines: string[];
  /** true when staff must act (deduction failed or a line could not be matched). */
  severe: boolean;
};

/** Staff-facing stock feedback from the POST /api/billing response. Null when there is nothing to say. */
export function buildStockNotice(payload: {
  stockNegative?: unknown;
  stockUnresolved?: unknown;
  stockError?: unknown;
}): CheckoutStockNotice | null {
  const names = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const negative = names(payload.stockNegative);
  const unresolved = names(payload.stockUnresolved);
  const error = typeof payload.stockError === "string" && payload.stockError ? payload.stockError : "";
  const lines: string[] = [];
  if (error) lines.push(`Stock was not deducted: ${error}. Check Inventory and re-run checkout.`);
  if (unresolved.length) {
    lines.push(
      `Could not match to exactly one stock item (stock not changed): ${unresolved.join(", ")}. Fix the catalog name, then re-run checkout.`
    );
  }
  if (negative.length) lines.push(`Stock is now negative for: ${negative.join(", ")}. Check Inventory.`);
  if (!lines.length) return null;
  return { title: "Invoice saved, but check stock", lines, severe: Boolean(error || unresolved.length) };
}

export const CHECKOUT_NOTICE_STORAGE_KEY = "ucc.checkoutStockNotice";
