import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { AuthProvider } from "../context/AuthContext.tsx";

export function AppProviders({ children }: { children: ReactNode }) {
  const appId =
    import.meta.env.VITE_PRIVY_APP_ID || "cmocly8bj01ak0cjy3662inlh";

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "light",
          accentColor: "#1677ff",
        },
      }}
    >
      <AuthProvider>{children}</AuthProvider>
    </PrivyProvider>
  );
}
