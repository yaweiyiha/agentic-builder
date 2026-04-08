'use client'; // This directive is for Next.js App Router to mark as a Client Component

import React from 'react';
import { useSettings } from '../../../hooks/useSettings';
import SettingsForm from '../../../components/settings/SettingsForm';
import { Link } from 'react-router-dom'; // Assuming react-router-dom for navigation

const SettingsPage: React.FC = () => {
  const { settings, isLoading, isError, error } = useSettings();

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#F8FAFC] p-[24px]">
        <h1 className="text-[32px] font-bold text-[#18181b] mb-[32px]">Loading Settings...</h1>
        <div className="animate-spin rounded-full h-[48px] w-[48px] border-b-2 border-[#2563eb]"></div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#F8FAFC] p-[24px]">
        <h1 className="text-[32px] font-bold text-[#EF4444] mb-[32px]">Error</h1>
        <p className="text-[18px] text-[#4B5563] mb-[24px]">Failed to load settings: {error?.message}</p>
        <Link
          to="/timer"
          className="bg-[#2563eb] text-[#FFFFFF] text-[16px] font-semibold py-[12px] px-[24px] rounded-[8px] hover:bg-[#1D4ED8] transition-colors"
        >
          Go to Timer
        </Link>
      </div>
    );
  }

  if (!settings) {
    // This case should ideally not be reached if isLoading and isError are handled,
    // but good for defensive programming if settings could be null/undefined after loading.
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#F8FAFC] p-[24px]">
        <h1 className="text-[32px] font-bold text-[#18181b] mb-[32px]">No Settings Found</h1>
        <p className="text-[18px] text-[#4B5563] mb-[24px]">Please try logging in again or contact support.</p>
        <Link
          to="/login"
          className="bg-[#2563eb] text-[#FFFFFF] text-[16px] font-semibold py-[12px] px-[24px] rounded-[8px] hover:bg-[#1D4ED8] transition-colors"
        >
          Go to Login
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#F8FAFC] p-[24px]">
      <SettingsForm initialSettings={settings} />
    </div>
  );
};

export default SettingsPage;
