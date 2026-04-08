import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

// Define the User type based on potential API response
interface User {
  id: string;
  email: string;
  // Add other user properties as needed
}

// Define the shape of the AuthContext
interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, confirmPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
  clearError: () => void;
}

// Create the AuthContext
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// AuthProvider component props
interface AuthProviderProps {
  children: ReactNode;
}

// AuthProvider component
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const isAuthenticated = !!user;

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Function to simulate checking for an existing session (e.g., via token)
  const checkAuthStatus = useCallback(async () => {
    const token = localStorage.getItem('authToken');
    if (token) {
      // In a real app, you'd validate this token with your backend
      // e.g., by making a request to a /me endpoint
      try {
        // Simulate token validation
        // For now, just assume token presence means authenticated
        const dummyUser: User = { id: '123', email: 'user@example.com' }; // Replace with actual user data from token or API
        setUser(dummyUser);
      } catch (err) {
        console.error('Token validation failed:', err);
        localStorage.removeItem('authToken');
        setUser(null);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  const login = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.post('/api/auth/login', { email, password });
        // Assuming the API returns a token and/or user data
        const { token, user: userData } = response.data;
        localStorage.setItem('authToken', token);
        setUser(userData as User); // Cast to User type
        navigate('/timer');
      } catch (err: any) {
        console.error('Login failed:', err);
        setError(err.response?.data?.message || 'Invalid credentials. Please try again.');
        setUser(null);
      } finally {
        setLoading(false);
      }
    },
    [navigate]
  );

  const register = useCallback(
    async (email: string, password: string, confirmPassword: string) => {
      setLoading(true);
      setError(null);
      if (password !== confirmPassword) {
        setError("Passwords don't match.");
        setLoading(false);
        return;
      }
      try {
        const response = await axios.post('/api/auth/register', { email, password });
        // Assuming the API returns a token and/or user data
        const { token, user: userData } = response.data;
        localStorage.setItem('authToken', token);
        setUser(userData as User); // Cast to User type
        navigate('/timer');
      } catch (err: any) {
        console.error('Registration failed:', err);
        setError(err.response?.data?.message || 'Registration failed. Please try again.');
        setUser(null);
      } finally {
        setLoading(false);
      }
    },
    [navigate]
  );

  const logout = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await axios.post('/api/auth/logout');
      localStorage.removeItem('authToken');
      setUser(null);
      navigate('/login');
    } catch (err: any) {
      console.error('Logout failed:', err);
      setError(err.response?.data?.message || 'Logout failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const value = {
    user,
    isAuthenticated,
    loading,
    login,
    register,
    logout,
    error,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Custom hook to use the AuthContext
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
