import { useState } from 'react';
import { Table, Typography, Input, Space, Button, Tag, App as AntApp } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchUsersByRole, toggleUserActive } from '../api/users';
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
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
