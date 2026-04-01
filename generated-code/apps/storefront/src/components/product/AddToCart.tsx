'use client';

import { useState } from 'react';
import { Product } from '@/types/product';

interface AddToCartProps {
  product: Product;
}

export function AddToCart({ product }: AddToCartProps) {
  const [quantity, setQuantity] = useState<number>(1);
  const [isAdding, setIsAdding] = useState<boolean>(false);

  // Calculate current price based on B2B tiers
  const currentPrice = product.b2bTiers?.reduce((acc, tier) => {
    if (quantity >= tier.minQuantity) return tier.price;
    return acc;
  }, product.price) ?? product.price;

  const handleAddToCart = async () => {
    setIsAdding(true);
    // Simulate API call to Cart Service (Go)
    await new Promise((resolve) => setTimeout(resolve, 600));
    // TODO: Integrate with Zustand cart store
    setIsAdding(false);
    alert(`Added ${quantity}x ${product.name} to cart!`);
  };

  return (
    <div className="flex flex-col gap-6 mt-6">
      <div className="flex items-center gap-4">
        <label htmlFor="quantity" className="text-sm font-medium text-zinc-900">
          Quantity
        </label>
        <div className="flex items-center border border-zinc-300 rounded-md">
          <button
            type="button"
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            className="px-3 py-1 text-zinc-600 hover:bg-zinc-100 transition-colors rounded-l-md"
            disabled={quantity <= 1}
          >
            -
          </button>
          <input
            type="number"
            id="quantity"
            min="1"
            max={product.stockQuantity}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-16 text-center py-1 border-x border-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
          <button
            type="button"
            onClick={() => setQuantity(Math.min(product.stockQuantity, quantity + 1))}
            className="px-3 py-1 text-zinc-600 hover:bg-zinc-100 transition-colors rounded-r-md"
            disabled={quantity >= product.stockQuantity}
          >
            +
          </button>
        </div>
        <span className="text-sm text-zinc-500">
          {product.stockQuantity} available
        </span>
      </div>

      <div className="flex items-center justify-between py-4 border-t border-zinc-200">
        <div className="flex flex-col">
          <span className="text-sm text-zinc-500">Total Price</span>
          <span className="text-2xl font-bold text-zinc-900">
            ${(currentPrice * quantity).toFixed(2)}
          </span>
        </div>
        <button
          onClick={handleAddToCart}
          disabled={!product.inStock || isAdding}
          className={`px-8 py-3 rounded-md font-semibold text-white transition-colors ${
            !product.inStock
              ? 'bg-zinc-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
          }`}
        >
          {isAdding ? 'Adding...' : product.inStock ? 'Add to Cart' : 'Out of Stock'}
        </button>
      </div>
    </div>
  );
}
