import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#1E293B] text-[#F1F5F9] p-[24px] text-center">
      <h1 className="text-[48px] font-bold mb-[16px]">404 - Page Not Found</h1>
      <p className="text-[18px] mb-[32px]">
        The page you are looking for does not exist.
      </p>
      <Link 
        href="/login" 
        className="px-[24px] py-[12px] bg-[#2563EB] text-white rounded-[8px] hover:bg-[#1D4ED8] transition-colors duration-200 text-[16px] font-semibold"
      >
        Go to Login
      </Link>
    </div>
  );
}
