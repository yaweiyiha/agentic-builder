import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronUp, 
  ChevronDown, 
  ChevronsUpDown, 
  Inbox, 
  Plus, 
  ChevronLeft, 
  ChevronRight 
} from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  sortable?: boolean;
}

export interface PaginationConfig {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export interface BulkAction {
  label: string;
  onClick: (selectedIds: string[]) => void;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  getRowId: (item: T) => string;
  selectable?: boolean;
  onRowAction?: (item: T) => void;
  pagination?: PaginationConfig;
  loading?: boolean;
  emptyMessage?: string;
  onCreateNew?: () => void;
  bulkActions?: BulkAction[];
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  selectable = false,
  onRowAction,
  pagination,
  loading = false,
  emptyMessage = "No records found",
  onCreateNew,
  bulkActions = []
}: DataTableProps<T>) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedData = useMemo(() => {
    if (!sortConfig) return data;
    return [...data].sort((a, b) => {
      const aValue = (a as any)[sortConfig.key];
      const bValue = (b as any)[sortConfig.key];
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortConfig]);

  const toggleSelectAll = () => {
    if (selectedIds.size === data.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.map(getRowId)));
    }
  };

  const toggleSelectRow = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const renderSortIcon = (column: Column<T>) => {
    if (!column.sortable) return null;
    if (sortConfig?.key !== column.key) return <ChevronsUpDown className="w-4 h-4 ml-1 text-zinc-400" />;
    return sortConfig.direction === 'asc' 
      ? <ChevronUp className="w-4 h-4 ml-1 text-blue-600" />
      : <ChevronDown className="w-4 h-4 ml-1 text-blue-600" />;
  };

  if (loading) {
    return (
      <div className="w-full space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="w-full h-16 bg-zinc-100 animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (!loading && data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed border-zinc-200 rounded-xl bg-zinc-50">
        <div className="bg-white p-4 rounded-full shadow-sm mb-4">
          <Inbox className="w-8 h-8 text-zinc-400" />
        </div>
        <h3 className="text-lg font-medium text-zinc-900 mb-1">{emptyMessage}</h3>
        <p className="text-sm text-zinc-500 mb-6 text-center max-w-sm">
          Get started by creating a new record. It will appear here once created.
        </p>
        {onCreateNew && (
          <button 
            onClick={onCreateNew}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create New
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full relative">
      {/* Desktop Table View */}
      <div className="hidden md:block w-full overflow-x-auto bg-white rounded-xl border border-zinc-200 shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200">
              {selectable && (
                <th className="px-6 py-4 w-12">
                  <input 
                    type="checkbox" 
                    className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                    checked={data.length > 0 && selectedIds.size === data.length}
                    onChange={toggleSelectAll}
                  />
                </th>
              )}
              {columns.map((col) => (
                <th 
                  key={col.key}
                  className={`px-6 py-4 text-xs font-semibold text-zinc-600 uppercase tracking-wider ${col.sortable ? 'cursor-pointer select-none hover:bg-zinc-100' : ''}`}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <div className="flex items-center">
                    {col.header}
                    {renderSortIcon(col)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {sortedData.map((item) => {
              const id = getRowId(item);
              const isSelected = selectedIds.has(id);
              return (
                <tr 
                  key={id} 
                  className={`hover:bg-zinc-50 transition-colors ${isSelected ? 'bg-blue-50/50' : ''} ${onRowAction ? 'cursor-pointer' : ''}`}
                  onClick={() => onRowAction && onRowAction(item)}
                >
                  {selectable && (
                    <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                      <input 
                        type="checkbox" 
                        className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                        checked={isSelected}
                        onChange={() => toggleSelectRow(id)}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className="px-6 py-4 text-sm text-zinc-900 whitespace-nowrap">
                      {col.render ? col.render(item) : (item as any)[col.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Stacked Cards View */}
      <div className="md:hidden space-y-4">
        {selectable && (
          <div className="flex items-center px-4 py-3 bg-white border border-zinc-200 rounded-lg shadow-sm">
            <input 
              type="checkbox" 
              id="selectAllMobile"
              className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600 mr-3"
              checked={data.length > 0 && selectedIds.size === data.length}
              onChange={toggleSelectAll}
            />
            <label htmlFor="selectAllMobile" className="text-sm font-medium text-zinc-700">
              Select All ({selectedIds.size})
            </label>
          </div>
        )}
        
        {sortedData.map((item) => {
          const id = getRowId(item);
          const isSelected = selectedIds.has(id);
          
          return (
            <div 
              key={id}
              className={`p-4 bg-white border rounded-xl shadow-sm space-y-3 relative ${isSelected ? 'border-blue-400 ring-1 ring-blue-400' : 'border-zinc-200'}`}
              onClick={() => onRowAction && onRowAction(item)}
            >
              {selectable && (
                <div className="absolute top-4 right-4" onClick={(e) => e.stopPropagation()}>
                  <input 
                    type="checkbox" 
                    className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600 w-5 h-5"
                    checked={isSelected}
                    onChange={() => toggleSelectRow(id)}
                  />
                </div>
              )}
              
              {columns.map((col) => (
                <div key={col.key} className="flex flex-col">
                  <span className="text-xs font-medium text-zinc-500 uppercase mb-1">{col.header}</span>
                  <div className="text-sm text-zinc-900">
                    {col.render ? col.render(item) : (item as any)[col.key]}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 px-2">
          <span className="text-sm text-zinc-600">
            Page {pagination.currentPage} of {pagination.totalPages}
          </span>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
              disabled={pagination.currentPage === 1}
              className="p-2 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
              disabled={pagination.currentPage === pagination.totalPages}
              className="p-2 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bulk Actions Bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && bulkActions.length > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0, x: '-50%' }}
            animate={{ y: 0, opacity: 1, x: '-50%' }}
            exit={{ y: 100, opacity: 0, x: '-50%' }}
            className="fixed bottom-6 left-1/2 z-50 flex items-center gap-4 px-6 py-4 bg-zinc-900 text-white rounded-2xl shadow-2xl"
          >
            <span className="text-sm font-medium border-r border-zinc-700 pr-4">
              {selectedIds.size} selected
            </span>
            <div className="flex items-center gap-2">
              {bulkActions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={() => action.onClick(Array.from(selectedIds))}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    action.variant === 'danger' 
                      ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' 
                      : action.variant === 'primary'
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
