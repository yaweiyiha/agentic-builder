export interface Order {
  id: string;
  customerId: string;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
  totalAmount: number;
  createdAt: Date;
  updatedAt: Date;
}
