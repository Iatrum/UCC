export interface StockLevel {
  name: string;
  stock: number;
  minimumStock: number;
}

export const BANNER_NAME_LIMIT = 5;

export const isOutOfStock = (m: StockLevel) => m.stock <= 0;
/** "Order soon" = at or below threshold but not yet empty (out-of-stock has its own tile). */
export const isOrderSoon = (m: StockLevel) => m.stock > 0 && m.stock <= m.minimumStock;

export function formatItemCount(n: number): string {
  return `${n} ${n === 1 ? "item" : "items"}`;
}

export function summarizeLowStock<T extends StockLevel>(items: T[]) {
  const orderSoon = items.filter(isOrderSoon);
  const outOfStock = items.filter(isOutOfStock);
  // Banner covers everything at/below threshold, out-of-stock first, so an all-empty clinic still gets alerted.
  const attention = [...outOfStock, ...orderSoon];
  return {
    orderSoon,
    outOfStock,
    inStock: items.length - outOfStock.length,
    attention,
    bannerNames: attention.slice(0, BANNER_NAME_LIMIT).map((m) => m.name),
    moreCount: Math.max(0, attention.length - BANNER_NAME_LIMIT),
    moreFilter: (outOfStock.length > BANNER_NAME_LIMIT ? "Out of stock" : "Order soon") as "Out of stock" | "Order soon",
  };
}

/** Banner verb phrase; out-of-stock items may have no threshold, so don't claim one for them. */
export function lowStockBannerStatus(outOfStockCount: number, orderSoonCount: number): string {
  const total = outOfStockCount + orderSoonCount;
  const verb = total === 1 ? "is" : "are";
  if (orderSoonCount === 0) return `${verb} out of stock.`;
  if (outOfStockCount === 0) return `${verb} at or below the minimum stock threshold.`;
  return `${verb} out of stock or at or below the minimum stock threshold.`;
}
