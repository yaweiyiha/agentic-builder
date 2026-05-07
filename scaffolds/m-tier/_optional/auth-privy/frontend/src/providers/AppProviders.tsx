import type { ReactNode } from "react";
import { AuthProvider } from "../context/AuthContext.tsx";
import { PrivyAuthProvider } from "./PrivyProvider.tsx";

/**
 * AppProviders — Privy variant.
 *
 * `_optional/auth-privy` overwrites the base `AppProviders` so the rest of
 * the tree (`main.tsx` → `<AppProviders>`) does not need to change when
 * Privy is wired in. The order matters:
 *
 *   <PrivyAuthProvider>     ← gives the tree access to `usePrivy()`
 *     <AuthProvider>        ← stores the verified token + isAuthenticated
 *       {children}
 *     </AuthProvider>
 *   </PrivyAuthProvider>
 *
 * To bridge Privy → AuthContext (so `apiClient` can pick up the Bearer
 * token), call `usePrivyAuthBridge()` somewhere inside the tree (e.g. in
 * a top-level layout component). See `hooks/usePrivyAuthBridge.ts`.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PrivyAuthProvider>
      <AuthProvider>{children}</AuthProvider>
    </PrivyAuthProvider>
  );
}
