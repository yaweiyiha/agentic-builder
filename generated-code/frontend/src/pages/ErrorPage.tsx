import React from 'react';
import { useNavigate } from 'react-router-dom';

const ErrorPage: React.FC = () => {
  const navigate = useNavigate();

  const handleGoHome = () => {
    // Determine if user is authenticated to redirect to timer or login
    const isAuthenticated = localStorage.getItem('authToken') !== null;
    navigate(isAuthenticated ? '/timer' : '/login');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen-minus-navbar text-center p-4">
      <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
      <p className="text-2xl text-text-muted mb-8">Oops! The page you're looking for doesn't exist.</p>
      <button
        onClick={handleGoHome}
        className="bg-primary hover:bg-red-600 text-white font-bold py-3 px-6 rounded-full transition-colors text-lg"
      >
        Go to Home
      </button>
    </div>
  );
};

export default ErrorPage;
