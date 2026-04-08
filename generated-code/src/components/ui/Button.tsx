import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils'; // Assuming a utility for class merging

// Utility to merge Tailwind classes, if not already present
// lib/utils.ts
// import { type ClassValue, clsx } from "clsx"
// import { twMerge } from "tailwind-merge"
// export function cn(...inputs: ClassValue[]) {
//   return twMerge(clsx(inputs))
// }

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-[0.375rem] text-[16px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-offset-[2px] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[#2563eb] text-[#ffffff] hover:bg-[#1d4ed8]",
        outline: "border-[1px] border-[#2563eb] bg-transparent text-[#2563eb] hover:bg-[#eff6ff]",
        ghost: "hover:bg-[#eff6ff] hover:text-[#2563eb]",
        destructive: "bg-[#ef4444] text-[#ffffff] hover:bg-[#dc2626]",
        link: "text-[#2563eb] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[40px] px-[16px] py-[8px]",
        sm: "h-[32px] px-[12px]",
        lg: "h-[48px] px-[24px]",
        icon: "h-[40px] w-[40px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    // If asChild is true, it means the child component will render the button,
    // so we just pass the classes and props to it.
    // For this project, we'll assume asChild is false and render a button.
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
