export interface ProductImage {
  url: string;
  alt: string;
}

export interface B2BPricingTier {
  minQuantity: number;
  price: number;
}

export interface Vendor {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  sku: string;
  price: number;
  currency: string;
  images: ProductImage[];
  vendor: Vendor;
  b2bTiers?: B2BPricingTier[];
  inStock: boolean;
  stockQuantity: number;
}
