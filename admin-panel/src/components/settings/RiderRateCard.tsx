import { useEffect, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Checkbox, Col, Descriptions, Form, Input, InputNumber, Row, Select, Space, Spin, Switch, Table, Tag, Typography } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchHubConditions, fetchRiderPayPolicy, previewRiderPay, saveRiderPayPolicy, setHubConditions,
  type HubConditions, type PayQuote, type RainLevel, type RiderPayPolicy, type SurgeLevel,
} from '../../api/riderPay';

// Delivery partner KM earning + incentives (backend services/riderPay.service.js): the rate card,
// a one-order pay preview, and each hub's rain / surge. Saved separately from the main Settings
// form (PUT /admin/rider-pay/policy, PUT /admin/stores/:id/rider-conditions).

const HHMM = /^\d{2}:\d{2}$/;
const money = (n?: number | null) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const num = (width = 110, extra: Record<string, unknown> = {}) => <InputNumber min={0} style={{ width }} {...extra} />;
const section = (text: string) => <Typography.Text strong style={{ display: 'block', margin: '16px 0 8px' }}>{text}</Typography.Text>;

// Editable [{ field, amount }] table (KM slabs, heavy load, daily / weekly slabs).
function SlabList({ name, field, fieldLabel, withTier = false, addLabel }: { name: string; field: string; fieldLabel: string; withTier?: boolean; addLabel: string }) {
  return (
    <Form.List name={name}>
      {(rows, { add, remove }) => (
        <>
          {rows.map(({ key, name: row }) => (
            <Space key={key} align="baseline" style={{ display: 'flex' }}>
              <Form.Item name={[row, field]} rules={[{ required: true, message: 'Required' }]} style={{ marginBottom: 8 }}>
                {num(130, { addonBefore: fieldLabel })}
              </Form.Item>
              <Form.Item name={[row, 'amount']} rules={[{ required: true, message: 'Required' }]} style={{ marginBottom: 8 }}>
                {num(120, { addonBefore: '₹' })}
              </Form.Item>
              {withTier && (
                <Form.Item name={[row, 'tier']} style={{ marginBottom: 8 }}>
                  <Input placeholder="Tier (optional)" style={{ width: 130 }} />
                </Form.Item>
              )}
              <MinusCircleOutlined onClick={() => remove(row)} />
            </Space>
          ))}
          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add()}>{addLabel}</Button>
        </>
      )}
    </Form.List>
  );
}

function PayPreview() {
  const [input, setInput] = useState<{ km: number; kg?: number | null; time?: string; rain: RainLevel; surge: SurgeLevel }>({ km: 4.2, kg: null, time: '19:30', rain: 'none', surge: 'none' });
  const [quote, setQuote] = useState<PayQuote | null>(null);
  const run = useMutation({ mutationFn: () => previewRiderPay(input), onSuccess: setQuote });
  return (
    <>
      {section('Preview one order (saved rates)')}
      <Space wrap align="end">
        <div><Typography.Text type="secondary">Mapped km</Typography.Text><br /><InputNumber min={0} step={0.1} value={input.km} onChange={(v) => setInput({ ...input, km: Number(v) || 0 })} style={{ width: 100 }} /></div>
        <div><Typography.Text type="secondary">Weight kg</Typography.Text><br /><InputNumber min={0} value={input.kg ?? undefined} onChange={(v) => setInput({ ...input, kg: v === null ? null : Number(v) })} style={{ width: 100 }} /></div>
        <div><Typography.Text type="secondary">Time</Typography.Text><br /><Input value={input.time} onChange={(e) => setInput({ ...input, time: e.target.value })} placeholder="HH:mm" style={{ width: 90 }} /></div>
        <div><Typography.Text type="secondary">Rain</Typography.Text><br /><Select value={input.rain} onChange={(rain) => setInput({ ...input, rain })} style={{ width: 110 }} options={RAIN_OPTIONS} /></div>
        <div><Typography.Text type="secondary">Surge</Typography.Text><br /><Select value={input.surge} onChange={(surge) => setInput({ ...input, surge })} style={{ width: 110 }} options={SURGE_OPTIONS} /></div>
        <Button onClick={() => run.mutate()} loading={run.isPending}>Preview</Button>
      </Space>
      {quote && (
        <Descriptions size="small" column={3} bordered style={{ marginTop: 12 }}>
          <Descriptions.Item label="KM pay">{money(quote.basePayout)} <Typography.Text type="secondary">({quote.kmSlab})</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="Peak / surge">{money(quote.peakBonus)}</Descriptions.Item>
          <Descriptions.Item label="Rain">{money(quote.rainBonus)}</Descriptions.Item>
          <Descriptions.Item label="Heavy load">{money(quote.heavyLoadBonus)}</Descriptions.Item>
          <Descriptions.Item label="Estimated total" span={2}><b>{money(quote.total)}</b></Descriptions.Item>
        </Descriptions>
      )}
    </>
  );
}

