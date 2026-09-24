import { Button, Card, Form, Input, Select, Typography, App as AntApp, Spin, Space, Divider } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchSettings, updateSettings } from '../api/settings';
import { IvrCard, PaymentOptionsCard, PayuCard, PhonepeCard, TrackingCard } from '../components/settings/IntegrationCards';
import { INTEGRATION_DEFAULTS } from '../components/settings/defaults';

// Fields whose fetched value is a masked placeholder (e.g. "••••1234"), never the real secret —
// see SECRET_KEYS in backend/src/controllers/admin/settings.controller.js. These must NOT be
// pre-filled into the form (submitting the mask back would overwrite the real value with it); the
// masked value is shown as a separate "Current: ••••1234" hint instead, and the input starts empty.
const SECRET_KEYS = [
  'razorpayKeySecret', 'razorpayWebhookSecret', 'smsApiKey', 'smsApiSecret', 'googleMapsApiKey',
  'payuSalt', 'phonepeClientSecret', 'phonepeWebhookPassword', 'exotelApiKey', 'exotelApiToken', 'ivrWebhookToken',
];

function secretHint(value?: string | null) {
  return value ? `Current: ${value}` : 'Not configured';
}

export default function SettingsPage() {
  const [form] = Form.useForm();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const smsProvider = Form.useWatch('smsProvider', form);
  const ivrProvider = Form.useWatch('ivrProvider', form);

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      message.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: ['ivr-config'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not save settings'),
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  const initialValues = data
    ? { ...INTEGRATION_DEFAULTS, ...Object.fromEntries(Object.entries(data).filter(([key]) => !SECRET_KEYS.includes(key))) }
    : undefined;

  return (
    <div>
      <Typography.Title level={3}>Settings</Typography.Title>

      <Form form={form} layout="vertical" initialValues={initialValues} onFinish={(values) => mutation.mutate(values)}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Card title="General" style={{ maxWidth: 640 }}>
            <Typography.Paragraph type="secondary">
              Delivery, handling, packing and surcharge are set on the <Link to="/charges">Charges</Link> page.
            </Typography.Paragraph>
            <Form.Item name="commissionPercent" label="Default Vendor Commission (%)">
              <Input type="number" />
            </Form.Item>
            <Form.Item name="minOrderAmount" label="Minimum Order Amount (₹)">
              <Input type="number" />
            </Form.Item>
            <Form.Item name="appVersion" label="App Version">
              <Input />
            </Form.Item>
            <Form.Item name="publicBaseUrl" label="Public server URL" extra="Where this API is reachable from the internet, e.g. https://api.grovio.in — used by payment callbacks, IVR webhooks and hub screen links">
              <Input placeholder="https://api.example.com" />
            </Form.Item>
            <Form.Item name="customerWebUrl" label="Customer website URL" extra="Customers return here after paying with PayU / PhonePe">
              <Input placeholder="https://grovio.in" />
            </Form.Item>
          </Card>

          <PaymentOptionsCard />

          <Card title="Payment Gateway — Razorpay" style={{ maxWidth: 640 }}>
            <Typography.Paragraph type="secondary">
              Overrides RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET from .env — takes effect immediately, no restart needed.
            </Typography.Paragraph>
            <Form.Item name="razorpayKeyId" label="Key ID">
              <Input placeholder="rzp_live_..." />
            </Form.Item>
            <Form.Item name="razorpayKeySecret" label="Key Secret" extra={secretHint(data?.razorpayKeySecret)}>
              <Input.Password placeholder="Leave blank to keep existing" autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="razorpayWebhookSecret" label="Webhook Secret" extra={secretHint(data?.razorpayWebhookSecret)}>
              <Input.Password placeholder="Leave blank to keep existing" autoComplete="new-password" />
            </Form.Item>
          </Card>

          <PhonepeCard data={data} />
          <PayuCard data={data} />

          <Card title="SMS Gateway" style={{ maxWidth: 640 }}>
            <Typography.Paragraph type="secondary">
              Used to deliver OTP codes. Leave as "None" to keep dev-mode behavior (OTP logged to the server console / returned in the API response).
            </Typography.Paragraph>
            <Form.Item name="smsProvider" label="Provider">
              <Select
                options={[
                  { value: 'none', label: 'None (dev mode)' },
                  { value: 'msg91', label: 'MSG91' },
                  { value: 'twilio', label: 'Twilio' },
                ]}
              />
            </Form.Item>

            {smsProvider === 'msg91' && (
              <>
                <Form.Item name="smsApiKey" label="MSG91 Auth Key" extra={secretHint(data?.smsApiKey)}>
                  <Input.Password placeholder="Leave blank to keep existing" autoComplete="new-password" />
                </Form.Item>
                <Form.Item name="smsSenderId" label="Sender ID">
                  <Input placeholder="e.g. GROVIO" />
                </Form.Item>
                <Form.Item name="smsTemplateId" label="DLT Flow / Template ID" extra="Must be an approved template with an OTP variable">
                  <Input />
                </Form.Item>
              </>
            )}

            {smsProvider === 'twilio' && (
              <>
                <Form.Item name="smsApiKey" label="Account SID" extra={secretHint(data?.smsApiKey)}>
                  <Input.Password placeholder="Leave blank to keep existing" autoComplete="new-password" />
                </Form.Item>
                <Form.Item name="smsApiSecret" label="Auth Token" extra={secretHint(data?.smsApiSecret)}>
                  <Input.Password placeholder="Leave blank to keep existing" autoComplete="new-password" />
                </Form.Item>
                <Form.Item name="smsSenderId" label="From Number" extra="Must be a Twilio-verified number, e.g. +14155551234">
                  <Input />
                </Form.Item>
              </>
            )}
          </Card>

          <IvrCard data={data} provider={ivrProvider} />
          <TrackingCard />

          <Card title="Google Maps" style={{ maxWidth: 640 }}>
            <Typography.Paragraph type="secondary">
              Stored for use by map/geocoding features. No feature currently consumes this key.
            </Typography.Paragraph>
            <Form.Item name="googleMapsApiKey" label="API Key" extra={secretHint(data?.googleMapsApiKey)}>
              <Input.Password placeholder="Leave blank to keep existing" autoComplete="new-password" />
            </Form.Item>
          </Card>

          <Divider style={{ margin: 0 }} />

          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            Save Settings
          </Button>
        </Space>
      </Form>
    </div>
  );
}
