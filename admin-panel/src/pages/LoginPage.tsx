import { Button, Card, Form, Input, Typography, App as AntApp } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { login } from '../api/auth';
import { useAuthStore } from '../store/authStore';

interface LoginForm {
  email: string;
  password: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const { message } = AntApp.useApp();

  const mutation = useMutation({
    mutationFn: (values: LoginForm) => login(values.email, values.password),
    onSuccess: (data) => {
      if (data.user.role !== 'admin') {
        message.error('Yeh login sirf admin ke liye hai.');
        return;
      }
      setSession(data);
      message.success('Login successful');
      navigate('/dashboard', { replace: true });
    },
    onError: () => {
      message.error('Invalid email ya password.');
    },
  });

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #16a34a 0%, #0f766e 100%)',
      }}
    >
      <Card style={{ width: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="/brand/grovio-logo.svg" alt="Grovio — Freshness. Faster. Everyday." style={{ height: 76, width: 'auto', marginBottom: 8 }} />
          <Typography.Title level={4} style={{ margin: '4px 0 0', color: '#0f3d22' }}>
            Admin Panel
          </Typography.Title>
          <Typography.Text type="secondary">Sign in to manage your platform</Typography.Text>
        </div>
        <Form layout="vertical" onFinish={(values) => mutation.mutate(values)} autoComplete="off">
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input prefix={<UserOutlined />} placeholder="admin@grovio.com" size="large" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="••••••••" size="large" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={mutation.isPending}>
              Log In
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
