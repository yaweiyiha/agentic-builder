import React, { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input: React.FC<InputProps> = ({ label, error, id, name, ...props }) => {
  const inputId = id || name;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-[16px] font-medium text-[#18181b] mb-[4px]">
          {label}
        </label>
      )}
      <input
        id={inputId}
        name={name}
        className={`w-full p-[12px] border-[1px] rounded-[6px] text-[16px] text-[#18181b] 
                    focus:outline-none focus:ring-[2px] focus:ring-[#2563eb] 
                    ${error ? 'border-[#ef4444]' : 'border-[#d1d5db]'} 
                    bg-[#ffffff]`}
        {...props}
      />
      {error && (
        <p className="mt-[4px] text-[14px] text-[#ef4444]">
          {error}
        </p>
      )}
    </div>
  );
};

export default Input;
