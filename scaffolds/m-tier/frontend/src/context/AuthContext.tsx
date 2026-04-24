import {
  createContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePrivy } from "@privy-io/react-auth";

type AuthContextValue = {
  isAuthenticated: boolean;
  accessToken: string | null;
};

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  accessToken: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function syncToken() {
      // Keep legacy API client behavior: it reads `localStorage.token` and
      // injects `Authorization: Bearer <token>`.
      if (!ready || !authenticated) {
        localStorage.removeItem("token");
        setAccessToken(null);
        return;
      }

      try {
        const token = await getAccessToken();
        if (cancelled) return;
        if (token) {
          localStorage.setItem("token", token);
          setAccessToken(token);
        } else {
          localStorage.removeItem("token");
          setAccessToken(null);
        }
      } catch {
        if (cancelled) return;
        localStorage.removeItem("token");
        setAccessToken(null);
      }
    }

    void syncToken();

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, getAccessToken]);

  const value = useMemo<AuthContextValue>(() => {
    return {
      isAuthenticated: Boolean(ready && authenticated),
      accessToken,
    };
  }, [ready, authenticated, accessToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
