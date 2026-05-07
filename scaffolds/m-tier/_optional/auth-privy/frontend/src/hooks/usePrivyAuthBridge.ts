/**
 * usePrivyAuthBridge — keep AuthContext in sync with Privy session state.
 *
 * Mount this once near the top of the rendered tree (e.g. inside the
 * top-level layout or right after `<AppProviders>`):
 *
 *     function App() {
 *       usePrivyAuthBridge();
 *       return <Router />;
 *     }
 *
 * What it does:
 *   - When Privy reports `authenticated`, fetch the access token via
 *     `getAccessToken()` and call `useAuth().login(token)`. The token is
 *     persisted to `localStorage` by `AuthContext`, which makes
 *     `apiClient` automatically attach `Authorization: Bearer <token>`
 *     to every request.
 *   - When Privy reports `unauthenticated`, call `useAuth().logout()`.
 *
 * The backend `_optional/auth-privy` middleware (`privyAuthMiddleware`)
 * verifies the Privy access token on every request, so storing it
 * directly is safe — no separate `/api/auth/verify` exchange is required
 * (though feel free to add one if your PRD calls for an internal JWT).
 */

import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAuth } from "../context/AuthContext";

export function usePrivyAuthBridge(): void {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { accessToken, login, logout } = useAuth();
  const inFlight = useRef(false);

  useEffect(() => {
    if (!ready) return;

    if (!authenticated) {
      if (accessToken) logout();
      return;
    }

    // Avoid concurrent fetches when React re-renders during token refresh.
    if (inFlight.current) return;
    inFlight.current = true;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        if (token !== accessToken) login(token);
      } catch {
        // Swallow; LoginModal surfaces the user-facing error.
      } finally {
        inFlight.current = false;
      }
    })();
  }, [ready, authenticated, accessToken, getAccessToken, login, logout]);
}
