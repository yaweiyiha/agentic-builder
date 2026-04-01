import React, { useState } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { B2BPricingMatrix, PricingTier, CustomerGroup } from '../components/B2BPricingMatrix';

// Mock data for customer groups (would typically come from an API/React Query)
const MOCK_CUSTOMER_GROUPS: CustomerGroup[] = [
  { id: 'cg_wholesale_1', name: 'Wholesale Tier 1' },
  { id: 'cg_wholesale_2', name: 'Wholesale Tier 2' },
  { id: 'cg_distributor', name: 'Distributors' },
  { id: 'cg_vip', name: 'VIP B2C Customers' },
];

export default function NewProduct() {
  const [title, setTitle] = useState('');
  const [sku, setSku] = useState('');
  const [basePrice, setBasePrice] = useState<number>(0);
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Simulate API call
    try {
      const payload = {
        title,
        sku,
        basePrice,
        pricingTiers,
      };
      console.log('Submitting new product:', payload);
      await new Promise(resolve => setTimeout(resolve, 800));
      // Handle success (e.g., redirect to product list or show toast)
      alert('Product created successfully!');
    } catch (error) {
      console.error('Failed to create product', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button 
            type="button"
            className="p-2 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-full transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Create New Product</h1>
            <p className="text-sm text-zinc-600 mt-1">Add a new product to your catalog and configure pricing.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            {isSubmitting ? 'Saving...' : 'Save Product'}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Info Card */}
        <div className="bg-white shadow-sm border border-zinc-200 rounded-xl p-6">
          <h2 className="text-lg font-medium text-zinc-900 mb-4">Basic Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="title" className="block text-sm font-medium text-zinc-700">
                Product Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Industrial Coffee Machine"
                className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="sku" className="block text-sm font-medium text-zinc-700">
                SKU <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="sku"
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="e.g. ICM-2000"
                className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="basePrice" className="block text-sm font-medium text-zinc-700">
                Base Price (B2C) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-zinc-500 sm:text-sm">$</span>
                </div>
                <input
                  type="number"
                  id="basePrice"
                  required
                  min="0"
                  step="0.01"
                  value={basePrice || ''}
                  onChange={(e) => setBasePrice(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Pricing Matrix Card */}
        <div className="bg-white shadow-sm border border-zinc-200 rounded-xl p-6">
          <B2BPricingMatrix
            basePrice={basePrice}
            tiers={pricingTiers}
            customerGroups={MOCK_CUSTOMER_GROUPS}
            onChange={setPricingTiers}
          />
        </div>
      </form>
    </div>
  );
}
