import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AuthContextValue = {
  isAuthenticated: boolean;
  accessToken: string | null;
  /** Persist a JWT token and mark the session as authenticated. */
  login: (token: string) => void;
  /** Clear the stored token and end the session. */
  logout: () => void;
};

const TOKEN_KEY = "token";

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  accessToken: null,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(
    () => localStorage.getItem(TOKEN_KEY),
  );

  function login(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
    setAccessToken(token);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setAccessToken(null);
  }

  const value = useMemo<AuthContextValue>(
    () => ({ isAuthenticated: Boolean(accessToken), accessToken, login, logout }),
    [accessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
