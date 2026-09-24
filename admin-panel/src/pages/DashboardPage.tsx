import { useState } from 'react';
import { Card, Col, Row, Segmented, Space, Spin, Typography } from 'antd';
import {
  ShopOutlined,
  TeamOutlined,
  CarOutlined,
  UserOutlined,
  AppstoreOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchDashboardStats } from '../api/dashboard';
import type { DashboardRange, DashboardStats } from '../types';
import StatTile from '../components/charts/StatTile';
import TrendChart from '../components/charts/TrendChart';
import ColumnChart from '../components/charts/ColumnChart';
import BarList from '../components/charts/BarList';
import ChartCard from '../components/charts/ChartCard';
import { CHART, fmtCount, fmtRupees, fmtRupeesExact } from '../components/charts/chartKit';

const RANGE_OPTIONS: { value: DashboardRange; label: string; period: string }[] = [
  { value: 'today', label: 'Today', period: 'yesterday' },
  { value: '7d', label: '7 days', period: 'the previous 7 days' },
  { value: '30d', label: '30 days', period: 'the previous 30 days' },
  { value: '90d', label: '90 days', period: 'the previous 90 days' },
];

const PAYMENT_LABELS: Record<string, string> = {
  COD: 'Cash on delivery',
  WALLET: 'Grovio Wallet',
  RAZORPAY: 'Razorpay',
  PHONEPE: 'PhonePe',
  PAYU: 'PayU',
};