export function RiderRateCard() {
  const [form] = Form.useForm<RiderPayPolicy>();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['rider-pay-policy'], queryFn: fetchRiderPayPolicy });

  useEffect(() => {
    if (data) form.setFieldsValue(data.policy);
  }, [data, form]);

  const save = useMutation({
    mutationFn: (values: RiderPayPolicy) => {
      const { level: _level, ...policy } = values;
      policy.daily = (policy.daily || []).map((s) => ({ ...s, tier: s.tier ? String(s.tier).trim() || null : null }));
      policy.waiting = { ...policy.waiting, maxPay: policy.waiting?.maxPay ?? null };
      return saveRiderPayPolicy(policy);
    },
    onSuccess: (policy) => {
      message.success('Rate card saved');
      queryClient.setQueryData(['rider-pay-policy'], (old: typeof data) => (old ? { ...old, policy } : old));
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not save the rate card'),
  });

  return (
    <Card title="Delivery Partner Rate Card — KM earning + incentives">
      {isLoading ? <Spin /> : (
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Typography.Paragraph type="secondary">
            Each delivered order earns its KM slab for the hub → drop mapped distance (the order's value never changes it), plus peak, rain and
            heavy-load bonuses. The app shows this quote before the partner accepts, and the final pay is never below it. Daily and weekly slabs and the
            minimum guarantee are paid after each day / week ends, if the partner is eligible.
          </Typography.Paragraph>

          {/* Per-order pay on the left, per-day / per-week pay and rules on the right. */}
          <Row gutter={32}>
            <Col xs={24} xl={12}>
              {section('KM slabs (first slab whose "up to km" covers the distance)')}
              <SlabList name="kmSlabs" field="upToKm" fieldLabel="up to km" addLabel="Add slab" />
              <Form.Item name="perKmBeyond" label="Beyond the last slab: ₹ per started km" style={{ marginTop: 12 }}>{num(160)}</Form.Item>

              {section('Peak / surge (₹ per delivery)')}
              <Space wrap align="start">
                <Form.Item name={['peak', 'amount']} label="In peak windows">{num()}</Form.Item>
                <Form.Item name={['peak', 'highSurgeAmount']} label="Hub on high surge">{num()}</Form.Item>
              </Space>
              <Form.List name={['peak', 'windows']}>
                {(rows, { add, remove }) => (
                  <>
                    {rows.map(({ key, name: row }) => (
                      <Space key={key} align="baseline">
                        <Form.Item name={[row, 'from']} rules={[{ pattern: HHMM, required: true, message: 'HH:mm' }]} style={{ marginBottom: 8 }}><Input addonBefore="from" placeholder="18:00" style={{ width: 130 }} /></Form.Item>
                        <Form.Item name={[row, 'to']} rules={[{ pattern: HHMM, required: true, message: 'HH:mm' }]} style={{ marginBottom: 8 }}><Input addonBefore="to" placeholder="22:00" style={{ width: 130 }} /></Form.Item>
                        <MinusCircleOutlined onClick={() => remove(row)} />
                      </Space>
                    ))}
                    <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add({ from: '', to: '' })}>Add peak window</Button>
                  </>
                )}
              </Form.List>

              {section('Rain (₹ per delivery, by the hub\'s rain level)')}
              <Space wrap align="start">
                <Form.Item name={['rain', 'normal']} label="Normal">{num()}</Form.Item>
                <Form.Item name={['rain', 'heavy']} label="Heavy">{num()}</Form.Item>
                <Form.Item name={['rain', 'severe']} label="Severe">{num()}</Form.Item>
              </Space>

              {section('Heavy load (order weight from product weights)')}
              <SlabList name="heavyLoad" field="minKg" fieldLabel="from kg" addLabel="Add weight slab" />

              {section('Waiting & cancellation pay (0 = off)')}
              <Space wrap align="start">
                <Form.Item name={['waiting', 'freeMinutes']} label="Free minutes per stop">{num()}</Form.Item>
                <Form.Item name={['waiting', 'perMinute']} label="₹ per extra minute">{num()}</Form.Item>
                <Form.Item name={['waiting', 'maxPay']} label="Max per order (₹)" extra="Blank = no cap">{num()}</Form.Item>
              </Space>
              <Space wrap align="start">
                <Form.Item name={['cancellation', 'arrivedAtPickup']} label="Cancelled after reaching hub (₹)">{num(160)}</Form.Item>
                <Form.Item name={['cancellation', 'pickedUp']} label="Cancelled after pickup (₹)">{num(160)}</Form.Item>
              </Space>
            </Col>

            <Col xs={24} xl={12}>
              {section('Daily slabs (deliveries in a day → bonus; tier name shown in the app)')}
              <SlabList name="daily" field="deliveries" fieldLabel="deliveries" withTier addLabel="Add daily slab" />

              {section('Weekly slabs (Mon–Sun)')}
              <SlabList name="weekly" field="deliveries" fieldLabel="deliveries" addLabel="Add weekly slab" />

              {section('Minimum guarantee (per day)')}
              <Space wrap align="end">
                <Form.Item name={['guarantee', 'enabled']} label="On" valuePropName="checked"><Switch /></Form.Item>
                <Form.Item name={['guarantee', 'amount']} label="Amount (₹)">{num()}</Form.Item>
                <Form.Item name={['guarantee', 'minOnlineMinutes']} label="Min online (minutes)">{num(140)}</Form.Item>
                <Form.Item name={['guarantee', 'minDeliveries']} label="Min deliveries">{num()}</Form.Item>
                <Form.Item name={['guarantee', 'requireGig']} valuePropName="checked"><Checkbox>Needs a completed gig</Checkbox></Form.Item>
              </Space>

              {section('Eligibility & settlement')}
              <Space wrap align="start">
                <Form.Item name={['eligibility', 'maxCancellationRatePct']} label="Max cancellation rate (%)">{num(150)}</Form.Item>
                <Form.Item name={['eligibility', 'minOrdersForRate']} label="Check rate from (orders)">{num(150)}</Form.Item>
                <Form.Item name="settleDelayHours" label="Settle after (hours)" extra="Time to flag fraud / complaints">{num(150)}</Form.Item>
              </Space>
            </Col>
          </Row>
          <Alert type="info" showIcon style={{ marginBottom: 16 }} title="GPS / payment manipulation and verified customer complaints aren't detected automatically — withhold that day or week from the delivery partner's page." />

          <Space>
            <Button type="primary" htmlType="submit" loading={save.isPending}>Save rate card</Button>
            {data && <Button onClick={() => form.setFieldsValue(data.defaults)}>Load GoGrovio defaults</Button>}
          </Space>

          <PayPreview />
        </Form>
      )}
    </Card>
  );
}

