import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[#0f172a] text-white",
        secondary:
          "border-[#e2e8f0] bg-[#f8fafc] text-[#64748b]",
        destructive:
          "border-[#fecaca] bg-[#fef2f2] text-[#dc2626]",
        outline:
          "border-[#e2e8f0] text-[#334155] bg-transparent",
        success:
          "border-[#bbf7d0] bg-[#f0fdf4] text-[#16a34a]",
        warning:
          "border-[rgba(113,42,226,0.2)] bg-[rgba(113,42,226,0.06)] text-[#712ae2]",
        muted:
          "border-[#e2e8f0] bg-[#f8fafc] text-[#94a3b8]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
