import { createContext, useContext, type ReactNode } from "react";

type AuthContextValue = {
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={{ isAuthenticated: false }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