const RAIN_OPTIONS = [
  { value: 'none', label: 'No rain' },
  { value: 'normal', label: 'Rain' },
  { value: 'heavy', label: 'Heavy rain' },
  { value: 'severe', label: 'Severe' },
];
const SURGE_OPTIONS = [
  { value: 'none', label: 'Normal' },
  { value: 'high', label: 'High surge' },
];
const DURATIONS = [
  { value: 0, label: 'Until switched off' },
  { value: 1, label: 'For 1 hour' },
  { value: 2, label: 'For 2 hours' },
  { value: 4, label: 'For 4 hours' },
  { value: 8, label: 'For 8 hours' },
];

function HubRow({ hub }: { hub: HubConditions }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [rain, setRain] = useState<RainLevel>(hub.active.rain);
  const [surge, setSurge] = useState<SurgeLevel>(hub.active.surge);
  const [hours, setHours] = useState(0);
  const apply = useMutation({
    mutationFn: () => setHubConditions(hub.storeId, { rain, surge, until: hours ? new Date(Date.now() + hours * 3600000).toISOString() : null }),
    onSuccess: () => {
      message.success(`${hub.storeName} updated`);
      queryClient.invalidateQueries({ queryKey: ['hub-conditions'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not update'),
  });
  return (
    <Space wrap align="start">
      <Select value={rain} onChange={setRain} options={RAIN_OPTIONS} style={{ width: 120 }} />
      <Select value={surge} onChange={setSurge} options={SURGE_OPTIONS} style={{ width: 120 }} />
      <Select value={hours} onChange={setHours} options={DURATIONS} style={{ width: 160 }} />
      <Button size="small" type="primary" onClick={() => apply.mutate()} loading={apply.isPending}>Apply</Button>
    </Space>
  );
}

export function HubConditionsCard() {
  const { data, isLoading } = useQuery({ queryKey: ['hub-conditions'], queryFn: fetchHubConditions, refetchInterval: 60_000 });
  return (
    <Card title="Hub rain & surge (delivery partner bonuses)">
      <Typography.Paragraph type="secondary">
        Applies to deliveries from now. Only switch on severe-weather pay where riding is safely permitted — safety and road rules come before any target.
      </Typography.Paragraph>
      <Table<HubConditions>
        rowKey="storeId"
        size="small"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        columns={[
          { title: 'Hub', dataIndex: 'storeName' },
          {
            title: 'Now',
            render: (_, h) => (
              <Space size={4} wrap>
                {h.active.rain !== 'none' && <Tag color="blue">{RAIN_OPTIONS.find((o) => o.value === h.active.rain)?.label}</Tag>}
                {h.active.surge === 'high' && <Tag color="orange">High surge</Tag>}
                {h.active.rain === 'none' && h.active.surge === 'none' && <Tag>Normal</Tag>}
                {h.until && (h.active.rain !== 'none' || h.active.surge !== 'none') && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>until {new Date(h.until).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</Typography.Text>
                )}
              </Space>
            ),
          },
          { title: 'Change', render: (_, h) => <HubRow key={`${h.storeId}:${h.active.rain}:${h.active.surge}`} hub={h} /> },
        ]}
      />
    </Card>
  );
}
