import { useState } from 'react';
import { Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { fetchIvrCalls } from '../api/ivr';
import { usePageState } from '../hooks/usePageState';
import type { IvrCall } from '../types';
import { formatDateTime, titleCase } from '../utils/format';

const TYPE_LABELS: Record<IvrCall['type'], string> = {
  order_confirmation: 'COD confirmation',
  status_update: 'Status update',
  delivery_alert: 'Delivery alert',
  missed_call: 'Missed call',
  missed_call_callback: 'Missed-call callback',
  customer_care: 'Customer care',
};

const STATUS_COLORS: Record<IvrCall['status'], string> = {
  queued: 'blue',
  ringing: 'blue',
  'in-progress': 'processing',
  completed: 'green',
  failed: 'red',
  busy: 'orange',
  'no-answer': 'orange',
  simulated: 'default',
};

const OUTCOME_LABELS: Record<string, string> = {
  confirmed: 'Pressed 1 — confirmed',
  declined: 'Pressed 2 — order cancelled',
  too_late: 'Pressed 2 — too late to cancel',
  invalid: 'No valid key',
  status_sent: 'Status sent',
  unknown_caller: 'Unknown number',
  status_read: 'Heard order status',
  agent_requested: 'Connected to support',
  callback_requested: 'Asked for a call back',
};

// Every IVR call in and out: automatic order calls, COD confirmations, missed calls and the
// customer care menu (backend services/ivr.service.js).
export default function IvrCallsPage() {
  const { page, pageSize, onChange } = usePageState();
  const [type, setType] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();

  const { data, isLoading } = useQuery({
    queryKey: ['ivr-calls', page, pageSize, type, status],
    queryFn: () => fetchIvrCalls({ page, limit: pageSize, type, status }),
    refetchInterval: 30000,
  });

  return (
    <div>
      <Typography.Title level={3}>Call Logs (IVR)</Typography.Title>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select allowClear placeholder="All call types" style={{ width: 200 }} value={type} onChange={setType}
          options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
        <Select allowClear placeholder="All statuses" style={{ width: 160 }} value={status} onChange={setStatus}
          options={Object.keys(STATUS_COLORS).map((value) => ({ value, label: titleCase(value.replace('-', '_')) }))} />
      </Space>

      <Table<IvrCall>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        expandable={{
          rowExpandable: (r) => !!(r.message || r.error),
          expandedRowRender: (r) => (
            <Space orientation="vertical">
              {r.message && <Typography.Text>“{r.message}”</Typography.Text>}
              {r.error && <Typography.Text type="danger">{r.error}</Typography.Text>}
            </Space>
          ),
        }}
        columns={[
          { title: 'When', render: (_, r) => formatDateTime(r.createdAt) },
          {
            title: 'Call',
            render: (_, r) => (
              <Space orientation="vertical" size={0}>
                <span>{TYPE_LABELS[r.type]}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.direction === 'inbound' ? 'Incoming' : 'Outgoing'}{r.event && r.event !== r.type ? ` · ${titleCase(r.event)}` : ''}
                </Typography.Text>
              </Space>
            ),
          },
          { title: 'Customer', render: (_, r) => (r.user ? <span>{r.user.name}<br /><Typography.Text type="secondary">{r.phone}</Typography.Text></span> : r.phone) },
          { title: 'Order', render: (_, r) => r.order?.orderNumber || '—' },
          {
            title: 'Status',
            render: (_, r) => (
              <Tooltip title={r.error || undefined}>
                <Tag color={STATUS_COLORS[r.status]}>{r.status === 'simulated' ? 'Simulated' : titleCase(r.status.replace('-', '_'))}</Tag>
              </Tooltip>
            ),
          },
          { title: 'Result', render: (_, r) => (r.outcome ? OUTCOME_LABELS[r.outcome] || titleCase(r.outcome) : r.dtmf ? `Pressed ${r.dtmf}` : '—') },
          { title: 'Duration', render: (_, r) => (r.durationSec ? `${r.durationSec}s` : '—') },
        ]}
      />
    </div>
  );
}
