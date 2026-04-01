import React, { useState } from 'react';
import { useProducts } from '../hooks/useProducts';
import { Product } from '../types/catalog';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable, Column } from '../components/ui/DataTable';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Search, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

export default function Catalog() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const limit = 10;

  const { data, isLoading, isError, error } = useProducts({
    page,
    limit,
    search: search || undefined,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1); // Reset to first page on new search
  };

  const columns: Column<Product>[] = [
    {
      header: 'Product Name',
      accessor: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-zinc-900">{row.name}</span>
          <span className="text-xs text-zinc-500">{row.id.slice(0, 8)}...</span>
        </div>
      ),
    },
    {
      header: 'SKU',
      accessor: 'sku',
    },
    {
      header: 'Price',
      accessor: (row) => `$${row.price.toFixed(2)}`,
    },
    {
      header: 'Stock',
      accessor: (row) => (
        <span className={row.stock < 10 ? 'text-red-600 font-medium' : 'text-zinc-600'}>
          {row.stock}
        </span>
      ),
    },
    {
      header: 'Status',
      accessor: (row) => <StatusBadge status={row.status} type="product" />,
    },
    {
      header: 'Vendor',
      accessor: (row) => row.vendor?.name || 'Internal',
    },
    {
      header: 'Actions',
      accessor: () => (
        <button className="text-blue-600 hover:text-blue-800 font-medium text-sm transition-colors">
          Edit
        </button>
      ),
      className: 'text-right',
    },
  ];

  if (isError) {
    return (
      <div className="p-6 text-red-600 bg-red-50 rounded-lg border border-red-200">
        <h3 className="font-bold mb-2">Error loading catalog</h3>
        <p>{error instanceof Error ? error.message : 'Unknown error occurred'}</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Product Catalog"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Catalog' },
        ]}
        actions={
          <button className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
            <Plus className="w-4 h-4 mr-2" />
            Add Product
          </button>
        }
      />

      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <form onSubmit={handleSearch} className="relative w-full sm:w-96">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-zinc-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-zinc-200 rounded-lg leading-5 bg-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors"
            placeholder="Search products by name or SKU..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </form>
      </div>

      <DataTable
        columns={columns}
        data={data?.items || []}
        isLoading={isLoading}
        emptyMessage="No products found"
        emptyAction={
          <button className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
            <Plus className="w-4 h-4 mr-2" />
            Create First Product
          </button>
        }
      />

      {/* Pagination Controls */}
      {data && data.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between bg-white px-4 py-3 border border-zinc-200 rounded-lg sm:px-6">
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-zinc-700">
                Showing <span className="font-medium">{(page - 1) * limit + 1}</span> to{' '}
                <span className="font-medium">
                  {Math.min(page * limit, data.total)}
                </span>{' '}
                of <span className="font-medium">{data.total}</span> results
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-zinc-200 bg-white text-sm font-medium text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="sr-only">Previous</span>
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <span className="relative inline-flex items-center px-4 py-2 border border-zinc-200 bg-white text-sm font-medium text-zinc-700">
                  Page {page} of {data.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  disabled={page === data.totalPages}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-zinc-200 bg-white text-sm font-medium text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="sr-only">Next</span>
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
