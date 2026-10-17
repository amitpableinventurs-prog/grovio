import { useState } from 'react';
import {
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Segmented,
  Space,
  Spin,
  Switch,
  Typography,
  App as AntApp,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchCharges, saveCharges } from '../api/charges';
import type { ChargeConfig, ChargeRule } from '../types';
import { formatCurrency } from '../utils/format';

type ChargeKey = keyof ChargeConfig;

const CHARGES: { key: ChargeKey; title: string; hint: string }[] = [
  { key: 'delivery', title: 'Delivery charge', hint: 'Charged once per order. Can be made free above an order value.' },
  { key: 'handling', title: 'Handling charge', hint: 'A platform/handling fee on every order.' },
  { key: 'packing', title: 'Packing charge', hint: 'Covers bags and packaging.' },
  { key: 'surcharge', title: 'Surcharge', hint: 'Turn on for rain or peak hours; customers see your label on the bill.' },
];

// Same maths as backend/src/services/charges.service.js#computeCharges, for the preview only —
// the backend always recalculates at checkout.
const round2 = (n: number) => Math.round(n * 100) / 100;
function amountOf(rule: Partial<ChargeRule> | undefined, itemTotal: number) {
  if (!rule?.enabled) return 0;
  const value = Number(rule.value) || 0;
  return rule.type === 'percent' ? round2((itemTotal * value) / 100) : round2(value);
}

