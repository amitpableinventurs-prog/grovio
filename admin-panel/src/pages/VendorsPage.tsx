import { useState } from 'react';
import { Table, Typography, Input, Select, Space, Button, Tag, Drawer, Descriptions, App as AntApp } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchUsersByRole, fetchUserDetail, updateVendorStatus, toggleUserActive } from '../api/users';
import type { UserWithProfile } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import { formatDateTime } from '../utils/format';

export default function VendorsPage() {
  const { page, pageSize, onChange } = usePageState();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [detailId, setDetailId] = useState<string | null>(null);
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['vendors', page, pageSize, search, status],
    queryFn: () => fetchUsersByRole('vendor', { page, limit: pageSize, search: search || undefined, status }),
  });

  const { data: detail } = useQuery({
    queryKey: ['user-detail', detailId],
    queryFn: () => fetchUserDetail(detailId as string),
    enabled: !!detailId,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: string }) => updateVendorStatus(id, newStatus),
    onSuccess: () => {
      message.success('Vendor status updated');
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
    },
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => toggleUserActive(id, isActive),
    onSuccess: () => {
      message.success('User updated');
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
    },
  });

  return (
    <div>
      <Typography.Title level={3}>Vendors</Typography.Title>

      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="Search by name or phone"
          prefix={<SearchOutlined />}
          onPressEnter={(e) => setSearch((e.target as HTMLInputElement).value)}
          allowClear
          onClear={() => setSearch('')}
          style={{ width: 260 }}
        />
        <Select
          placeholder="Filter by status"
          allowClear
          style={{ width: 180 }}
          value={status}
          onChange={setStatus}
          options={[
            { value: 'pending', label: 'Pending' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'blocked', label: 'Blocked' },
          ]}
        />
      </Space>

      <Table<UserWithProfile>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{
          current: page,
          pageSize,
          total: data?.meta.totalItems,
          onChange,
          showSizeChanger: true,
        }}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Email', dataIndex: 'email' },
          { title: 'Phone', dataIndex: 'phone' },
          {
            title: 'Business',
            render: (_, r) => r.vendorProfile?.businessName || '—',
          },
          {
            title: 'Status',
            render: (_, r) => (r.vendorProfile ? <StatusTag status={r.vendorProfile.status} /> : '—'),
          },
          {
            title: 'Account',
            render: (_, r) => <Tag color={r.isActive ? 'green' : 'red'}>{r.isActive ? 'Active' : 'Disabled'}</Tag>,
          },
          { title: 'Joined', render: (_, r) => formatDateTime(r.createdAt) },
          {
            title: 'Actions',
            fixed: 'right',
            render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => setDetailId(r._id)}>
                  View
                </Button>
                {r.vendorProfile?.status !== 'approved' && (
                  <Button size="small" type="primary" onClick={() => statusMutation.mutate({ id: r._id, newStatus: 'approved' })}>
                    Approve
                  </Button>
                )}
                {r.vendorProfile?.status !== 'rejected' && r.vendorProfile?.status === 'pending' && (
                  <Button size="small" danger onClick={() => statusMutation.mutate({ id: r._id, newStatus: 'rejected' })}>
                    Reject
                  </Button>
                )}
                {r.vendorProfile?.status !== 'blocked' ? (
                  <Button size="small" danger onClick={() => statusMutation.mutate({ id: r._id, newStatus: 'blocked' })}>
                    Block
                  </Button>
                ) : (
                  <Button size="small" onClick={() => statusMutation.mutate({ id: r._id, newStatus: 'approved' })}>
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
        scroll={{ x: 1100 }}
      />

      <Drawer title="Vendor Detail" open={!!detailId} onClose={() => setDetailId(null)} width={420}>
        {detail && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Name">{detail.name}</Descriptions.Item>
            <Descriptions.Item label="Email">{detail.email}</Descriptions.Item>
            <Descriptions.Item label="Phone">{detail.phone}</Descriptions.Item>
            <Descriptions.Item label="Business Name">{detail.vendorProfile?.businessName}</Descriptions.Item>
            <Descriptions.Item label="Commission %">{detail.vendorProfile?.commissionPercent}</Descriptions.Item>
            <Descriptions.Item label="Status">
              {detail.vendorProfile && <StatusTag status={detail.vendorProfile.status} />}
            </Descriptions.Item>
            <Descriptions.Item label="Joined">{formatDateTime(detail.createdAt)}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}
