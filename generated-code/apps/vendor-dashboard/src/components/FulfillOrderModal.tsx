import React, { useState, useEffect } from 'react';
import { X, Truck, Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';

interface FulfillOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string | null;
}

// Mock API call for fulfilling an order
const fulfillOrder = async (data: { orderId: string; trackingNumber: string; carrier: string }) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ success: true, ...data });
    }, 1000);
  });
};

export default function FulfillOrderModal({ isOpen, onClose, orderId }: FulfillOrderModalProps) {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrier, setCarrier] = useState('FedEx');
  const queryClient = useQueryClient();

  // Reset form when modal opens with a new order
  useEffect(() => {
    if (isOpen) {
      setTrackingNumber('');
      setCarrier('FedEx');
    }
  }, [isOpen, orderId]);

  const mutation = useMutation({
    mutationFn: fulfillOrder,
    onSuccess: () => {
      // Invalidate orders query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['vendor-orders'] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderId || !trackingNumber || !carrier) return;
    mutation.mutate({ orderId, trackingNumber, carrier });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-zinc-900/50 backdrop-blur-sm"
            aria-hidden="true"
          />

          {/* Slide-over panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <h2 className="text-lg font-semibold text-zinc-900 flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-600" />
                Fulfill Order
              </h2>
              <button
                onClick={onClose}
                className="p-2 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-full transition-colors"
                aria-label="Close panel"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-6">
                <p className="text-sm text-zinc-600">
                  You are fulfilling sub-order <span className="font-semibold text-zinc-900">#{orderId}</span>. 
                  Please provide the shipping carrier and tracking number to notify the customer.
                </p>
              </div>

              <form id="fulfill-form" onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="carrier" className="block text-sm font-medium text-zinc-900 mb-1">
                    Shipping Carrier
                  </label>
                  <select
                    id="carrier"
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 sm:text-sm"
                    required
                  >
                    <option value="FedEx">FedEx</option>
                    <option value="UPS">UPS</option>
                    <option value="USPS">USPS</option>
                    <option value="DHL">DHL</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="trackingNumber" className="block text-sm font-medium text-zinc-900 mb-1">
                    Tracking Number
                  </label>
                  <input
                    type="text"
                    id="trackingNumber"
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    placeholder="e.g. 1Z9999999999999999"
                    className="w-full px-3 py-2 border border-zinc-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 sm:text-sm"
                    required
                  />
                </div>
              </form>
            </div>

            <div className="px-6 py-4 border-t border-zinc-200 bg-zinc-50 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md shadow-sm hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="fulfill-form"
                disabled={mutation.isPending || !trackingNumber}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Fulfillment'
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