function Preview({ config }: { config?: Partial<ChargeConfig> }) {
  const [itemTotal, setItemTotal] = useState(299);
  const deliveryBase = amountOf(config?.delivery, itemTotal);
  const freeAbove = Number(config?.delivery?.freeAbove) || 0;
  const freeDelivery = !!config?.delivery?.enabled && freeAbove > 0 && itemTotal >= freeAbove;
  const lines = [
    { label: 'Delivery', value: freeDelivery ? 0 : deliveryBase, note: freeDelivery ? 'Free' : undefined, show: !!config?.delivery?.enabled },
    { label: 'Handling', value: amountOf(config?.handling, itemTotal), show: !!config?.handling?.enabled },
    { label: 'Packing', value: amountOf(config?.packing, itemTotal), show: !!config?.packing?.enabled },
    { label: config?.surcharge?.label?.trim() || 'Surcharge', value: amountOf(config?.surcharge, itemTotal), show: !!config?.surcharge?.enabled },
  ];
  const total = round2(itemTotal + lines.reduce((sum, l) => sum + l.value, 0));

  return (
    <Card title="Customer bill preview" size="small" style={{ position: 'sticky', top: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Try a cart value</Typography.Text>
          <InputNumber
            id="preview-item-total"
            min={0}
            value={itemTotal}
            onChange={(v) => setItemTotal(Number(v) || 0)}
            prefix="₹"
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ display: 'grid', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Item total</span>
            <span>{formatCurrency(itemTotal)}</span>
          </div>
          {lines.filter((l) => l.show).map((l) => (
            <div key={l.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography.Text type="secondary">{l.label}</Typography.Text>
              {l.note ? (
                <span><Typography.Text delete type="secondary">{formatCurrency(deliveryBase)}</Typography.Text> <Typography.Text type="success">{l.note}</Typography.Text></span>
              ) : (
                <span>{formatCurrency(l.value)}</span>
              )}
            </div>
          ))}
          <Divider style={{ margin: '4px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
            <span>To pay</span>
            <span>{formatCurrency(total)}</span>
          </div>
        </div>
        {config?.delivery?.enabled && freeAbove > 0 && !freeDelivery && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Customer sees: “Add {formatCurrency(freeAbove - itemTotal)} more for free delivery”
          </Typography.Text>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>Coupon discounts come off after these charges.</Typography.Text>
      </Space>
    </Card>
  );
}

export default function ChargesPage() {
  const [form] = Form.useForm<ChargeConfig>();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const values = Form.useWatch([], form) as Partial<ChargeConfig> | undefined;

  const { data, isLoading } = useQuery({ queryKey: ['charges'], queryFn: fetchCharges });

  const mutation = useMutation({
    mutationFn: saveCharges,
    onSuccess: (saved) => {
      message.success('Charges saved — they apply to new orders from now on');
      queryClient.setQueryData(['charges'], saved);
      form.setFieldsValue(saved);
    },
    onError: (err: any) => {
      const field = err?.response?.data?.errors?.[0];
      message.error(field?.message || err?.response?.data?.message || 'Could not save charges');
    },
  });

  if (isLoading || !data) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <Typography.Title level={3} style={{ marginBottom: 4 }}>Charges</Typography.Title>
      <Typography.Paragraph type="secondary">
        Added to every order at checkout, once per order. Each charge is a fixed amount or a percentage of the item total.
        Changes apply to new orders only; orders already placed keep their charges.
      </Typography.Paragraph>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={15}>
          <Form form={form} layout="vertical" initialValues={data} onFinish={(v) => mutation.mutate(v)} requiredMark={false}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {CHARGES.map(({ key, title, hint }) => {
                const rule = values?.[key];
                const enabled = !!rule?.enabled;
                const isPercent = rule?.type === 'percent';
                return (
                  <Card
                    key={key}
                    size="small"
                    title={title}
                    extra={
                      <Form.Item name={[key, 'enabled']} valuePropName="checked" noStyle>
                        <Switch id={`${key}-enabled`} checkedChildren="On" unCheckedChildren="Off" />
                      </Form.Item>
                    }
                  >
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>{hint}</Typography.Paragraph>
                    <Row gutter={16}>
                      <Col xs={24} sm={10}>
                        <Form.Item name={[key, 'type']} label="Charge as">
                          <Segmented
                            id={`${key}-type`}
                            disabled={!enabled}
                            options={[
                              { label: 'Fixed ₹', value: 'fixed' },
                              { label: '% of items', value: 'percent' },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={14}>
                        <Form.Item
                          name={[key, 'value']}
                          label={isPercent ? 'Percentage' : 'Amount'}
                          rules={[
                            { required: enabled, message: 'Enter a value' },
                            ...(isPercent ? [{ type: 'number' as const, max: 100, message: 'At most 100%' }] : []),
                          ]}
                        >
                          <InputNumber
                            id={`${key}-value`}
                            disabled={!enabled}
                            min={0}
                            precision={2}
                            prefix={isPercent ? undefined : '₹'}
                            suffix={isPercent ? '%' : undefined}
                            style={{ width: '100%' }}
                          />
                        </Form.Item>
                      </Col>
                      {key === 'delivery' && (
                        <Col span={24}>
                          <Form.Item
                            name={['delivery', 'freeAbove']}
                            label="Free delivery when item total is at least"
                            extra="Set 0 to always charge delivery. Riders are still paid the delivery charge on free-delivery orders."
                          >
                            <InputNumber id="delivery-freeAbove" disabled={!enabled} min={0} precision={2} prefix="₹" style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>
                      )}
                      {key === 'surcharge' && (
                        <Col span={24}>
                          <Form.Item
                            name={['surcharge', 'label']}
                            label="Label shown to customers"
                            rules={[{ max: 40, message: 'Keep it under 40 characters' }]}
                          >
                            <Input id="surcharge-label" disabled={!enabled} placeholder="e.g. Rain surcharge, Late-night fee" maxLength={40} />
                          </Form.Item>
                        </Col>
                      )}
                    </Row>
                  </Card>
                );
              })}

              <Space>
                <Button type="primary" htmlType="submit" loading={mutation.isPending}>Save charges</Button>
                <Button onClick={() => form.setFieldsValue(data)} disabled={mutation.isPending}>Discard changes</Button>
              </Space>
            </Space>
          </Form>
        </Col>
        <Col xs={24} lg={9}>
          <Preview config={values} />
        </Col>
      </Row>
    </div>
  );
}
