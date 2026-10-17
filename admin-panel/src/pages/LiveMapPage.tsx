import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, Empty, Space, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchLiveRiders } from '../api/tracking';
import { onSocketEvent, useSocketConnected } from '../realtime/socket';
import TrackingMap, { type MapCircle, type MapPoint } from '../components/TrackingMap';
import StatusTag from '../components/StatusTag';
import type { LiveMapData, LiveRider } from '../types';
import { formatDateTime } from '../utils/format';

interface RiderPing {
  riderId: string;
  lat: number;
  lng: number;
  updatedAt: string;
  orders: { orderId: string; orderNumber: string; orderStatus: LiveRider['orders'][number]['orderStatus'] }[];
}

// Where every delivery partner is right now: online riders and anyone on a job, with their
// active orders, over the stores and their delivery areas. Positions move live from the
// 'rider:location' socket event; the full list is refetched every minute.
export default function LiveMapPage() {
  const queryClient = useQueryClient();
  const live = useSocketConnected();
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['live-riders'], queryFn: fetchLiveRiders, refetchInterval: 60000 });

  useEffect(() => {
    return onSocketEvent<RiderPing>('rider:location', (p) => {
      queryClient.setQueryData<LiveMapData>(['live-riders'], (prev) => {
        if (!prev) return prev;
        const known = prev.riders.some((r) => String(r.riderId) === p.riderId);
        if (!known) {
          queryClient.invalidateQueries({ queryKey: ['live-riders'] });
          return prev;
        }
        return {
          ...prev,
          riders: prev.riders.map((r) =>
            String(r.riderId) === p.riderId
              ? { ...r, lat: p.lat, lng: p.lng, updatedAt: p.updatedAt, stale: false, orders: p.orders.map((o) => ({ ...o, hub: r.orders.find((x) => x.orderId === o.orderId)?.hub })) }
              : r,
          ),
        };
      });
    });
  }, [queryClient]);

  const located = (data?.riders || []).filter((r) => r.lat !== null && r.lng !== null);

  const points = useMemo<MapPoint[]>(() => [
    ...(data?.stores || []).filter((s) => s.lat !== null && s.lng !== null).map((s) => ({ id: `store-${s._id}`, kind: 'hub' as const, lat: s.lat as number, lng: s.lng as number, label: s.name })),
    ...located.map((r) => ({
      id: String(r.riderId),
      kind: r.stale ? ('rider-stale' as const) : ('rider' as const),
      lat: r.lat as number,
      lng: r.lng as number,
      label: `${r.name}${r.orders.length ? ` · ${r.orders.length} order(s)` : ''}`,
    })),
  ], [data, located]);

  const circles = useMemo<MapCircle[]>(
    () => (data?.stores || []).filter((s) => s.lat !== null && s.lng !== null && s.serviceRadiusKm).map((s) => ({ id: s._id, lat: s.lat as number, lng: s.lng as number, radiusKm: s.serviceRadiusKm as number })),
    [data],
  );

  const riders = [...(data?.riders || [])].sort((a, b) => b.orders.length - a.orders.length);

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Live Map</Typography.Title>
        <Badge status={live ? 'processing' : 'default'} text={live ? 'Live' : 'Reconnecting…'} />
      </Space>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 16 }} className="live-map-grid">
        <Card styles={{ body: { padding: 8 } }}>
          <TrackingMap points={points} circles={circles} height={560} fitKey={data ? 'loaded' : undefined} onPointClick={setSelected} />
          <Space size="middle" style={{ marginTop: 8, paddingLeft: 4 }} wrap>
            <Typography.Text type="secondary"><span style={{ color: '#158a4d' }}>●</span> Store (dashed: delivery area)</Typography.Text>
            <Typography.Text type="secondary"><span style={{ color: '#ea580c' }}>●</span> Rider</Typography.Text>
            <Typography.Text type="secondary"><span style={{ color: '#9ca3af' }}>●</span> No GPS for {data?.staleAfterMinutes ?? 10}+ min</Typography.Text>
          </Space>
        </Card>

        <Card title={`Delivery partners (${riders.length})`} styles={{ body: { padding: 0, maxHeight: 600, overflowY: 'auto' } }} loading={isLoading}>
          {riders.length === 0 ? (
            <Empty style={{ padding: 24 }} description="No one online or on a job" />
          ) : (
            <div>
              {riders.map((r) => (
                <div
                  key={String(r.riderId)}
                  role="button"
                  tabIndex={0}
                  style={{ padding: '10px 16px', borderBottom: '1px solid rgba(5,5,5,0.06)', background: selected === String(r.riderId) ? 'rgba(234,88,12,0.06)' : undefined, cursor: 'pointer' }}
                  onClick={() => setSelected(String(r.riderId))}
                  onKeyDown={(e) => e.key === 'Enter' && setSelected(String(r.riderId))}
                >
                  <Space orientation="vertical" size={2} style={{ width: '100%' }}>
                    <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                      <Typography.Text strong>{r.name}</Typography.Text>
                      {r.lat === null ? <Tag>No GPS yet</Tag> : r.stale ? <Tag>GPS stale</Tag> : <Tag color="orange">Live</Tag>}
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.phone || '—'} · {r.updatedAt ? `last fix ${formatDateTime(r.updatedAt)}` : 'never reported'}
                    </Typography.Text>
                    {r.orders.length === 0 ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.isAvailable ? 'Online, no active order' : 'Offline'}</Typography.Text>
                    ) : (
                      r.orders.map((o) => (
                        <Space key={o.orderId} size={6}>
                          <Typography.Text style={{ fontSize: 12 }}>{o.orderNumber}</Typography.Text>
                          <StatusTag status={o.orderStatus} />
                        </Space>
                      ))
                    )}
                  </Space>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
