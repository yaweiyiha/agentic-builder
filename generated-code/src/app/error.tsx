'use client'; // This is a Client Component

import { useEffect } from 'react';
import Link from 'next/link';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#1E293B] text-[#F1F5F9] p-[24px] text-center">
      <h1 className="text-[48px] font-bold mb-[16px]">Something went wrong!</h1>
      <p className="text-[18px] mb-[32px]">
        We apologize for the inconvenience. Please try again or go back to the login page.
      </p>
      <div className="flex gap-[16px]">
        <button
          className="px-[24px] py-[12px] bg-[#2563EB] text-white rounded-[8px] hover:bg-[#1D4ED8] transition-colors duration-200 text-[16px] font-semibold"
          onClick={() => reset()}
        >
          Try again
        </button>
        <Link 
          href="/login" 
          className="px-[24px] py-[12px] bg-transparent border-[1px] border-[#64748B] text-[#F1F5F9] rounded-[8px] hover:bg-[#334155] transition-colors duration-200 text-[16px] font-semibold"
        >
          Go to Login
        </Link>
      </div>
    </div>
  );
}
