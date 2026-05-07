import "dotenv/config";

// Privy server-side credentials.
//
// IMPORTANT: do NOT hardcode `PRIVY_APP_SECRET` in source control. Set it via
// env. The `PRIVY_APP_ID` is safe to surface to the client (it ships in the
// frontend bundle as `VITE_PRIVY_APP_ID`); the secret is server-only.
export const PRIVY_APP_ID = process.env.PRIVY_APP_ID || "";
export const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || "";