const dayLabel = (bucket: string) => new Date(`${bucket}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
const bucketLabel = (bucket: string, granularity: DashboardStats['granularity']) =>
  granularity === 'hour' ? hourLabel(Number(bucket.slice(11, 13))) : dayLabel(bucket);

function OpsItem({ icon, label, value, to, warn }: { icon: React.ReactNode; label: string; value: number; to?: string; warn?: boolean }) {
  const body = (
    <Space size={12} align="center">
      <span style={{ fontSize: 18, color: warn ? CHART.bad : CHART.textSecondary }}>{icon}</span>
      <div>
        <div style={{ fontSize: 20, fontWeight: 600, color: CHART.textPrimary, lineHeight: 1.2 }}>{fmtCount(value)}</div>
        <div style={{ fontSize: 12, color: warn ? CHART.bad : CHART.textSecondary }}>{label}</div>
      </div>
    </Space>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export default function DashboardPage() {
  const [range, setRange] = useState<DashboardRange>('30d');
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['dashboard', range],
    queryFn: () => fetchDashboardStats(range),
    placeholderData: keepPreviousData,
    refetchInterval: 60000,
  });

  const rangeInfo = RANGE_OPTIONS.find((r) => r.value === range)!;

  if (isLoading || !data) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  const { current: c, previous: p, granularity } = data;
  const dimmed = isFetching && data.range !== range;
  const trendPoints = data.trend.map((t) => ({
    key: t.bucket,
    label: bucketLabel(t.bucket, granularity),
    value: t.gmv,
    detail: `${fmtCount(t.orders)} order${t.orders === 1 ? '' : 's'}`,
  }));
  const busiestHour = data.ordersByHour.reduce((best, h, i, arr) => (h.orders > arr[best].orders ? i : best), 0);
  const pipelineTotal = data.pipeline.reduce((s, x) => s + x.count, 0);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Dashboard</Typography.Title>
          <Typography.Text type="secondary">
            {range === 'today' ? 'Today so far · compared with yesterday until the same time' : `Last ${rangeInfo.label} · compared with ${rangeInfo.period}`}
          </Typography.Text>
        </div>
      </div>

      {/* Filter row: scopes everything below */}
      <div style={{ marginBottom: 16 }}>
        <Segmented<DashboardRange>
          value={range}
          onChange={setRange}
          options={RANGE_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
        />
      </div>

      <div style={{ opacity: dimmed ? 0.5 : 1, transition: 'opacity 0.2s' }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8}>
            <Card style={{ height: '100%' }}>
              <StatTile
                hero
                label="Revenue (GMV)"
                value={fmtRupees(c.gmv)}
                current={c.gmv}
                previous={p.gmv}
                periodName={rangeInfo.period}
                trend={data.trend.map((t) => t.gmv)}
                suffix="Excludes cancelled and rejected orders"
              />
            </Card>
          </Col>
          <Col xs={24} lg={16}>
            <Row gutter={[16, 16]} style={{ height: '100%' }}>
              <Col xs={24} sm={12}>
                <Card style={{ height: '100%' }}>
                  <StatTile label="Orders" value={fmtCount(c.orders)} current={c.orders} previous={p.orders} periodName={rangeInfo.period}
                    trend={data.trend.map((t) => t.orders)} suffix={`${fmtCount(c.delivered)} delivered`} />
                </Card>
              </Col>
              <Col xs={24} sm={12}>
                <Card style={{ height: '100%' }}>
                  <StatTile label="Average order value" value={fmtRupees(c.averageOrderValue)} current={c.averageOrderValue} previous={p.averageOrderValue} periodName={rangeInfo.period} />
                </Card>
              </Col>
              <Col xs={24} sm={12}>
                <Card style={{ height: '100%' }}>
                  <StatTile label="Cancelled / rejected" value={fmtCount(c.cancelled)} current={c.cancelled} previous={p.cancelled} upIsGood={false}
                    periodName={rangeInfo.period} suffix={`${c.cancellationRate}% of orders`} />
                </Card>
              </Col>
              <Col xs={24} sm={12}>
                <Card style={{ height: '100%' }}>
                  <StatTile label="New customers" value={fmtCount(c.newCustomers)} current={c.newCustomers} previous={p.newCustomers} periodName={rangeInfo.period} />
                </Card>
              </Col>
            </Row>
          </Col>

          <Col xs={24} xl={16}>
            <ChartCard
              title="Revenue"
              subtitle={granularity === 'hour' ? 'GMV by hour, today' : `GMV per day, last ${rangeInfo.label}`}
              table={{
                columns: [
                  { title: granularity === 'hour' ? 'Hour' : 'Day', dataIndex: 'label' },
                  { title: 'Orders', dataIndex: 'orders', align: 'right' },
                  { title: 'GMV', dataIndex: 'gmv', align: 'right' },
                ],
                rows: data.trend.map((t) => ({ label: bucketLabel(t.bucket, granularity), orders: t.orders, gmv: fmtRupeesExact(t.gmv) })),
              }}
            >
              <TrendChart points={trendPoints} format={fmtRupees} seriesName="GMV" height={280} lastSuffix={granularity === 'hour' ? ' this hour' : ' today so far'} />
            </ChartCard>
          </Col>

          <Col xs={24} xl={8}>
            <ChartCard
              title="Orders in progress"
              subtitle={`Right now · ${fmtCount(pipelineTotal)} active`}
              extra={<Link to="/live-orders" style={{ fontSize: 13, marginRight: 4 }}>Live Orders</Link>}
              table={{
                columns: [{ title: 'Stage', dataIndex: 'label' }, { title: 'Orders', dataIndex: 'count', align: 'right' }],
                rows: data.pipeline.map((s) => ({ label: s.label, count: s.count })),
              }}
            >
              <BarList
                emptyText="No orders in progress"
                rows={data.pipeline.map((s, i) => ({ key: s.key, label: s.label, value: s.count, valueText: fmtCount(s.count), color: CHART.ordinal[i] }))}
              />
            </ChartCard>
          </Col>

          <Col xs={24} lg={12}>
            <ChartCard
              title="Orders by hour of day"
              subtitle={`All orders in the period · busiest ${hourLabel(busiestHour)}`}
              table={{
                columns: [{ title: 'Hour', dataIndex: 'hour' }, { title: 'Orders', dataIndex: 'orders', align: 'right' }],
                rows: data.ordersByHour.map((h) => ({ hour: `${hourLabel(h.hour)} – ${hourLabel((h.hour + 1) % 24)}`, orders: h.orders })),
              }}
            >
              <ColumnChart
                unit="orders"
                format={fmtCount}
                highlight={data.ordersByHour[busiestHour].orders ? busiestHour : null}
                columns={data.ordersByHour.map((h) => ({
                  key: String(h.hour),
                  label: h.hour % 6 === 0 ? hourLabel(h.hour) : '',
                  tooltipLabel: `${hourLabel(h.hour)} – ${hourLabel((h.hour + 1) % 24)}`,
                  value: h.orders,
                }))}
              />
            </ChartCard>
          </Col>

          <Col xs={24} lg={12}>
            <ChartCard
              title="Payment methods"
              subtitle="Share of revenue by how customers paid"
              table={{
                columns: [{ title: 'Method', dataIndex: 'method' }, { title: 'Orders', dataIndex: 'orders', align: 'right' }, { title: 'Amount', dataIndex: 'amount', align: 'right' }],
                rows: data.paymentMix.map((m) => ({ method: PAYMENT_LABELS[m.method] || m.method, orders: m.orders, amount: fmtRupeesExact(m.amount) })),
              }}
            >
              <BarList
                rows={data.paymentMix.map((m) => {
                  const total = data.paymentMix.reduce((s, x) => s + x.amount, 0);
                  return {
                    key: m.method,
                    label: PAYMENT_LABELS[m.method] || m.method,
                    detail: `${fmtCount(m.orders)} order${m.orders === 1 ? '' : 's'}`,
                    value: m.amount,
                    valueText: `${fmtRupees(m.amount)} · ${total ? Math.round((m.amount / total) * 100) : 0}%`,
                  };
                })}
              />
            </ChartCard>
          </Col>

          <Col xs={24} lg={12}>
            <ChartCard
              title="Top products"
              subtitle="By revenue in the period"
              table={{
                columns: [{ title: 'Product', dataIndex: 'name' }, { title: 'Units', dataIndex: 'qty', align: 'right' }, { title: 'Revenue', dataIndex: 'revenue', align: 'right' }],
                rows: data.topProducts.map((x) => ({ name: x.name, qty: x.qty, revenue: fmtRupeesExact(x.revenue) })),
              }}
            >
              <BarList
                rows={data.topProducts.map((x) => ({
                  key: x.productId, label: x.name, detail: `${fmtCount(x.qty)} sold`, value: x.revenue, valueText: fmtRupees(x.revenue),
                }))}
              />
            </ChartCard>
          </Col>

          <Col xs={24} lg={12}>
            <ChartCard
              title="Top stores"
              subtitle="By revenue, counted at the hub store"
              table={{
                columns: [{ title: 'Store', dataIndex: 'name' }, { title: 'Orders', dataIndex: 'orders', align: 'right' }, { title: 'GMV', dataIndex: 'gmv', align: 'right' }],
                rows: data.topStores.map((x) => ({ name: x.name, orders: x.orders, gmv: fmtRupeesExact(x.gmv) })),
              }}
            >
              <BarList
                rows={data.topStores.map((x) => ({
                  key: x.storeId, label: x.name, detail: `${fmtCount(x.orders)} order${x.orders === 1 ? '' : 's'}`, value: x.gmv, valueText: fmtRupees(x.gmv),
                }))}
              />
            </ChartCard>
          </Col>

          <Col span={24}>
            <Card title={<span style={{ fontSize: 15, fontWeight: 600 }}>Operations right now</span>}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 20 }}>
                <OpsItem icon={<ShopOutlined />} label="Active stores" value={data.operations.activeStores} to="/stores" />
                <OpsItem icon={<TeamOutlined />} label="Pickers online" value={data.operations.activePickers} to="/pickers" />
                <OpsItem icon={<CarOutlined />} label="Riders online" value={data.operations.activeDeliveryPartners} to="/live-map" />
                <OpsItem icon={<UserOutlined />} label="Customers" value={data.operations.totalCustomers} to="/customers" />
                <OpsItem icon={<AppstoreOutlined />} label="Products" value={data.operations.totalProducts} to="/products" />
                <OpsItem
                  icon={<WarningOutlined />}
                  label={`Low stock (≤ ${data.operations.lowStockAt})`}
                  value={data.operations.lowStock}
                  to="/inventory"
                  warn={data.operations.lowStock > 0}
                />
              </div>
            </Card>
          </Col>
        </Row>
      </div>
    </div>
  );
}
