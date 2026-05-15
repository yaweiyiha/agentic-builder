/**
 * LoginModal — Privy variant.
 *
 * Overwrites the base email+password modal. The flow:
 *   1. User clicks "Continue" → `usePrivy().login()` opens Privy's hosted
 *      auth modal (provider list controlled by `PrivyProvider` config).
 *   2. When Privy reports `authenticated`, we read the access token via
 *      `getAccessToken()` and forward it to the parent via
 *      `onLogin?.(privyToken)`.
 *   3. Parent typically does:
 *         await apiClient.post("/auth/verify", { token });
 *         useAuth().login(privyToken); // or returned internal JWT
 *      and then closes the modal.
 *
 * If you prefer to skip the explicit `/auth/verify` exchange, mount
 * `usePrivyAuthBridge()` somewhere in the tree — it auto-syncs the Privy
 * token into `AuthContext` and the backend `privyAuthMiddleware` will
 * verify it on every request.
 */

import React, { useEffect, useState } from "react";
import { Alert, Button, Modal, Typography } from "antd";
import { usePrivy } from "@privy-io/react-auth";

export type LoginModalProps = {
  open: boolean;
  onClose: () => void;
  /** Receive the Privy access token after successful OAuth. */
  onLogin?: (privyToken: string) => Promise<void> | void;
};

export const LoginModal: React.FC<LoginModalProps> = ({
  open,
  onClose,
  onLogin,
}) => {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When Privy reports authenticated while the modal is open, fetch the
  // access token and forward it to the parent. Then close the modal.
  useEffect(() => {
    if (!open || !authenticated) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Privy did not return an access token");
        if (onLogin) await onLogin(token);
        if (!cancelled) onClose();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Login failed");
          // Roll the Privy session back so the user can retry cleanly.
          try {
            await logout();
          } catch {
            /* ignore */
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, authenticated, getAccessToken, logout, onClose, onLogin]);

  function handleProviderClick() {
    setError(null);
    try {
      login();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start login");
    }
  }

  function handleCancel() {
    setError(null);
    onClose();
  }

  return (
    <Modal
      title={null}
      open={open}
      onCancel={handleCancel}
      footer={null}
      destroyOnClose
      centered
      width={420}
    >
      <div className="px-1">
        <div className="text-center mb-5">
          <Typography.Title level={4} style={{ marginBottom: 4 }}>
            Sign in
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Pick a provider to continue
          </Typography.Text>
        </div>

        {error && (
          <Alert
            type="error"
            showIcon
            message="Authentication failed"
            description={error}
            className="mb-4"
          />
        )}

        <div className="flex flex-col gap-3">
          <Button
            type="primary"
            block
            size="large"
            disabled={!ready}
            loading={loading}
            onClick={handleProviderClick}
          >
            Continue with OAuth
          </Button>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 11, textAlign: "center" }}
          >
            Privy will let you pick from the configured providers (Google,
            Email, Twitter, …). Adjust `loginMethods` in
            <code> providers/PrivyProvider.tsx </code> to match your PRD.
          </Typography.Text>
        </div>

        <Typography.Text
          type="secondary"
          style={{
            fontSize: 11,
            display: "block",
            textAlign: "center",
            marginTop: 18,
          }}
        >
          Protected by Privy
        </Typography.Text>
      </div>
    </Modal>
  );
};
