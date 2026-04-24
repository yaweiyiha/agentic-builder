import "dotenv/config";

export const PORT = Number(process.env.PORT || 4000);

// Privy (server-side)
//
// IMPORTANT: do NOT hardcode `PRIVY_APP_SECRET` in source control. Set it via env.
export const PRIVY_APP_ID =
  process.env.PRIVY_APP_ID || "cmocly8bj01ak0cjy3662inlh";
export const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || "";
