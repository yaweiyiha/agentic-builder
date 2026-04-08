import React, { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

const Button: React.FC<ButtonProps> = ({
  children,
  loading = false,
  variant = 'primary',
  className,
  disabled,
  ...props
}) => {
  const baseStyles = `
    flex items-center justify-center gap-[8px] px-[16px] py-[10px] rounded-[6px] 
    font-semibold text-[16px] transition-colors duration-200
  `;

  const variantStyles = {
    primary: `bg-[#2563eb] text-[#ffffff] hover:bg-[#1d4ed8] focus:ring-[2px] focus:ring-[#2563eb]`,
    secondary: `bg-[#e2e8f0] text-[#18181b] hover:bg-[#cbd5e1] focus:ring-[2px] focus:ring-[#94a3b8]`,
    danger: `bg-[#ef4444] text-[#ffffff] hover:bg-[#dc2626] focus:ring-[2px] focus:ring-[#ef4444]`,
  };

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${className} ${
        (disabled || loading) ? 'opacity-50 cursor-not-allowed' : ''
      }`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-[20px] w-[20px] animate-spin" />}
      {children}
    </button>
  );
};

export default Button;
