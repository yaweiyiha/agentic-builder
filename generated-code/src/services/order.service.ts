import { db } from "@/lib/db";
import type { Order } from "@/types/order";

function assertValidOrderPayload(data: Order): void {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid order payload: expected an object.");
  }

  const maybeOrder = data as unknown as Record<string, unknown>;

  if ("id" in maybeOrder && !maybeOrder.id) {
    throw new Error("Invalid order payload: id cannot be empty.");
  }

  if ("items" in maybeOrder && Array.isArray(maybeOrder.items) && maybeOrder.items.length === 0) {
    throw new Error("Invalid order payload: items cannot be empty.");
  }
}

export async function createOrder(data: Order): Promise<Order> {
  assertValidOrderPayload(data);

  const payload = data as unknown as Record<string, unknown>;

  if ("id" in payload) {
    delete payload.id;
  }
  if ("createdAt" in payload) {
    delete payload.createdAt;
  }
  if ("updatedAt" in payload) {
    delete payload.updatedAt;
  }

  const created = await db.order.create({
    data: payload,
  });

  return created as Order;
}
