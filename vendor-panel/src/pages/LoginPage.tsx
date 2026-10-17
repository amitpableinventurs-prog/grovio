import { Button, Card, Form, Input, Typography, App as AntApp } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { login } from '../api/auth';
import { apiErrorMessage } from '../api/client';
import { useAuthStore } from '../store/authStore';

interface LoginForm {
  email: string;
  password: string;
}

// The signup page is served by the backend itself (backend/server.js -> /vendor-signup).
const SIGNUP_URL = `${(import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1').replace(/\/api\/v1\/?$/, '')}/vendor-signup/`;

export default function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const { message } = AntApp.useApp();

  const mutation = useMutation({
    mutationFn: (values: LoginForm) => login(values.email, values.password),
    onSuccess: (data) => {
      setSession(data);
      message.success('Login successful');
      navigate('/dashboard', { replace: true });
    },
    onError: (err) => message.error(apiErrorMessage(err, 'Invalid email or password')),
  });

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'linear-gradient(135deg, #16a34a 0%, #0f766e 100%)',
      }}
    >
      <Card style={{ width: 380, maxWidth: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="/brand/grovio-logo.svg" alt="Grovio — Freshness. Faster. Everyday." style={{ height: 76, width: 'auto', marginBottom: 8 }} />
          <Typography.Title level={4} style={{ margin: '4px 0 0', color: '#0f3d22' }}>
            Vendor Panel
          </Typography.Title>
          <Typography.Text type="secondary">Sign in to manage your store</Typography.Text>
        </div>
        <Form layout="vertical" onFinish={(values) => mutation.mutate(values)} autoComplete="off">
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input prefix={<UserOutlined />} placeholder="you@yourstore.com" size="large" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="••••••••" size="large" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 12 }}>
            <Button type="primary" htmlType="submit" block size="large" loading={mutation.isPending}>
              Log In
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center' }}>
          <Typography.Text type="secondary">New to Grovio? </Typography.Text>
          <a href={SIGNUP_URL}>Register your store</a>
        </div>
      </Card>
    </div>
  );
}
