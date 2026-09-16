import { Table, Typography, Space, Button, Select, App as AntApp } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchUsersByRole, updatePickerStatus, assignPickerToStore, toggleUserActive } from '../api/users';
import { fetchStores } from '../api/stores';
import type { UserWithProfile, Store } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';

export default function PickersPage() {
  const { page, pageSize, onChange } = usePageState();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['pickers', page, pageSize],
    queryFn: () => fetchUsersByRole('picker', { page, limit: pageSize }),
  });

  const { data: stores } = useQuery({ queryKey: ['all-stores'], queryFn: () => fetchStores({ limit: 100 }) });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updatePickerStatus(id, status),
    onSuccess: () => {
      message.success('Picker status updated');
      queryClient.invalidateQueries({ queryKey: ['pickers'] });
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, storeId }: { id: string; storeId: string }) => assignPickerToStore(id, storeId),
    onSuccess: () => {
      message.success('Picker linked to store');
      queryClient.invalidateQueries({ queryKey: ['pickers'] });
    },
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => toggleUserActive(id, isActive),
    onSuccess: () => {
      message.success('Updated');
      queryClient.invalidateQueries({ queryKey: ['pickers'] });
    },
  });

  return (
    <div>
      <Typography.Title level={3}>Pickers</Typography.Title>

      <Table<UserWithProfile>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Phone', dataIndex: 'phone' },
          { title: 'Status', render: (_, r) => (r.pickerProfile ? <StatusTag status={r.pickerProfile.status} /> : '—') },
          {
            title: 'Available',
            render: (_, r) => <StatusTag status={r.pickerProfile?.isAvailable ? 'active' : 'inactive'} />,
          },
          {
            title: 'Assigned Store',
            render: (_, r) => (
              <Select
                style={{ width: 200 }}
                placeholder="Assign a store"
                value={typeof r.pickerProfile?.store === 'string' ? r.pickerProfile?.store : (r.pickerProfile?.store as Store)?._id}
                options={stores?.items.map((s) => ({ value: s._id, label: s.name }))}
                onChange={(storeId) => assignMutation.mutate({ id: r._id, storeId })}
              />
            ),
          },
          {
            title: 'Actions',
            render: (_, r) => (
              <Space>
                {r.pickerProfile?.status !== 'approved' && (
                  <Button size="small" type="primary" onClick={() => statusMutation.mutate({ id: r._id, status: 'approved' })}>
                    Approve
                  </Button>
                )}
                {r.pickerProfile?.status !== 'blocked' ? (
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
