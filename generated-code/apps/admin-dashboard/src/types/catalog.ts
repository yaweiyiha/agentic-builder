export type ProductStatus = 'DRAFT' | 'PUBLISHED' | 'SCHEDULED';

export interface Vendor {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  status: ProductStatus;
  vendor: Vendor;
  createdAt: string;
}

export interface PaginatedProducts {
  items: Product[];
  total: number;
  page: number;
  totalPages: number;
}

export interface GetProductsVariables {
  page: number;
  limit: number;
  search?: string;
  status?: ProductStatus;
}
