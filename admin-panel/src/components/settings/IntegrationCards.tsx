import { Card, Form, Input, Select, Typography, Alert, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { fetchIvrConfig } from '../../api/ivr';

// Settings page sections for payment gateways, tracking and IVR. Every value is stored as a string
// setting (backend Setting model); secrets are masked by the API and left blank here to keep them.

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1').replace(/\/api\/v1\/?$/, '');
const ON_OFF = [
  { value: 'true', label: 'On' },
  { value: 'false', label: 'Off' },
];

function secretHint(value?: string | null) {
  return value ? `Current: ${value}` : 'Not configured';
}

const secretInput = <Input.Password placeholder="Leave blank to keep existing" autoComplete="new-password" />;

// Comma-separated string setting <-> multi-select value. An empty selection is saved as 'none' —
// a blank setting would fall back to the backend defaults instead of switching everything off.
const csvProps = {
  getValueProps: (v?: string) => ({ value: v ? String(v).split(',').filter((e) => e && e !== 'none') : [] }),
  normalize: (v: string[]) => (v?.length ? v.join(',') : 'none'),
};

const EVENT_LABELS: Record<string, string> = {
  accepted: 'Order accepted by store',
  out_for_delivery: 'Out for delivery',
  delivery_failed: 'Delivery failed',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  rider_nearby: 'Rider nearby (delivery alert)',
  rider_arrived: 'Rider arrived (delivery alert)',
};

type Settings = Record<string, string | null | undefined> | undefined;

export function PaymentOptionsCard() {
  return (
    <Card title="Checkout Payment Options" style={{ maxWidth: 640 }}>
      <Typography.Paragraph type="secondary">
        What customers can pick at checkout. PayU and PhonePe only appear once their keys below are set. Wallet is always available.
      </Typography.Paragraph>
      <Space wrap size="large">
        <Form.Item name="codEnabled" label="Cash on Delivery"><Select style={{ width: 110 }} options={ON_OFF} /></Form.Item>
        <Form.Item name="razorpayEnabled" label="Razorpay"><Select style={{ width: 110 }} options={ON_OFF} /></Form.Item>
        <Form.Item name="phonepeEnabled" label="PhonePe"><Select style={{ width: 110 }} options={ON_OFF} /></Form.Item>
        <Form.Item name="payuEnabled" label="PayU"><Select style={{ width: 110 }} options={ON_OFF} /></Form.Item>
      </Space>
    </Card>
  );
}

export function PayuCard({ data }: { data: Settings }) {
  return (
    <Card title="Payment Gateway — PayU" style={{ maxWidth: 640 }}>
      <Typography.Paragraph type="secondary">
        From the PayU dashboard (Developers &gt; API Keys). In PayU, set the webhook URL to{' '}
        <Typography.Text code copyable>{`${API_ORIGIN}/api/v1/payments/payu/webhook`}</Typography.Text>
      </Typography.Paragraph>
      <Form.Item name="payuMode" label="Mode">
        <Select options={[{ value: 'test', label: 'Test (test.payu.in)' }, { value: 'live', label: 'Live (secure.payu.in)' }]} />
      </Form.Item>
      <Form.Item name="payuKey" label="Merchant Key"><Input /></Form.Item>
      <Form.Item name="payuSalt" label="Merchant Salt (v1)" extra={secretHint(data?.payuSalt)}>{secretInput}</Form.Item>
    </Card>
  );
}

export function PhonepeCard({ data }: { data: Settings }) {
  return (
    <Card title="Payment Gateway — PhonePe" style={{ maxWidth: 640 }}>
      <Typography.Paragraph type="secondary">
        PhonePe PG Standard Checkout credentials (Business dashboard &gt; Developer Settings). Webhook URL:{' '}
        <Typography.Text code copyable>{`${API_ORIGIN}/api/v1/payments/phonepe/webhook`}</Typography.Text>{' '}
        — use the same username and password below.
      </Typography.Paragraph>
      <Form.Item name="phonepeEnv" label="Environment">
        <Select options={[{ value: 'sandbox', label: 'Sandbox (UAT)' }, { value: 'production', label: 'Production' }]} />
      </Form.Item>
      <Form.Item name="phonepeClientId" label="Client ID"><Input /></Form.Item>
      <Form.Item name="phonepeClientSecret" label="Client Secret" extra={secretHint(data?.phonepeClientSecret)}>{secretInput}</Form.Item>
      <Form.Item name="phonepeClientVersion" label="Client Version"><Input placeholder="1" /></Form.Item>
      <Space style={{ display: 'flex' }}>
        <Form.Item name="phonepeWebhookUsername" label="Webhook Username" style={{ flex: 1 }}><Input /></Form.Item>
        <Form.Item name="phonepeWebhookPassword" label="Webhook Password" extra={secretHint(data?.phonepeWebhookPassword)} style={{ flex: 1 }}>{secretInput}</Form.Item>
      </Space>
    </Card>
  );
}

export function TrackingCard() {
  return (
    <Card title="Tracking & Delivery Area" style={{ maxWidth: 640 }}>
      <Typography.Paragraph type="secondary">
        ETAs use straight-line distance × 1.3 at the average speed below. Geofences mark the rider as arrived automatically and
        trigger the "almost there" alert. Per-store delivery radius is set on the Stores page.
      </Typography.Paragraph>
      <Space wrap>
        <Form.Item name="trackingAvgSpeedKmph" label="Average rider speed (km/h)"><Input type="number" placeholder="20" style={{ width: 180 }} /></Form.Item>
        <Form.Item name="trackingPickingMinutes" label="Picking + packing time (min)"><Input type="number" placeholder="10" style={{ width: 180 }} /></Form.Item>
        <Form.Item name="defaultServiceRadiusKm" label="Default delivery radius (km)" extra="Blank = no limit"><Input type="number" style={{ width: 180 }} /></Form.Item>
      </Space>
      <Space wrap>
        <Form.Item name="geofenceNearbyKm" label="“Almost there” alert (km)"><Input type="number" placeholder="1" style={{ width: 180 }} /></Form.Item>
        <Form.Item name="geofencePickupMeters" label="Arrived at hub within (m)"><Input type="number" placeholder="100" style={{ width: 180 }} /></Form.Item>
        <Form.Item name="geofenceDropMeters" label="Arrived at customer within (m)"><Input type="number" placeholder="100" style={{ width: 180 }} /></Form.Item>
      </Space>
    </Card>
  );
}

export function IvrCard({ data, provider }: { data: Settings; provider?: string }) {
  const { data: config } = useQuery({ queryKey: ['ivr-config'], queryFn: fetchIvrConfig });
  const events = config?.availableEvents || Object.keys(EVENT_LABELS);

  return (
    <Card title="IVR — Automatic Calls (Exotel)" style={{ maxWidth: 640 }}>
      <Typography.Paragraph type="secondary">
        With "None", calls are only recorded in Call Logs as simulated. With Exotel, calls go out from your ExoPhone using two
        call flows built in the Exotel dashboard (see the backend README, "IVR").
      </Typography.Paragraph>
      <Form.Item name="ivrProvider" label="Provider">
        <Select options={[{ value: 'none', label: 'None (simulate calls)' }, { value: 'exotel', label: 'Exotel' }]} />
      </Form.Item>

      {provider === 'exotel' && (
        <>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="exotelSid" label="Account SID" style={{ flex: 1 }}><Input /></Form.Item>
            <Form.Item name="exotelSubdomain" label="API host" style={{ flex: 1 }} extra="api.exotel.com or api.in.exotel.com">
              <Input />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="exotelApiKey" label="API Key" extra={secretHint(data?.exotelApiKey)} style={{ flex: 1 }}>{secretInput}</Form.Item>
            <Form.Item name="exotelApiToken" label="API Token" extra={secretHint(data?.exotelApiToken)} style={{ flex: 1 }}>{secretInput}</Form.Item>
          </Space>
          <Form.Item name="exotelCallerId" label="Caller ID (ExoPhone)"><Input placeholder="e.g. 08047xxxxxx" /></Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="exotelMessageAppId" label="Message flow App ID" style={{ flex: 1 }} extra="Greeting → Hangup"><Input /></Form.Item>
            <Form.Item name="exotelConfirmAppId" label="Confirmation flow App ID" style={{ flex: 1 }} extra="Greeting → Gather → Passthru → Greeting"><Input /></Form.Item>
          </Space>
        </>
      )}

      <Form.Item name="ivrAutoCallEvents" label="Call the customer automatically when" {...csvProps}>
        <Select mode="multiple" allowClear options={events.map((e) => ({ value: e, label: EVENT_LABELS[e] || e }))} />
      </Form.Item>
      <Space wrap>
        <Form.Item name="ivrCodConfirmAbove" label="COD confirmation call for orders of ₹" extra="Blank = off, 0 = every COD order">
          <Input type="number" style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="ivrMissedCallCallback" label="Call back after a missed call">
          <Select style={{ width: 120 }} options={ON_OFF} />
        </Form.Item>
      </Space>

      {config && (
        <div style={{ marginTop: 8 }}>
          {!config.publicBaseUrlSet && (
            <Alert style={{ marginBottom: 12 }} type="warning" showIcon
              title="Set “Public server URL” in General — Exotel must be able to reach these webhook URLs." />
          )}
          <Typography.Text strong style={{ display: 'block' }}>Webhook URLs for the Exotel flows</Typography.Text>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', marginTop: 8, fontSize: 12 }}>
            {([
              ['Greeting (dynamic text)', config.webhooks.prompt],
              ['Greeting after key press', `${config.webhooks.prompt}?stage=result`],
              ['Passthru after Gather', config.webhooks.input],
              ['Missed-call number Passthru', config.webhooks.missedCall],
              ['Care menu Greeting', config.webhooks.carePrompt],
              ['Care menu Passthru', config.webhooks.careInput],
              ['Care result Greeting', config.webhooks.careResult],
            ] as const).map(([label, url]) => (
              <WebhookRow key={label} label={label} url={url} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function WebhookRow({ label, url }: { label: string; url: string }) {
  return (
    <>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text copyable={{ text: url }} style={{ wordBreak: 'break-all', fontSize: 12 }}>{url}</Typography.Text>
    </>
  );
}
