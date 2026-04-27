import { PrivyClient } from "@privy-io/node";
import { PRIVY_APP_ID, PRIVY_APP_SECRET } from "../config/env";

let _client: PrivyClient | null = null;

export function getPrivyClient(): PrivyClient {
  if (_client) return _client;
  if (!PRIVY_APP_SECRET) {
    throw new Error(
      "PRIVY_APP_SECRET is required. Set it in your environment before starting the backend.",
    );
  }
  _client = new PrivyClient({ appId: PRIVY_APP_ID, appSecret: PRIVY_APP_SECRET });
  return _client;
}

