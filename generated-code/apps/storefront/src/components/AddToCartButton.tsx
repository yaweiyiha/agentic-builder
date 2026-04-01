'use client';

import { useState } from 'react';
import { useCartStore } from '../store/cartStore';

interface AddToCartButtonProps {
  productId: string;
  variantId?: string;
  name: string;
  price: number;
  imageUrl?: string;
  disabled?: boolean;
  className?: string;
}

export function AddToCartButton({
  productId,
  variantId,
  name,
  price,
  imageUrl,
  disabled = false,
  className = '',
}: AddToCartButtonProps) {
  const addItem = useCartStore((state) => state.addItem);
  const [isAdding, setIsAdding] = useState(false);

  const handleAddToCart = async () => {
    if (disabled || isAdding) return;

    setIsAdding(true);
    try {
      await addItem({
        productId,
        variantId,
        name,
        price,
        quantity: 1,
        imageUrl,
      });
    } catch (error) {
      console.error('Failed to add item to cart:', error);
      // TODO: Dispatch error toast notification
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <button
      onClick={handleAddToCart}
      disabled={disabled || isAdding}
      className={`
        relative flex items-center justify-center gap-2 px-6 py-3
        bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md
        transition-all duration-200 ease-in-out
        disabled:bg-zinc-300 disabled:text-zinc-500 disabled:cursor-not-allowed
        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
        ${className}
      `}
      aria-label={`Add ${name} to cart`}
    >
      {isAdding ? (
        <>
          <svg 
            className="w-5 h-5 animate-spin text-white" 
            xmlns="http://www.w3.org/2000/svg" 
            fill="none" 
            viewBox="0 0 24 24"
          >
            <circle 
              className="opacity-25" 
              cx="12" 
              cy="12" 
              r="10" 
              stroke="currentColor" 
              strokeWidth="4"
            />
            <path 
              className="opacity-75" 
              fill="currentColor" 
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Adding...</span>
        </>
      ) : (
        <>
          <svg 
            className="w-5 h-5" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 0a2 2 0 100 4 2 2 0 000-4z" 
            />
          </svg>
          <span>Add to Cart</span>
        </>
      )}
    </button>
  );
}
