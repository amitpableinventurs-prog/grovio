import { Table, Typography, Space, Button, App as AntApp } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchUsersByRole, updateDeliveryStatus, toggleUserActive } from '../api/users';
import type { UserWithProfile } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';

export default function DeliveryPartnersPage() {
  const { page, pageSize, onChange } = usePageState();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-partners', page, pageSize],
    queryFn: () => fetchUsersByRole('delivery', { page, limit: pageSize }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateDeliveryStatus(id, status),
    onSuccess: () => {
      message.success('Delivery partner status updated');
      queryClient.invalidateQueries({ queryKey: ['delivery-partners'] });
    },
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => toggleUserActive(id, isActive),
    onSuccess: () => {
      message.success('Updated');
      queryClient.invalidateQueries({ queryKey: ['delivery-partners'] });
    },
  });

  return (
    <div>
      <Typography.Title level={3}>Delivery Partners</Typography.Title>

      <Table<UserWithProfile>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Phone', dataIndex: 'phone' },
          { title: 'Vehicle', render: (_, r) => r.deliveryProfile?.vehicleType || '—' },
          { title: 'Vehicle No.', render: (_, r) => r.deliveryProfile?.vehicleNumber || '—' },
          { title: 'Status', render: (_, r) => (r.deliveryProfile ? <StatusTag status={r.deliveryProfile.status} /> : '—') },
          { title: 'Available', render: (_, r) => <StatusTag status={r.deliveryProfile?.isAvailable ? 'active' : 'inactive'} /> },
          {
            title: 'Actions',
            render: (_, r) => (
              <Space>
                {r.deliveryProfile?.status !== 'approved' && (
                  <Button size="small" type="primary" onClick={() => statusMutation.mutate({ id: r._id, status: 'approved' })}>
                    Approve
                  </Button>
                )}
                {r.deliveryProfile?.status !== 'blocked' ? (
                  <Button size="small" danger onClick={() => statusMutation.mutate({ id: r._id, status: 'blocked' })}>
                    Block
                  </Button>
                ) : (
                  <Button size="small" onClick={() => statusMutation.mutate({ id: r._id, status: 'approved' })}>
                    Unblock
                  </Button>
                )}
                <Button size="small" onClick={() => activeMutation.mutate({ id: r._id, isActive: !r.isActive })}>
                  {r.isActive ? 'Disable Login' : 'Enable Login'}
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
