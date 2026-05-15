import React, { useState } from "react";
import { Alert, Button, Form, Input, Modal, Typography } from "antd";

export type LoginModalProps = {
  open: boolean;
  onClose: () => void;
  /** Called when the user submits credentials. Should throw on failure. */
  onLogin: (email: string, password: string) => Promise<void>;
};

export const LoginModal: React.FC<LoginModalProps> = ({
  open,
  onClose,
  onLogin,
}) => {
  const [form] = Form.useForm<{ email: string; password: string }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: { email: string; password: string }) {
    setError(null);
    setLoading(true);
    try {
      await onLogin(values.email, values.password);
      form.resetFields();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    form.resetFields();
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
        <div className="text-center mb-4">
          <Typography.Title level={4} style={{ marginBottom: 4 }}>
            Sign in
          </Typography.Title>
          <Typography.Text type="secondary">
            Enter your email and password to continue
          </Typography.Text>
        </div>

        {error && (
          <Alert type="error" showIcon message={error} className="mb-4" />
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
          autoComplete="on"
        >
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: "Please enter your email" },
              { type: "email", message: "Please enter a valid email address" },
            ]}
          >
            <Input
              size="large"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: "Please enter your password" }]}
          >
            <Input.Password
              size="large"
              placeholder="Password"
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={loading}
            >
              Sign in
            </Button>
          </Form.Item>
        </Form>

        <Typography.Text
          type="secondary"
          style={{ fontSize: 12, display: "block", textAlign: "center", marginTop: 12 }}
        >
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </Typography.Text>
      </div>
    </Modal>
  );
};
