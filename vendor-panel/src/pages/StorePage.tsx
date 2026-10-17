import { Card, Descriptions, Space, Spin, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { fetchMyStore } from '../api/store';
import StatusTag from '../components/StatusTag';
import HubScreens from '../components/HubScreens';
import { formatDateTime } from '../utils/format';

// Read-only: the store's details, hours and approval are managed by the Grovio admin.
export default function StorePage() {
  const { data: store, isLoading } = useQuery({ queryKey: ['my-store'], queryFn: fetchMyStore });

  if (isLoading || !store) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  const hasLocation = store.lat != null && store.lng != null;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>My Store</Typography.Title>

      <Card>
        <Descriptions column={{ xs: 1, md: 2 }} bordered size="small">
          <Descriptions.Item label="Name">{store.name}</Descriptions.Item>
          <Descriptions.Item label="Status">
            <StatusTag status={store.status} />
            {store.status === 'inactive' && <Typography.Text type="secondary"> · waiting for admin approval</Typography.Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Address">{store.address || '—'}</Descriptions.Item>
          <Descriptions.Item label="Location">
            {hasLocation ? (
              <a href={`https://www.google.com/maps?q=${store.lat},${store.lng}`} target="_blank" rel="noreferrer">
                {store.lat?.toFixed(5)}, {store.lng?.toFixed(5)}
              </a>
            ) : (
              'Not set'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Hours">{store.openTime && store.closeTime ? `${store.openTime} – ${store.closeTime}` : '—'}</Descriptions.Item>
          <Descriptions.Item label="Delivery radius">{store.serviceRadiusKm ? `${store.serviceRadiusKm} km` : 'Default'}</Descriptions.Item>
          <Descriptions.Item label="Registered">{formatDateTime(store.createdAt)}</Descriptions.Item>
        </Descriptions>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          To change these details, contact the Grovio team.
        </Typography.Paragraph>
      </Card>

      <HubScreens />
    </Space>
  );
}
