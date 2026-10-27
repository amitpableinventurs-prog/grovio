import { useState } from 'react';
import { Table, Typography, Input, Space, Button, Tag, Popconfirm, App as AntApp } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchUsersByRole, toggleUserActive, deleteCustomer } from '../api/users';
import type { UserWithProfile } from '../types';
import { usePageState } from '../hooks/usePageState';
import { formatDateTime } from '../utils/format';

export default function CustomersPage() {
  const { page, pageSize, onChange } = usePageState();
  const [search, setSearch] = useState('');
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['customers', page, pageSize, search],
    queryFn: () => fetchUsersByRole('customer', { page, limit: pageSize, search: search || undefined }),
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => toggleUserActive(id, isActive),
    onSuccess: () => {
      message.success('Customer updated');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => {
      message.success('Customer deleted');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not delete customer'),
  });

  return (
    <div>
      <Typography.Title level={3}>Customers</Typography.Title>

      <Input
        placeholder="Search by name or phone"
        prefix={<SearchOutlined />}
        onPressEnter={(e) => setSearch((e.target as HTMLInputElement).value)}
        allowClear
        onClear={() => setSearch('')}
        style={{ width: 260, marginBottom: 16 }}
      />

      <Table<UserWithProfile>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Phone', dataIndex: 'phone' },
          { title: 'Joined', render: (_, r) => formatDateTime(r.createdAt) },
          {
            title: 'Account',
            render: (_, r) => <Tag color={r.isActive ? 'green' : 'red'}>{r.isActive ? 'Active' : 'Blocked'}</Tag>,
          },
          {
            title: 'Actions',
            render: (_, r) => (
              <Space>
                <Button size="small" danger={r.isActive} onClick={() => activeMutation.mutate({ id: r._id, isActive: !r.isActive })}>
                  {r.isActive ? 'Block' : 'Unblock'}
                </Button>
                <Popconfirm
                  title={`Delete ${r.name}'s account?`}
                  description={
                    <div style={{ maxWidth: 280 }}>
                      Their addresses, cart, wishlist and contact details are removed for good. Past orders and payments stay, under
                      "Deleted user". Any wallet balance is lost.
                    </div>
                  }
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => deleteMutation.mutate(r._id)}
                >
                  <Button size="small" danger>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
