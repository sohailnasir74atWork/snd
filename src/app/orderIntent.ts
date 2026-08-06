/**
 * One-shot handoff from the Route tab to the New Order tab: "book an order
 * for the shop I am standing in". Consumed on focus, then cleared.
 */
let pendingShopId: string | null = null;

export function setPendingOrderShop(shopId: string): void {
  pendingShopId = shopId;
}

export function consumePendingOrderShop(): string | null {
  const id = pendingShopId;
  pendingShopId = null;
  return id;
}
