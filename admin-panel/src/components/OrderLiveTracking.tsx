import { useEffect, useMemo } from 'react';
import { Alert, Button, Popconfirm, Space, Tag, Typography, App as AntApp } from 'antd';
import { PhoneOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchOrderTracking } from '../api/tracking';
import { callCustomer } from '../api/ivr';
import { onSocketEvent } from '../realtime/socket';
import TrackingMap, { type MapPoint } from './TrackingMap';
import type { Order } from '../types';
import { formatDateTime } from '../utils/format';

const TERMINAL = ['delivered', 'cancelled', 'rejected', 'returned'];

const CONFIRMATION_TAGS: Record<string, { color: string; text: string }> = {
  pending: { color: 'gold', text: 'Confirmation call: waiting' },
  confirmed: { color: 'green', text: 'Confirmed on call' },
  declined: { color: 'red', text: 'Cancelled on call' },
  no_answer: { color: 'default', text: 'Confirmation call: no answer' },
};

export function ConfirmationTag({ value }: { value?: string | null }) {
  const tag = value ? CONFIRMATION_TAGS[value] : null;
  return tag ? <Tag color={tag.color}>{tag.text}</Tag> : null;
}

// Order drawer section: live map (hub, drop, rider), ETA, geofence events, and on-demand IVR calls.
export default function OrderLiveTracking({ order }: { order: Order }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const active = !TERMINAL.includes(order.orderStatus);

  const { data } = useQuery({
    queryKey: ['order-tracking', order._id],
    queryFn: () => fetchOrderTracking(order._id),
    refetchInterval: active ? 30000 : false,
  });

  // Rider pings for this order refresh the snapshot (position + ETA).
  useEffect(() => {
    return onSocketEvent<{ orders: { orderId: string }[] }>('rider:location', (p) => {
      if (p.orders?.some((o) => o.orderId === order._id)) {
        queryClient.invalidateQueries({ queryKey: ['order-tracking', order._id] });
      }
    });
  }, [order._id, queryClient]);

  const callMutation = useMutation({
    mutationFn: (kind: 'status' | 'confirmation') => callCustomer(order._id, kind),
    onSuccess: (call) => {
      if (call.status === 'failed') message.error(`Call failed: ${call.error}`);
      else message.success(call.status === 'simulated' ? 'Call simulated (no IVR provider configured)' : 'Calling the customer');
      queryClient.invalidateQueries({ queryKey: ['ivr-calls'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not place the call'),
  });

  const points = useMemo<MapPoint[]>(() => {
    if (!data) return [];
    const p: MapPoint[] = [];
    if (data.hub) p.push({ id: 'hub', kind: 'hub', lat: data.hub.lat, lng: data.hub.lng, label: data.hub.name });
    if (data.drop) p.push({ id: 'drop', kind: 'drop', lat: data.drop.lat, lng: data.drop.lng, label: 'Customer' });
    if (data.rider) p.push({ id: 'rider', kind: 'rider', lat: data.rider.lat, lng: data.rider.lng, label: data.deliveryPartner?.name || 'Rider' });
    return p;
  }, [data]);

  return (
    <>
      <Typography.Title level={5}>Live Tracking</Typography.Title>
      <Space orientation="vertical" style={{ width: '100%', marginBottom: 16 }}>
        {data?.eta && active && (
          <Typography.Text>
            Estimated delivery in <strong>{data.eta.etaMinutes} min</strong> ({formatDateTime(data.eta.etaAt)})
            {data.eta.remainingKm !== null && ` · ${data.eta.remainingKm} km to go`}
            {data.eta.approximate && <Typography.Text type="secondary"> · approximate</Typography.Text>}
          </Typography.Text>
        )}
        <Space wrap size={4}>
          <ConfirmationTag value={order.ivrConfirmation} />
          {data?.arrivedAtPickupAt && <Tag color="blue">Rider reached hub</Tag>}
          {data?.nearbyAlertAt && <Tag color="orange">Rider near customer</Tag>}
          {data?.arrivedAtDropAt && <Tag color="green">Rider at customer</Tag>}
          {data?.rider && <Typography.Text type="secondary">GPS {formatDateTime(data.rider.updatedAt)}</Typography.Text>}
        </Space>
        {points.length ? (
          <TrackingMap points={points} labels="always" height={240} fitKey={order._id} />
        ) : (
          data && <Alert type="info" showIcon title="No locations to show yet — the hub or the delivery address has no coordinates." />
        )}
        <Space wrap>
          <Popconfirm title="Call the customer and read out this order's status?" onConfirm={() => callMutation.mutate('status')}>
            <Button icon={<PhoneOutlined />} loading={callMutation.isPending && callMutation.variables === 'status'}>Call with status</Button>
          </Popconfirm>
          {order.paymentMethod === 'COD' && active && (
            <Popconfirm title="Call the customer to confirm this COD order (1 = confirm, 2 = cancel)?" onConfirm={() => callMutation.mutate('confirmation')}>
              <Button icon={<PhoneOutlined />} loading={callMutation.isPending && callMutation.variables === 'confirmation'}>Confirmation call</Button>
            </Popconfirm>
          )}
        </Space>
      </Space>
    </>
  );
}
