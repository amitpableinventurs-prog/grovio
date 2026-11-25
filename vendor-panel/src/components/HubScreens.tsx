import { useState } from 'react';
import { Card, Table, Tag, Button, Input, Space, Alert, Typography, Popconfirm, Radio, Divider, App as AntApp } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchHubDisplays, createHubDisplay, revokeHubDisplay } from '../api/hubDisplays';
import { fetchHubPickup, updateHubPickup } from '../api/store';
import type { HubDisplay, HubPickupMode } from '../types';
import { formatDateTime } from '../utils/format';

// A screen checks in with the API at least every minute (and its last-seen time is written at most
// once a minute) — so anything seen within 3 minutes is treated as online.
const ONLINE_WINDOW_MS = 3 * 60 * 1000;

function screenState(d: HubDisplay) {
  if (d.revokedAt) return <Tag>Revoked</Tag>;
  if (d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < ONLINE_WINDOW_MS) return <Tag color="green">Online</Tag>;
  if (!d.lastSeenAt) return <Tag color="gold">Not paired yet</Tag>;
  return <Tag color="default">Offline</Tag>;
}

const PICKUP_MODE_LABELS: Record<HubPickupMode, string> = {
  hub_screen: 'Hub screen QR',
  auto_assign: 'Auto-assign nearest rider',
};

// "How riders get orders" — this store's hub pickup mode, or the Grovio default.
function HubPickupSetting() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['hub-pickup'], queryFn: fetchHubPickup });

  const updateMutation = useMutation({
    mutationFn: (mode: HubPickupMode | null) => updateHubPickup(mode),
    onSuccess: (res) => {
      queryClient.setQueryData(['hub-pickup'], res);
      message.success(`Riders now get orders by: ${PICKUP_MODE_LABELS[res.effectiveMode]}`);
    },
  });

  return (
    <>
      <Typography.Title level={5} style={{ marginTop: 0 }}>How riders get orders</Typography.Title>
      <Radio.Group
        value={data ? data.mode ?? 'default' : undefined}
        disabled={isLoading || updateMutation.isPending}
        onChange={(e) => updateMutation.mutate(e.target.value === 'default' ? null : e.target.value)}
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <Radio value="hub_screen">
          <strong>Hub screen QR</strong>
          <Typography.Text type="secondary"> · each ready order shows its own QR on the hub screen; the first rider at the store to scan it takes the order</Typography.Text>
        </Radio>
        <Radio value="auto_assign">
          <strong>Auto-assign nearest rider</strong>
          <Typography.Text type="secondary"> · the nearest available rider is assigned as soon as the order is packed; the picker hands over with a QR or OTP</Typography.Text>
        </Radio>
        <Radio value="default">
          <strong>Grovio default</strong>
          {data && <Typography.Text type="secondary"> · currently {PICKUP_MODE_LABELS[data.defaultMode]}; follows the setting chosen by the Grovio team</Typography.Text>}
        </Radio>
      </Radio.Group>
      <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0 }}>
        Applies to orders packed from now on.
      </Typography.Paragraph>
      <Divider />
    </>
  );
}

// The same pairing key opens the picker TV (/picker-display) instead of the pickup board.
const pickingUrl = (url: string) => url.replace('/hub-display/', '/picker-display/');

// My Store -> "Hub screens": the TVs/tablets at my store that show /hub-display (live pickup board
// + single-use check-in QR for delivery partners).
export default function HubScreens() {
  const [name, setName] = useState('');
  const [pairing, setPairing] = useState<{ name: string; url: string } | null>(null);
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['hub-displays'],
    queryFn: fetchHubDisplays,
    refetchInterval: 60000,
  });

  const createMutation = useMutation({
    mutationFn: () => createHubDisplay(name.trim()),
    onSuccess: (res) => {
      setPairing({ name: res.display.name, url: res.pairingUrl });
      setName('');
      queryClient.invalidateQueries({ queryKey: ['hub-displays'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeHubDisplay(id),
    onSuccess: () => {
      message.success('Screen revoked');
      queryClient.invalidateQueries({ queryKey: ['hub-displays'] });
    },
  });

  return (
    <Card title="Hub screens">
      <Typography.Paragraph type="secondary">
        A hub screen shows the orders ready for pickup at this store, buzzes when an order becomes ready, and shows a QR
        code that delivery partners scan from the Delivery app to check in and pick an order. The QR changes after every scan.
      </Typography.Paragraph>

      <HubPickupSetting />

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
              <Typography.Text strong>Dark store pickup screen</Typography.Text> (ready orders with their QR for delivery partners)
              <Typography.Paragraph copyable={{ text: pairing.url }} style={{ wordBreak: 'break-all', marginBottom: 8 }}>
                <Typography.Text code>{pairing.url}</Typography.Text>
              </Typography.Paragraph>
              <Typography.Text strong>Picking screen</Typography.Text> (this store's items to pick for every order, for its pickers)
              <Typography.Paragraph copyable={{ text: pickingUrl(pairing.url) }} style={{ wordBreak: 'break-all', marginBottom: 8 }}>
                <Typography.Text code>{pickingUrl(pairing.url)}</Typography.Text>
              </Typography.Paragraph>
              <Typography.Text type="secondary">
                Open one of them on the screen. These links are shown only once and work like a password for the screen. If
                they're lost or shared, revoke the screen and add a new one.
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
    </Card>
  );
}
