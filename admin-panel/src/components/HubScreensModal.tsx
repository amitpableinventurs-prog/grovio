import { useState } from 'react';
import { Modal, Table, Tag, Button, Input, Space, Alert, Typography, Popconfirm, App as AntApp } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchHubDisplays, createHubDisplay, revokeHubDisplay } from '../api/hubDisplays';
import type { HubDisplay, Store } from '../types';
import { formatDateTime } from '../utils/format';

// A screen fetches a new check-in QR every 30s, and its last-seen time is written at most once a
// minute — so anything seen within 3 minutes is treated as online.
const ONLINE_WINDOW_MS = 3 * 60 * 1000;

function screenState(d: HubDisplay) {
  if (d.revokedAt) return <Tag>Revoked</Tag>;
  if (d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < ONLINE_WINDOW_MS) return <Tag color="green">Online</Tag>;
  if (!d.lastSeenAt) return <Tag color="gold">Not paired yet</Tag>;
  return <Tag color="default">Offline</Tag>;
}

// Stores page -> "Hub screens": the TVs/tablets at this store that show /hub-display (live pickup
// board + rotating check-in QR for delivery partners).
export default function HubScreensModal({ store, onClose }: { store: Store | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [pairing, setPairing] = useState<{ name: string; url: string } | null>(null);
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const storeId = store?._id;

  const { data, isLoading } = useQuery({
    queryKey: ['hub-displays', storeId],
    queryFn: () => fetchHubDisplays(storeId!),
    enabled: !!storeId,
    refetchInterval: 60000,
  });

  const createMutation = useMutation({
    mutationFn: () => createHubDisplay(storeId!, name.trim()),
    onSuccess: (res) => {
      setPairing({ name: res.display.name, url: res.pairingUrl });
      setName('');
      queryClient.invalidateQueries({ queryKey: ['hub-displays', storeId] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeHubDisplay(id),
    onSuccess: () => {
      message.success('Screen revoked');
      queryClient.invalidateQueries({ queryKey: ['hub-displays', storeId] });
    },
  });

  const close = () => {
    setPairing(null);
    setName('');
    onClose();
  };

  return (
    <Modal title={store ? `Hub screens · ${store.name}` : 'Hub screens'} open={!!store} onCancel={close} footer={null} width={760} destroyOnHidden>
      <Typography.Paragraph type="secondary">
        A hub screen shows the orders ready for pickup at this store and a QR code that changes every 30 seconds. Delivery
        partners scan it from the Delivery app to check in and pick an order.
      </Typography.Paragraph>

      {pairing && (
        <Alert
          type="success"
          showIcon
          closable
          onClose={() => setPairing(null)}
          style={{ marginBottom: 16 }}
          title={`Open this link on the "${pairing.name}" screen`}
          description={
            <>
              <Typography.Paragraph copyable={{ text: pairing.url }} style={{ wordBreak: 'break-all', marginBottom: 8 }}>
                <Typography.Text code>{pairing.url}</Typography.Text>
              </Typography.Paragraph>
              <Typography.Text type="secondary">
                This link is shown only once and works like a password for the screen. If it's lost or shared, revoke the
                screen and add a new one.
              </Typography.Text>
            </>
          }
        />
      )}

      <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
        <Input
          placeholder="Screen name, e.g. Pickup counter TV"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={() => name.trim() && createMutation.mutate()}
        />
        <Button type="primary" disabled={!name.trim()} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          Add screen
        </Button>
      </Space.Compact>

      <Table<HubDisplay>
        rowKey="_id"
        size="small"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        locale={{ emptyText: 'No screens yet' }}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Status', render: (_, d) => screenState(d) },
          { title: 'Last seen', render: (_, d) => formatDateTime(d.lastSeenAt) },
          {
            title: 'Added',
            render: (_, d) => (
              <>
                {formatDateTime(d.createdAt)}
                {typeof d.createdBy === 'object' && d.createdBy?.name && (
                  <Typography.Text type="secondary"> · {d.createdBy.name}</Typography.Text>
                )}
              </>
            ),
          },
          {
            title: '',
            align: 'right',
            render: (_, d) =>
              !d.revokedAt && (
                <Popconfirm
                  title="Revoke this screen?"
                  description="It stops working immediately. To use it again, add it as a new screen."
                  okText="Revoke"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => revokeMutation.mutate(d._id)}
                >
                  <Button size="small" danger loading={revokeMutation.isPending && revokeMutation.variables === d._id}>
                    Revoke
                  </Button>
                </Popconfirm>
              ),
          },
        ]}
      />
    </Modal>
  );
}
