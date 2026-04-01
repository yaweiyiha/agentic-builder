import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface CartItem {
  id: string; // Unique line item ID from the Cart Service
  productId: string;
  variantId?: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string;
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  isLoading: boolean;
  
  // Actions
  addItem: (item: Omit<CartItem, 'id'>) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  updateQuantity: (id: string, quantity: number) => Promise<void>;
  clearCart: () => Promise<void>;
  setIsOpen: (isOpen: boolean) => void;
  
  // Computed (Getters)
  getTotalItems: () => number;
  getTotalPrice: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,
      isLoading: false,

      addItem: async (newItem) => {
        set({ isLoading: true });
        try {
          // TODO: Integrate with Go Cart & Checkout Service via Apollo Router
          // const response = await fetch('/api/graphql', { ... });
          
          // Simulating network latency for the headless API
          await new Promise((resolve) => setTimeout(resolve, 400));

          set((state) => {
            const existingItem = state.items.find(
              (item) => 
                item.productId === newItem.productId && 
                item.variantId === newItem.variantId
            );

            if (existingItem) {
              return {
                items: state.items.map((item) =>
                  item.id === existingItem.id
                    ? { ...item, quantity: item.quantity + newItem.quantity }
                    : item
                ),
              };
            }

            // Optimistic ID generation (would normally come from backend)
            const itemWithId = { ...newItem, id: crypto.randomUUID() };
            return { items: [...state.items, itemWithId] };
          });
        } finally {
          // Open the cart drawer automatically when an item is added
          set({ isLoading: false, isOpen: true });
        }
      },

      removeItem: async (id) => {
        set({ isLoading: true });
        try {
          // TODO: API call to remove item from backend cart
          await new Promise((resolve) => setTimeout(resolve, 300));
          
          set((state) => ({
            items: state.items.filter((item) => item.id !== id),
          }));
        } finally {
          set({ isLoading: false });
        }
      },

      updateQuantity: async (id, quantity) => {
        if (quantity <= 0) {
          return get().removeItem(id);
        }
        
        set({ isLoading: true });
        try {
          // TODO: API call to update item quantity in backend cart
          await new Promise((resolve) => setTimeout(resolve, 300));
          
          set((state) => ({
            items: state.items.map((item) =>
              item.id === id ? { ...item, quantity } : item
            ),
          }));
        } finally {
          set({ isLoading: false });
        }
      },

      clearCart: async () => {
        set({ isLoading: true });
        try {
          // TODO: API call to clear backend cart
          await new Promise((resolve) => setTimeout(resolve, 300));
          set({ items: [] });
        } finally {
          set({ isLoading: false });
        }
      },

      setIsOpen: (isOpen) => set({ isOpen }),

      getTotalItems: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0);
      },

      getTotalPrice: () => {
        return get().items.reduce((total, item) => total + item.price * item.quantity, 0);
      },
    }),
    {
      name: 'aerocommerce-cart-storage',
      storage: createJSONStorage(() => localStorage),
      // Omit loading state and UI state from being persisted
      partialize: (state) => ({ items: state.items }),
    }
  )
);
