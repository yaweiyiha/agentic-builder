import { useState, useEffect, createContext } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import TimerPage from './pages/TimerPage';
import StatisticsPage from './pages/StatisticsPage';
import SettingsPage from './pages/SettingsPage';
import ErrorPage from './pages/ErrorPage';
import Navbar from './components/Navbar';

// Placeholder for authentication state
interface AuthContextType {
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    // Check for token in localStorage on initial load
    return localStorage.getItem('authToken') !== null;
  });
  const navigate = useNavigate();
  const location = useLocation();

  const login = (token: string) => {
    localStorage.setItem('authToken', token);
    setIsAuthenticated(true);
    navigate('/timer');
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    setIsAuthenticated(false);
    navigate('/login');
  };

  // Redirect logic based on authentication status
  useEffect(() => {
    if (!isAuthenticated && location.pathname !== '/login' && location.pathname !== '/register') {
      navigate('/login');
    } else if (isAuthenticated && (location.pathname === '/login' || location.pathname === '/register' || location.pathname === '/')) {
      navigate('/timer');
    }
  }, [isAuthenticated, location.pathname, navigate]);

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      <div className="min-h-screen flex flex-col">
        {isAuthenticated && <Navbar />}
        <main className="flex-grow container mx-auto p-4 flex items-center justify-center">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            {/* Protected routes - useEffect handles redirection if unauthenticated */}
            <Route path="/timer" element={<TimerPage />} />
            <Route path="/statistics" element={<StatisticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {/* Root path: conditionally render based on authentication status */}
            <Route path="/" element={isAuthenticated ? <TimerPage /> : <LoginPage />} />
            <Route path="*" element={<ErrorPage />} />
          </Routes>
        </main>
      </div>
    </AuthContext.Provider>
  );
}

export default App;
