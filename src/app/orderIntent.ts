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

/**
 * The same one-shot trick, for the owner opening ONE order to look at it.
 *
 * Kept separate from the booker's handoff above rather than sharing a slot:
 * they are different journeys that can both be mid-flight (the owner is a
 * two-role user often enough), and one clearing the other would drop somebody
 * on an empty screen with no way to tell why.
 */
let pendingOrderId: string | null = null;

export function setPendingOrder(orderId: string): void {
  pendingOrderId = orderId;
}

export function consumePendingOrder(): string | null {
  const id = pendingOrderId;
  pendingOrderId = null;
  return id;
}
