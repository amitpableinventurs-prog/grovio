import { Button, Card, Form, Input, Typography, App as AntApp, Spin } from 'antd';
import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchSettings, updateSettings } from '../api/settings';

export default function SettingsPage() {
  const [form] = Form.useForm();
  const { message } = AntApp.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => message.success('Settings saved'),
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <Typography.Title level={3}>Settings</Typography.Title>
      <Card style={{ maxWidth: 480 }}>
        <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => mutation.mutate(values)}>
          <Form.Item name="deliveryFee" label="Default Delivery Fee (₹)">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="commissionPercent" label="Default Vendor Commission (%)">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="minOrderAmount" label="Minimum Order Amount (₹)">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="appVersion" label="App Version">
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            Save Settings
          </Button>
        </Form>
      </Card>
    </div>
  );
}
