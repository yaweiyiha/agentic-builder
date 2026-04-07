import type { Order } from '../types/order';
import { db } from '../lib/db';

export class OrderServiceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'OrderServiceError';
  }
}

const isNonNullObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const validateOrderInput = (data: Order): void => {
  if (!isNonNullObject(data)) {
    throw new OrderServiceError('Invalid order payload: expected an object.');
  }

  if (Object.keys(data).length === 0) {
    throw new OrderServiceError('Invalid order payload: object cannot be empty.');
  }
};

export const createOrder = async (data: Order): Promise<Order> => {
  validateOrderInput(data);

  try {
    const created = await db.order.create({
      data,
    });

    return created as Order;
  } catch (error) {
    throw new OrderServiceError('Failed to create order.', error);
  }
};
