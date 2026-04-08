import React from 'react';
import Navbar from '@/components/layout/Navbar'; // Assuming @/components alias is configured in tsconfig.json

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-grow container mx-auto p-[1rem]"> {/* Apply spacing-md from design tokens for main content padding */}
        {children}
      </main>
    </div>
  );
}
