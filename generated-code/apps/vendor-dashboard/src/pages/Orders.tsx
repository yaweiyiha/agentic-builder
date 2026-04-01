import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Filter, Package, ChevronRight, AlertCircle } from 'lucide-react';
import FulfillOrderModal from '../components/FulfillOrderModal';

// --- Types ---
type OrderStatus = 'Pending' | 'Paid' | 'Shipped' | 'Refunded';

interface SubOrder {
  id: string;
  createdAt: string;
  customerName: string;
  itemsCount: number;
  totalAmount: number;
  status: OrderStatus;
}

// --- Mock API ---
const fetchVendorOrders = async (): Promise<SubOrder[]> => {
  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 800));
  return [
    { id: 'ORD-1029-A', createdAt: '2023-10-24T10:00:00Z', customerName: 'Acme Corp', itemsCount: 12, totalAmount: 1450.00, status: 'Paid' },
    { id: 'ORD-1030-B', createdAt: '2023-10-25T14:30:00Z', customerName: 'Jane Doe', itemsCount: 2, totalAmount: 89.99, status: 'Pending' },
    { id: 'ORD-1031-A', createdAt: '2023-10-26T09:15:00Z', customerName: 'TechFlow Inc', itemsCount: 50, totalAmount: 4200.00, status: 'Shipped' },
    { id: 'ORD-1032-C', createdAt: '2023-10-26T16:45:00Z', customerName: 'John Smith', itemsCount: 1, totalAmount: 25.00, status: 'Refunded' },
  ];
};

// --- Components ---
const StatusBadge = ({ status }: { status: OrderStatus }) => {
  const styles = {
    Pending: 'bg-amber-100 text-amber-800 border-amber-200',
    Paid: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    Shipped: 'bg-blue-100 text-blue-800 border-blue-200',
    Refunded: 'bg-red-100 text-red-800 border-red-200',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}>
      {status}
    </span>
  );
};

export default function Orders() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: orders, isLoading, isError } = useQuery({
    queryKey: ['vendor-orders'],
    queryFn: fetchVendorOrders,
  });

  const handleFulfillClick = (orderId: string) => {
    setSelectedOrderId(orderId);
    setIsModalOpen(true);
  };

  const filteredOrders = orders?.filter(order => 
    order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.customerName.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page Header */}
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Orders</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Manage your sub-orders, process fulfillments, and track shipments.
          </p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-t-lg border border-zinc-200 border-b-0 flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="relative w-full sm:w-96">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-zinc-400" />
          </div>
          <input
            type="text"
            placeholder="Search by Order ID or Customer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full pl-10 pr-3 py-2 border border-zinc-300 rounded-md leading-5 bg-white placeholder-zinc-500 focus:outline-none focus:placeholder-zinc-400 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 sm:text-sm transition-colors"
          />
        </div>
        <button className="inline-flex items-center px-4 py-2 border border-zinc-300 rounded-md shadow-sm text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 w-full sm:w-auto">
          <Filter className="h-4 w-4 mr-2 text-zinc-500" />
          Filter
        </button>
      </div>

      {/* Data Table */}
      <div className="bg-white border border-zinc-200 rounded-b-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200">
            <thead className="bg-zinc-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Order ID
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Date
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Customer
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Status
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Total
                </th>
                <th scope="col" className="relative px-6 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-zinc-200">
              {isLoading ? (
                // Skeleton Loader
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-zinc-200 rounded w-24"></div></td>
                    <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-zinc-200 rounded w-32"></div></td>
                    <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-zinc-200 rounded w-28"></div></td>
                    <td className="px-6 py-4 whitespace-nowrap"><div className="h-5 bg-zinc-200 rounded-full w-16"></div></td>
                    <td className="px-6 py-4 whitespace-nowrap text-right"><div className="h-4 bg-zinc-200 rounded w-16 ml-auto"></div></td>
                    <td className="px-6 py-4 whitespace-nowrap text-right"><div className="h-8 bg-zinc-200 rounded w-20 ml-auto"></div></td>
                  </tr>
                ))
              ) : isError ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <AlertCircle className="mx-auto h-8 w-8 text-red-500 mb-2" />
                    <p className="text-zinc-600">Failed to load orders. Please try again.</p>
                  </td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <Package className="mx-auto h-12 w-12 text-zinc-300 mb-4" />
                    <h3 className="text-sm font-medium text-zinc-900">No orders found</h3>
                    <p className="mt-1 text-sm text-zinc-500">
                      {searchTerm ? 'Try adjusting your search terms.' : 'You have no orders yet.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900">
                      {order.id}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                      {new Date(order.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric'
                      })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-zinc-900">{order.customerName}</div>
                      <div className="text-xs text-zinc-500">{order.itemsCount} items</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-900 text-right font-medium">
                      ${order.totalAmount.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      {order.status === 'Paid' ? (
                        <button
                          onClick={() => handleFulfillClick(order.id)}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600"
                        >
                          Fulfill
                        </button>
                      ) : (
                        <button className="inline-flex items-center text-zinc-400 hover:text-zinc-600">
                          View <ChevronRight className="ml-1 h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Modal */}
      <FulfillOrderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        orderId={selectedOrderId}
      />
    </div>
  );
}
