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
  return {
    orderSoon,
    outOfStock,
    inStock: items.length - outOfStock.length,
    bannerNames: orderSoon.slice(0, BANNER_NAME_LIMIT).map((m) => m.name),
    moreCount: Math.max(0, orderSoon.length - BANNER_NAME_LIMIT),
  };
}
