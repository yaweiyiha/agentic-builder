import React from 'react';

export interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => React.ReactNode);
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
}

export function DataTable<T>({ 
  columns, 
  data, 
  isLoading, 
  emptyMessage = 'No records found',
  emptyAction
}: DataTableProps<T>) {
  if (isLoading) {
    return (
      <div className="w-full bg-white rounded-lg border border-zinc-200 overflow-hidden">
        <div className="animate-pulse">
          <div className="h-12 bg-zinc-100 border-b border-zinc-200"></div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 border-b border-zinc-100 flex items-center px-6 gap-4">
              {columns.map((_, j) => (
                <div key={j} className="h-4 bg-zinc-200 rounded w-full"></div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="w-full bg-white rounded-lg border border-zinc-200 p-12 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-zinc-900 mb-1">{emptyMessage}</h3>
        <p className="text-zinc-500 mb-6">Get started by creating a new record.</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div className="w-full bg-white rounded-lg border border-zinc-200 overflow-x-auto">
      <table className="w-full text-sm text-left text-zinc-600">
        <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-200">
          <tr>
            {columns.map((col, i) => (
              <th key={i} scope="col" className={`px-6 py-4 font-medium ${col.className || ''}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="bg-white border-b border-zinc-100 hover:bg-zinc-50 transition-colors">
              {columns.map((col, j) => (
                <td key={j} className={`px-6 py-4 whitespace-nowrap ${col.className || ''}`}>
                  {typeof col.accessor === 'function' 
                    ? col.accessor(row) 
                    : (row[col.accessor] as React.ReactNode)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
