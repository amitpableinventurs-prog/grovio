import { useState, type ReactNode } from 'react';
import { Button, Card, Col, Form, Input, Row, Select, Spin, Tabs, Typography, App as AntApp } from 'antd';
import { CarOutlined, CreditCardOutlined, PhoneOutlined, SettingOutlined, WalletOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchSettings, updateSettings } from '../api/settings';
import { IvrCard, PaymentOptionsCard, PayuCard, PhonepeCard, RiderPayCard, SosCard, TrackingCard, VoipCard } from '../components/settings/IntegrationCards';
import { INTEGRATION_DEFAULTS } from '../components/settings/defaults';
import { HubConditionsCard, RiderRateCard } from '../components/settings/RiderRateCard';

// Fields whose fetched value is a masked placeholder (e.g. "••••1234"), never the real secret —
// see SECRET_KEYS in backend/src/controllers/admin/settings.controller.js. These must NOT be
// pre-filled into the form (submitting the mask back would overwrite the real value with it); the
// masked value is shown as a separate "Current: ••••1234" hint instead, and the input starts empty.
const SECRET_KEYS = [
  'razorpayKeySecret', 'razorpayWebhookSecret', 'smsApiKey', 'smsApiSecret', 'googleMapsApiKey',
  'payuSalt', 'phonepeClientSecret', 'phonepeWebhookPassword', 'exotelApiKey', 'exotelApiToken', 'ivrWebhookToken',
  'twilioAuthToken', 'twilioApiKeySecret',
];

// The rate card and hub conditions on this tab save on their own, not with Save Settings.
const RIDER_PAY_TAB = 'rider-pay';

function secretHint(value?: string | null) {
  return value ? `Current: ${value}` : 'Not configured';
}

// Two independent card stacks, side by side on wide screens and one column below xl.
function Columns({ left, right }: { left: ReactNode; right: ReactNode }) {
  const stack = { display: 'grid', gap: 16, alignContent: 'start' } as const;
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={12} style={stack}>{left}</Col>
      <Col xs={24} xl={12} style={stack}>{right}</Col>
    </Row>
  );
}

