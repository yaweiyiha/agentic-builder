'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';

const Navbar: React.FC = () => {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // Assuming the backend handles session invalidation based on cookies or tokens
        // If a token is stored client-side (e.g., localStorage), it should be removed here
        // and potentially sent in the Authorization header for the logout request.
      });

      if (response.ok) {
        // Clear any client-side tokens/session data if applicable
        // localStorage.removeItem('authToken'); // Example
        router.push('/login'); // Redirect to login page after successful logout
      } else {
        console.error('Logout failed:', response.statusText);
        // Optionally, display an error message to the user (e.g., toast notification)
        alert('Logout failed. Please try again.');
      }
    } catch (error) {
      console.error('Error during logout:', error);
      // Optionally, display an error message to the user
      alert('An unexpected error occurred during logout.');
    }
  };

  return (
    <nav className="flex items-center justify-between p-[1rem] bg-[#ffffff] text-[#18181b] shadow-md">
      <div className="flex items-center">
        <Link href="/timer" className="text-[20px] font-bold text-[#18181b] hover:text-[#2563eb]">
          Pomodoro Timer
        </Link>
      </div>
      <div className="flex items-center space-x-[1rem]">
        <Link href="/timer" className="text-[#18181b] hover:text-[#2563eb] transition-colors">
          Timer
        </Link>
        <Link href="/statistics" className="text-[#18181b] hover:text-[#2563eb] transition-colors">
          Statistics
        </Link>
        <Link href="/settings" className="text-[#18181b] hover:text-[#2563eb] transition-colors">
          Settings
        </Link>
        <button
          onClick={handleLogout}
          className="px-[0.5rem] py-[0.25rem] bg-[#2563eb] text-[#ffffff] rounded-[0.375rem] hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:ring-opacity-50"
        >
          Logout
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
