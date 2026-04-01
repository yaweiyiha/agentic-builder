import React from 'react';

export type BadgeType = 'order' | 'product' | 'vendor';

export interface StatusBadgeProps {
  status: string;
  type: BadgeType;
}

const getBadgeStyles = (status: string, type: BadgeType): string => {
  const normalizedStatus = status.toLowerCase();

  // Base styles
  const base = "inline-flex items-center justify-center rounded-full px-2 py-0.5 md:px-2.5 md:py-1 text-[10px] md:text-xs font-medium capitalize border";

  // Color mappings based on Design Tokens & Requirements
  const colorMaps: Record<BadgeType, Record<string, string>> = {
    product: {
      draft: "bg-zinc-100 text-zinc-700 border-zinc-200",
      published: "bg-emerald-50 text-emerald-700 border-emerald-200",
      scheduled: "bg-blue-50 text-blue-700 border-blue-200",
    },
    order: {
      pending: "bg-amber-50 text-amber-700 border-amber-200",
      paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
      shipped: "bg-blue-50 text-blue-700 border-blue-200",
      refunded: "bg-red-50 text-red-700 border-red-200",
    },
    vendor: {
      active: "bg-emerald-50 text-emerald-700 border-emerald-200",
      pending: "bg-amber-50 text-amber-700 border-amber-200",
      suspended: "bg-red-50 text-red-700 border-red-200",
    }
  };

  // Fallback to zinc if status is not explicitly defined
  const defaultStyle = "bg-zinc-100 text-zinc-700 border-zinc-200";
  
  const typeMap = colorMaps[type];
  const colorStyle = typeMap ? (typeMap[normalizedStatus] || defaultStyle) : defaultStyle;

  return `${base} ${colorStyle}`;
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type }) => {
  return (
    <span className={getBadgeStyles(status, type)}>
      {status}
    </span>
  );
};
