import React, { useMemo, useState } from "react";
import { useLoginWithOAuth } from "@privy-io/react-auth";
import { Alert, Button, Divider, Modal, Space, Typography } from "antd";

export type LoginModalProps = {
  open: boolean;
  onClose: () => void;
};

function toErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message ?? "Login failed");
  }
  return String(err ?? "Login failed");
}

export const LoginModal: React.FC<LoginModalProps> = ({ open, onClose }) => {
  const [error, setError] = useState<string | null>(null);

  const { initOAuth, state, loading } = useLoginWithOAuth({
    onError: (err) => {
      setError(toErrorMessage(err));
    },
  });

  const busy = loading || state.status === "loading";
  const hint = useMemo(() => {
    if (state.status === "loading") return "Redirecting to the provider...";
    if (state.status === "done") return "Signed in";
    return null;
  }, [state.status]);

  async function handleOAuth(provider: "google" | "twitter") {
    setError(null);
    try {
      // The SDK typically triggers a redirect; if it errors, keep the modal open
      // and surface the error to the user.
      await initOAuth({ provider });
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }

  return (
    <Modal
      title={null}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      centered
      width={420}
    >
      <div className="px-1">
        <div className="text-center">
          <Typography.Title level={4} style={{ marginBottom: 4 }}>
            Sign in
          </Typography.Title>
          <Typography.Text type="secondary">
            Continue with a social account
          </Typography.Text>
        </div>

        <Divider style={{ margin: "16px 0" }} />

        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          {error ? <Alert type="error" showIcon message={error} /> : null}
          {hint ? <Alert type="info" showIcon message={hint} /> : null}

          <Button
            block
            size="large"
            disabled={busy}
            onClick={() => handleOAuth("google")}
            icon={
              <img
                src="/icon/auth/google.svg"
                alt="Google"
                width={20}
                height={20}
              />
            }
            style={{
              height: 44,
              borderRadius: 12,
              background: "#ffffff",
              borderColor: "#d9d9d9",
              color: "#111827",
              fontWeight: 600,
              justifyContent: "flex-start",
              paddingInline: 14,
            }}
          >
            Continue with Google
          </Button>

          <Button
            block
            size="large"
            disabled={busy}
            onClick={() => handleOAuth("twitter")}
            icon={<img src="/icon/auth/x.svg" alt="X" width={20} height={20} />}
            style={{
              height: 44,
              borderRadius: 12,
              background: "#ffffff",
              borderColor: "#d9d9d9",
              color: "#111827",
              fontWeight: 600,
              justifyContent: "flex-start",
              paddingInline: 14,
            }}
          >
            Continue with X
          </Button>

          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, display: "block", textAlign: "center" }}
          >
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </Typography.Text>
        </Space>
      </div>
    </Modal>
  );
};
