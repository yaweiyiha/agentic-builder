import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Plus, AlertCircle } from 'lucide-react';

export interface PricingTier {
  id: string;
  minQty: number;
  price: number;
  customerGroupId: string; // empty string means 'All/Default'
}

export interface CustomerGroup {
  id: string;
  name: string;
}

interface B2BPricingMatrixProps {
  basePrice: number;
  tiers: PricingTier[];
  customerGroups: CustomerGroup[];
  onChange: (tiers: PricingTier[]) => void;
}

export const B2BPricingMatrix: React.FC<B2BPricingMatrixProps> = ({
  basePrice,
  tiers,
  customerGroups,
  onChange,
}) => {
  const handleAddTier = () => {
    const newTier: PricingTier = {
      id: crypto.randomUUID(),
      minQty: 10,
      price: basePrice > 0 ? Number((basePrice * 0.9).toFixed(2)) : 0,
      customerGroupId: '',
    };
    onChange([...tiers, newTier]);
  };

  const handleRemoveTier = (id: string) => {
    onChange(tiers.filter((t) => t.id !== id));
  };

  const handleChange = (id: string, field: keyof PricingTier, value: string | number) => {
    onChange(
      tiers.map((t) => {
        if (t.id === id) {
          return { ...t, [field]: value };
        }
        return t;
      })
    );
  };

  // Validation: Check for overlapping minQty within the same customer group
  const errors = useMemo(() => {
    const errs: Record<string, string> = {};
    const seen = new Map<string, Set<number>>();

    tiers.forEach((tier) => {
      const key = tier.customerGroupId || 'default';
      if (!seen.has(key)) {
        seen.set(key, new Set());
      }
      
      const groupSet = seen.get(key)!;
      if (groupSet.has(tier.minQty)) {
        errs[tier.id] = 'Duplicate quantity tier for this group.';
      } else {
        groupSet.add(tier.minQty);
      }
    });

    return errs;
  }, [tiers]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-zinc-900">B2B Volume Pricing</h3>
          <p className="text-sm text-zinc-600">Set volume-based discounts and group-specific pricing.</p>
        </div>
        <button
          type="button"
          onClick={handleAddTier}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Tier
        </button>
      </div>

      <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4">
        {tiers.length === 0 ? (
          <div className="text-center py-8 text-zinc-500">
            <p>No pricing tiers configured.</p>
            <p className="text-sm mt-1">Click "Add Tier" to create volume discounts.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Header row for desktop */}
            <div className="hidden md:grid md:grid-cols-12 gap-4 px-2 text-sm font-medium text-zinc-600">
              <div className="col-span-4">Customer Group</div>
              <div className="col-span-3">Minimum Quantity</div>
              <div className="col-span-4">Unit Price ($)</div>
              <div className="col-span-1 text-center">Actions</div>
            </div>

            <AnimatePresence initial={false}>
              {tiers.map((tier) => {
                const hasError = !!errors[tier.id];

                return (
                  <motion.div
                    key={tier.id}
                    initial={{ opacity: 0, height: 0, y: -10 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="relative"
                  >
                    <div
                      className={`grid grid-cols-1 md:grid-cols-12 gap-4 items-start p-3 bg-white rounded-md border ${
                        hasError ? 'border-red-300 ring-1 ring-red-300' : 'border-zinc-200'
                      } shadow-sm`}
                    >
                      {/* Customer Group */}
                      <div className="col-span-1 md:col-span-4 space-y-1">
                        <label className="block text-xs font-medium text-zinc-600 md:hidden">
                          Customer Group
                        </label>
                        <select
                          value={tier.customerGroupId}
                          onChange={(e) => handleChange(tier.id, 'customerGroupId', e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                          <option value="">All Customers (Default)</option>
                          {customerGroups.map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Minimum Quantity */}
                      <div className="col-span-1 md:col-span-3 space-y-1">
                        <label className="block text-xs font-medium text-zinc-600 md:hidden">
                          Min Qty
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={tier.minQty}
                          onChange={(e) => handleChange(tier.id, 'minQty', parseInt(e.target.value, 10) || 0)}
                          className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                            hasError ? 'border-red-300 text-red-900' : 'border-zinc-300'
                          }`}
                        />
                      </div>

                      {/* Price */}
                      <div className="col-span-1 md:col-span-4 space-y-1">
                        <label className="block text-xs font-medium text-zinc-600 md:hidden">
                          Unit Price ($)
                        </label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <span className="text-zinc-500 sm:text-sm">$</span>
                          </div>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={tier.price}
                            onChange={(e) => handleChange(tier.id, 'price', parseFloat(e.target.value) || 0)}
                            className="w-full pl-7 pr-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="col-span-1 md:col-span-1 flex justify-end md:justify-center items-center pt-6 md:pt-1">
                        <button
                          type="button"
                          onClick={() => handleRemoveTier(tier.id)}
                          className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                          aria-label="Remove tier"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Error Message */}
                    <AnimatePresence>
                      {hasError && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-1 flex items-center gap-1 text-sm text-red-600 px-1"
                        >
                          <AlertCircle className="w-4 h-4" />
                          <span>{errors[tier.id]}</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};