export default function SettingsPage() {
  const [form] = Form.useForm();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('general');
  const [dirty, setDirty] = useState(false);
  const smsProvider = Form.useWatch('smsProvider', form);
  const ivrProvider = Form.useWatch('ivrProvider', form);
  const voipProvider = Form.useWatch('voipProvider', form);

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      message.success('Settings saved');
      setDirty(false);
      // Refetched values become the form's new initialValues, so Discard resets to what was saved.
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['ivr-config'] });
      queryClient.invalidateQueries({ queryKey: ['voip-config'] });
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

  // A field that fails validation may sit on a tab that isn't open — switch to it first.
  const showFirstError = ({ errorFields }: { errorFields: { name: (string | number)[] }[] }) => {
    const first = errorFields[0];
    if (!first) return;
    const paneKey = document.getElementById(first.name.join('_'))?.closest('[data-settings-tab]')?.getAttribute('data-settings-tab');
    if (paneKey) setTab(paneKey);
    setTimeout(() => form.scrollToField(first.name, { block: 'center' }), 50);
    message.error('Fix the highlighted field before saving');
  };

  // Every pane is force-rendered so all fields stay registered and are saved together.
  const pane = (key: string, children: ReactNode) => <div data-settings-tab={key}>{children}</div>;

  return (
    <div>
      <Typography.Title level={3} style={{ marginBottom: 4 }}>Settings</Typography.Title>
      <Typography.Paragraph type="secondary">Platform-wide configuration. Saved changes take effect immediately — no restart needed.</Typography.Paragraph>

      {/* No <form> element of its own: the Rider pay tab nests the rate card's separate form. */}
      <Form
        form={form}
        component={false}
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={() => setDirty(true)}
        onFinish={(values) => mutation.mutate(values)}
        onFinishFailed={showFirstError}
      >
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'general',
              label: 'General',
              icon: <SettingOutlined />,
              forceRender: true,
              children: pane('general', (
                <Columns
                  left={
                    <Card title="General">
                      <Typography.Paragraph type="secondary">
                        Delivery, handling, packing and surcharge are set on the <Link to="/charges">Charges</Link> page.
                      </Typography.Paragraph>
                      <Row gutter={16}>
                        <Col xs={24} sm={12}>
                          <Form.Item name="commissionPercent" label="Default Vendor Commission (%)">
                            <Input type="number" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item name="minOrderAmount" label="Minimum Order Amount (₹)">
                            <Input type="number" />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item name="appVersion" label="App Version">
                        <Input />
                      </Form.Item>
                      <Form.Item name="publicBaseUrl" label="Public server URL" extra="Where this API is reachable from the internet, e.g. https://api.grovio.in — used by payment callbacks, IVR / VoIP webhooks and hub screen links">
                        <Input placeholder="https://api.example.com" />
                      </Form.Item>
                      <Form.Item name="customerWebUrl" label="Customer website URL" extra="Customers return here after paying with PayU / PhonePe">
                        <Input placeholder="https://grovio.in" />
                      </Form.Item>
                    </Card>
                  }
                  right={
                    <Card title="Google Maps">
                      <Typography.Paragraph type="secondary">
                        Used for the delivery app's map: road routes and "13 mins | 4.3 km away" times to the store and the customer.
                        Enable the Routes API on this key in Google Cloud. Without a key, distances are estimated in a straight line.
                      </Typography.Paragraph>
                      <Form.Item name="googleMapsApiKey" label="API Key" extra={secretHint(data?.googleMapsApiKey)}>
                        <Input.Password placeholder="Leave blank to keep existing" autoComplete="new-password" />
                      </Form.Item>
                    </Card>
                  }
                />
              )),
            },
            {
              key: 'payments',
              label: 'Payments',
              icon: <CreditCardOutlined />,
              forceRender: true,
              children: pane('payments', (
                <Columns
                  left={
                    <>
                      <PaymentOptionsCard />
                      <Card title="Payment Gateway — Razorpay">
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
                    </>
                  }
                  right={
                    <>
                      <PhonepeCard data={data} />
                      <PayuCard data={data} />
                    </>
                  }
                />
              )),
            },
            {
              key: 'communication',
              label: 'SMS & Calls',
              icon: <PhoneOutlined />,
              forceRender: true,
              children: pane('communication', (
                <Columns
                  left={
                    <>
                      <Card title="SMS Gateway">
                        <Typography.Paragraph type="secondary">
                          Used to deliver OTP codes. Leave as "None" to keep dev-mode behavior (OTP logged to the server console / returned in the API response).
                        </Typography.Paragraph>
                        <Form.Item name="smsProvider" label="Provider">
                          <Select
                            placeholder="Not set — SMS_PROVIDER from .env, else None (dev mode)"
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
                      <VoipCard data={data} provider={voipProvider} />
                    </>
                  }
                  right={<IvrCard data={data} provider={ivrProvider} />}
                />
              )),
            },
            {
              key: 'delivery',
              label: 'Delivery & Safety',
              icon: <CarOutlined />,
              forceRender: true,
              children: pane('delivery', (
                <Columns
                  left={
                    <>
                      <TrackingCard />
                      <RiderPayCard />
                    </>
                  }
                  right={<SosCard smsProvider={smsProvider} />}
                />
              )),
            },
            {
              key: RIDER_PAY_TAB,
              label: 'Rider Pay',
              icon: <WalletOutlined />,
              children: (
                <div style={{ display: 'grid', gap: 16 }}>
                  <RiderRateCard />
                  <HubConditionsCard />
                </div>
              ),
            },
          ]}
        />

        {tab !== RIDER_PAY_TAB && (
          <div
            style={{
              position: 'sticky',
              bottom: 0,
              zIndex: 10,
              marginTop: 16,
              padding: '12px 16px',
              background: '#fff',
              borderRadius: 8,
              boxShadow: '0 -2px 12px rgba(0, 0, 0, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 16,
            }}
          >
            <Typography.Text type={dirty ? 'warning' : 'secondary'}>
              {dirty ? 'You have unsaved changes' : 'All changes saved'}
            </Typography.Text>
            <Button onClick={() => { form.resetFields(); setDirty(false); }} disabled={!dirty || mutation.isPending}>
              Discard
            </Button>
            <Button type="primary" onClick={() => form.submit()} loading={mutation.isPending}>
              Save Settings
            </Button>
          </div>
        )}
      </Form>
    </div>
  );
}
