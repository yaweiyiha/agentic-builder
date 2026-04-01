import React from 'react';

interface StatusBadgeProps {
  status: string;
  type?: 'product' | 'order' | 'vendor';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type = 'product' }) => {
  const getStyles = () => {
    const normalizedStatus = status.toUpperCase();
    
    if (type === 'product') {
      switch (normalizedStatus) {
        case 'PUBLISHED':
          return 'bg-emerald-100 text-emerald-800 border-emerald-200';
        case 'SCHEDULED':
          return 'bg-blue-100 text-blue-800 border-blue-200';
        case 'DRAFT':
        default:
          return 'bg-zinc-100 text-zinc-800 border-zinc-200';
      }
    }
    
    // Fallback for other types
    return 'bg-zinc-100 text-zinc-800 border-zinc-200';
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStyles()}`}>
      {status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}
    </span>
  );
};
