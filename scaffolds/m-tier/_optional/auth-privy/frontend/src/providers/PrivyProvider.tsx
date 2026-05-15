/**
 * Privy SDK provider adapter.
 *
 * Mounts the real `@privy-io/react-auth` provider with the app's
 * configuration. Reads `VITE_PRIVY_APP_ID` from Vite env.
 *
 * Generated apps that need a different `loginMethods` set (e.g. only
 * Twitter, only LinkedIn, plus email-otp) should override the `config`
 * prop here — the worker is expected to align this with the PRD's
 * "supported sign-in providers" list.
 */

import type { ReactNode } from "react";
import { PrivyProvider as PrivySdkProvider } from "@privy-io/react-auth";

type PrivyAuthProviderProps = {
  children: ReactNode;
};

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

export function PrivyAuthProvider({ children }: PrivyAuthProviderProps) {
  if (!PRIVY_APP_ID) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        "[Privy] VITE_PRIVY_APP_ID is not set; Privy login will be disabled. " +
          "Set it in frontend/.env to enable OAuth.",
      );
    }
    // Render children unwrapped so the rest of the app still mounts in dev.
    return <>{children}</>;
  }

  return (
    <PrivySdkProvider
      appId={PRIVY_APP_ID}
      config={{
        // Sensible default; worker should narrow per PRD if needed.
        loginMethods: ["google", "email"],
        appearance: {
          theme: "light",
          showWalletLoginFirst: false,
        },
      }}
    >
      {children}
    </PrivySdkProvider>
  );
}
