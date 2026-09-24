import { Typography, Tabs, Table, Statistic, Row, Col, Card } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { fetchPayments, fetchCodReconciliation, fetchRefunds } from '../api/payments';
import type { Payment, Refund, Order, User } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import { formatCurrency, formatDateTime } from '../utils/format';

function PaymentsTab() {
  const { page, pageSize, onChange } = usePageState();
  const { data, isLoading } = useQuery({ queryKey: ['payments', page, pageSize], queryFn: () => fetchPayments({ page, limit: pageSize }) });

  return (
    <Table<Payment>
      rowKey="_id"
      loading={isLoading}
      dataSource={data?.items}
      pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
      columns={[
        { title: 'Order', render: (_, r) => (r.order && typeof r.order === 'object' ? (r.order as Order).orderNumber : r.order || '—') },
        { title: 'User', render: (_, r) => (r.user && typeof r.user === 'object' ? (r.user as User).name : r.user) },
        { title: 'Amount', render: (_, r) => formatCurrency(r.amount) },
        { title: 'Method', render: (_, r) => r.instrument ? `${r.method} (${r.instrument})` : r.method },
        { title: 'Status', render: (_, r) => <StatusTag status={r.status} /> },
        { title: 'Failure Reason', render: (_, r) => r.failureReason || '—' },
        { title: 'Date', render: (_, r) => formatDateTime(r.createdAt) },
      ]}
    />
  );
}

function CodReconciliationTab() {
  const { data, isLoading } = useQuery({ queryKey: ['cod-reconciliation'], queryFn: () => fetchCodReconciliation() });

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="Total COD Orders" value={data?.totalOrders || 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="Total Collected" value={formatCurrency(data?.totalCollected)} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="Cash Collected" value={formatCurrency(data?.cashCollected)} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="UPI Collected" value={formatCurrency(data?.upiCollected)} />
          </Card>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Card loading={isLoading}>
            <Statistic title="Unsettled Orders" value={data?.unsettledCount || 0} />
          </Card>
        </Col>
        <Col span={12}>
          <Card loading={isLoading}>
            <Statistic title="Unsettled Cash (needs hand-over)" value={data?.unsettledCashCount || 0} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function RefundsTab() {
  const { page, pageSize, onChange } = usePageState();
  const { data, isLoading } = useQuery({ queryKey: ['refunds', page, pageSize], queryFn: () => fetchRefunds({ page, limit: pageSize }) });

  return (
    <Table<Refund>
      rowKey="_id"
      loading={isLoading}
      dataSource={data?.items}
      pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
      columns={[
        { title: 'Order', render: (_, r) => (r.order && typeof r.order === 'object' ? (r.order as Order).orderNumber : r.order || '—') },
        { title: 'Amount', render: (_, r) => formatCurrency(r.amount) },
        { title: 'Reason', dataIndex: 'reason' },
        { title: 'Status', render: (_, r) => <StatusTag status={r.status} /> },
        { title: 'Date', render: (_, r) => formatDateTime(r.createdAt) },
      ]}
    />
  );
}

export default function PaymentsPage() {
  return (
    <div>
      <Typography.Title level={3}>Payments & Refunds</Typography.Title>
      <Tabs
        items={[
          { key: 'payments', label: 'Payments', children: <PaymentsTab /> },
          { key: 'cod', label: 'COD Reconciliation', children: <CodReconciliationTab /> },
          { key: 'refunds', label: 'Refunds', children: <RefundsTab /> },
        ]}
      />
    </div>
  );
}
