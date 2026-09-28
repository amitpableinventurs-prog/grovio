import { useState } from 'react';
import { Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { fetchVoipCalls } from '../api/voip';
import { usePageState } from '../hooks/usePageState';
import type { VoipCall } from '../types';
import { formatDateTime, titleCase } from '../utils/format';

const STATUS_COLORS: Record<VoipCall['status'], string> = {
  initiated: 'blue',
  ringing: 'blue',
  'in-progress': 'processing',
  completed: 'green',
  busy: 'orange',
  'no-answer': 'orange',
  failed: 'red',
  canceled: 'default',
  expired: 'default',
  simulated: 'default',
};

const ROLE_LABELS: Record<VoipCall['callerRole'], string> = { customer: 'Customer', delivery: 'Delivery partner' };

function Party({ user, role }: { user?: VoipCall['caller']; role: VoipCall['callerRole'] }) {
  return (
    <Space orientation="vertical" size={0}>
      <span>{user?.name || '—'}</span>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{ROLE_LABELS[role]}{user?.phone ? ` · ${user.phone}` : ''}</Typography.Text>
    </Space>
  );
}

// In-app calls between customers and delivery partners. The two sides never see each other's
// number (backend services/voip.service.js); admins do, for support.
export default function VoipCallsPage() {
  const { page, pageSize, onChange } = usePageState();
  const [status, setStatus] = useState<string | undefined>();

  const { data, isLoading } = useQuery({
    queryKey: ['voip-calls', page, pageSize, status],
    queryFn: () => fetchVoipCalls({ page, limit: pageSize, status }),
    refetchInterval: 30000,
  });

  return (
    <div>
      <Typography.Title level={3}>Masked Calls</Typography.Title>
      <Typography.Paragraph type="secondary">
        In-app calls between customers and delivery partners. Neither side sees the other's phone number.
      </Typography.Paragraph>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select allowClear placeholder="All statuses" style={{ width: 160 }} value={status} onChange={setStatus}
          options={Object.keys(STATUS_COLORS).map((value) => ({ value, label: titleCase(value.replace('-', '_')) }))} />
      </Space>

      <Table<VoipCall>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          { title: 'When', render: (_, r) => formatDateTime(r.createdAt) },
          { title: 'From', render: (_, r) => <Party user={r.caller} role={r.callerRole} /> },
          { title: 'To', render: (_, r) => <Party user={r.callee} role={r.calleeRole} /> },
          { title: 'Order', render: (_, r) => r.order?.orderNumber || '—' },
          {
            title: 'Status',
            render: (_, r) => (
              <Tooltip title={r.error || undefined}>
                <Tag color={STATUS_COLORS[r.status]}>{titleCase(r.status.replace('-', '_'))}</Tag>
              </Tooltip>
            ),
          },
          { title: 'Duration', render: (_, r) => (r.durationSec ? `${r.durationSec}s` : '—') },
        ]}
      />
    </div>
  );
}
