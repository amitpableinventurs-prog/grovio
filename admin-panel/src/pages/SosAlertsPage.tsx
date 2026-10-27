import { useState } from 'react';
import { App as AntApp, Button, Input, Modal, Segmented, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { EnvironmentOutlined, PhoneOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { acknowledgeSos, fetchSosAlerts, resolveSos } from '../api/sos';
import { usePageState } from '../hooks/usePageState';
import type { SosAlert, SosStatus } from '../types';
import { formatDateTime, titleCase } from '../utils/format';

const STATUS_COLORS: Record<SosStatus, string> = {
  open: 'red',
  acknowledged: 'orange',
  resolved: 'green',
  cancelled: 'default',
};

const KIND_LABELS: Record<string, string> = {
  sos: 'SOS button',
  emergency: '112 Emergency',
  police: 'Police',
  ambulance: 'Ambulance',
  fire: 'Fire',
  women: 'Women helpline',
  road_accident: 'Highway accident',
  grovio: 'Grovio safety team',
};
const kindLabel = (k: string) => KIND_LABELS[k] || titleCase(k);

function minutesAgo(iso?: string | null) {
  if (!iso) return null;
  const m = Math.max(Math.floor((Date.now() - new Date(iso).getTime()) / 60000), 0);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function Person({ a }: { a: SosAlert }) {
  return (
    <Space orientation="vertical" size={0}>
      <span><strong>{a.user?.name || '—'}</strong> <Tag style={{ marginLeft: 4 }}>{titleCase(a.role)}</Tag></span>
      {a.user?.phone && <a href={`tel:${a.user.phone}`}><PhoneOutlined /> {a.user.phone}</a>}
    </Space>
  );
}

function Location({ a }: { a: SosAlert }) {
  if (!a.location) return <Typography.Text type="secondary">Not shared</Typography.Text>;
  const { lat, lng } = a.location;
  return (
    <Space orientation="vertical" size={0}>
      <a href={`https://maps.google.com/?q=${lat},${lng}`} target="_blank" rel="noreferrer"><EnvironmentOutlined /> Open map</a>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Updated {minutesAgo(a.location.at)}{a.location.accuracyM ? ` · ±${Math.round(a.location.accuracyM)} m` : ''}
      </Typography.Text>
    </Space>
  );
}

// SOS from riders, pickers and customers. They call the helpline from their phone; this page is
// for the ops team to reach them, follow their live location, and close the alert.
export default function SosAlertsPage() {
  const { page, pageSize, onChange } = usePageState();
  const [status, setStatus] = useState<string>('active');
  const [role, setRole] = useState<string | undefined>();
  const [resolving, setResolving] = useState<SosAlert | null>(null);
  const [note, setNote] = useState('');
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['sos', 'list', page, pageSize, status, role],
    queryFn: () => fetchSosAlerts({ page, limit: pageSize, status: status === 'all' ? undefined : status, role }),
    refetchInterval: 30000,
  });

  const done = (text: string) => {
    message.success(text);
    queryClient.invalidateQueries({ queryKey: ['sos'] });
  };
  const ack = useMutation({ mutationFn: acknowledgeSos, onSuccess: () => done('Acknowledged — the person sees that help is coming') });
  const resolve = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => resolveSos(id, text),
    onSuccess: () => {
      setResolving(null);
      setNote('');
      done('SOS resolved');
    },
  });

  return (
    <div>
      <Typography.Title level={3}>SOS Alerts</Typography.Title>
      <Typography.Paragraph type="secondary">
        Raised from the Delivery, Picker and Customer apps. They call the helpline (112, 100, 108 …) from their own phone;
        call them, follow their live location, and resolve the alert once they're safe. New alerts sound a siren on any open admin page.
      </Typography.Paragraph>

      <Space style={{ marginBottom: 16 }} wrap>
        <Segmented
          value={status}
          onChange={(v) => setStatus(String(v))}
          options={[
            { value: 'active', label: `Active${data?.activeCount ? ` (${data.activeCount})` : ''}` },
            { value: 'resolved', label: 'Resolved' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Select allowClear placeholder="All apps" style={{ width: 160 }} value={role} onChange={setRole}
          options={[{ value: 'delivery', label: 'Delivery partners' }, { value: 'picker', label: 'Pickers' }, { value: 'customer', label: 'Customers' }]} />
      </Space>

      <Table<SosAlert>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        scroll={{ x: 1000 }}
        rowClassName={(r) => (r.status === 'open' ? 'sos-open-row' : '')}
        columns={[
          {
            title: 'When',
            render: (_, r) => (
              <Space orientation="vertical" size={0}>
                <span>{formatDateTime(r.createdAt)}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{minutesAgo(r.createdAt)}</Typography.Text>
              </Space>
            ),
          },
          { title: 'Person', render: (_, r) => <Person a={r} /> },
          {
            title: 'Emergency',
            render: (_, r) => (
              <Space orientation="vertical" size={2}>
                <Tag color="red">{kindLabel(r.kind)}</Tag>
                {r.calls.length > 0 && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Dialled: {r.calls.map((c) => c.number).join(', ')}
                  </Typography.Text>
                )}
                {r.note && <Typography.Text style={{ fontSize: 12 }}>“{r.note}”</Typography.Text>}
              </Space>
            ),
          },
          { title: 'Location', render: (_, r) => <Location a={r} /> },
          {
            title: 'Order / Store',
            render: (_, r) => (
              <Space orientation="vertical" size={0}>
                <span>{r.order?.orderNumber || '—'}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.store?.name || ''}</Typography.Text>
              </Space>
            ),
          },
          {
            title: 'Contacts texted',
            render: (_, r) => (r.contactsNotified.length ? (
              <Space orientation="vertical" size={0}>
                {r.contactsNotified.map((c) => (
                  <Tooltip key={c.phone + c.kind} title={c.sent ? 'SMS sent' : `Not sent: ${c.reason || 'unknown'}`}>
                    <span style={{ fontSize: 12 }}>
                      {c.kind === 'ops' ? 'Ops' : c.name || 'Emergency contact'} · <a href={`tel:${c.phone}`}>{c.phone}</a> {c.sent ? '✓' : '✗'}
                    </span>
                  </Tooltip>
                ))}
              </Space>
            ) : <Typography.Text type="secondary">—</Typography.Text>),
          },
          {
            title: 'Status',
            render: (_, r) => (
              <Tooltip title={r.resolutionNote || r.cancelReason || (r.acknowledgedBy ? `By ${r.acknowledgedBy.name}` : undefined)}>
                <Tag color={STATUS_COLORS[r.status]}>{titleCase(r.status)}</Tag>
              </Tooltip>
            ),
          },
          {
            title: '',
            fixed: 'right',
            render: (_, r) => (r.status === 'open' || r.status === 'acknowledged') && (
              <Space>
                {r.status === 'open' && (
                  <Button size="small" danger type="primary" loading={ack.isPending && ack.variables === r._id} onClick={() => ack.mutate(r._id)}>
                    Acknowledge
                  </Button>
                )}
                <Button size="small" onClick={() => setResolving(r)}>Resolve</Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={!!resolving}
        title={`Resolve SOS from ${resolving?.user?.name || ''}`}
        okText="Resolve"
        confirmLoading={resolve.isPending}
        okButtonProps={{ disabled: !note.trim() }}
        onOk={() => resolving && resolve.mutate({ id: resolving._id, text: note.trim() })}
        onCancel={() => { setResolving(null); setNote(''); }}
      >
        <Typography.Paragraph type="secondary">What happened and what was done? This stays on the record.</Typography.Paragraph>
        <Input.TextArea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called the rider, minor fall, ambulance not needed, order reassigned" />
      </Modal>

      <style>{'.sos-open-row > td { background: #fff1f0 !important; }'}</style>
    </div>
  );
}
