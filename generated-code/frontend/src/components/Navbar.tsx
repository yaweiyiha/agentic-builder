import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

interface NavbarProps {
  appName?: string;
}

const Navbar: React.FC<NavbarProps> = ({ appName = 'Pomodoro Tracker' }) => {
  const navigate = useNavigate();

  const handleLogout = (e: React.MouseEvent) => {
    e.preventDefault();
    console.log('Logging out...');
    // TODO: Implement actual logout API call
    // For now, redirect to login page
    navigate('/login');
  };

  return (
    <nav className="bg-gray-800 p-4 shadow-md">
      <div className="container mx-auto flex justify-between items-center">
        <Link to="/timer" className="text-white text-2xl font-bold tracking-wide">
          {appName}
        </Link>
        <div className="space-x-4">
          <Link to="/timer" className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium">
            Timer
          </Link>
          <Link to="/statistics" className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium">
            Statistics
          </Link>
          <Link to="/settings" className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium">
            Settings
          </Link>
          <button
            onClick={handleLogout}
            className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-md text-sm font-medium transition duration-150 ease-in-out"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
