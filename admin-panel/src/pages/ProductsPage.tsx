import { Table, Typography, Select, Space, Button, Image, App as AntApp } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchProducts, setProductStatus } from '../api/catalog';
import type { Product, Store } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import { assetUrl, formatCurrency } from '../utils/format';
import { useState } from 'react';

export default function ProductsPage() {
  const { page, pageSize, onChange } = usePageState();
  const [status, setStatus] = useState<string | undefined>();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['products', page, pageSize, status],
    queryFn: () => fetchProducts({ page, limit: pageSize, status }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: 'active' | 'inactive' }) => setProductStatus(id, newStatus),
    onSuccess: () => {
      message.success('Product status updated');
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  return (
    <div>
      <Typography.Title level={3}>Products</Typography.Title>

      <Select
        placeholder="Filter by status"
        allowClear
        style={{ width: 180, marginBottom: 16 }}
        value={status}
        onChange={setStatus}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
        ]}
      />

      <Table<Product>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          {
            title: 'Image',
            render: (_, r) => (r.images[0] ? <Image src={assetUrl(r.images[0])} width={40} height={40} style={{ objectFit: 'cover' }} /> : '—'),
          },
          { title: 'Name', dataIndex: 'name' },
          {
            title: 'Store',
            render: (_, r) => (typeof r.store === 'object' ? (r.store as Store).name : r.store),
          },
          { title: 'Price', render: (_, r) => formatCurrency(r.discountPrice || r.price) },
          { title: 'Stock', dataIndex: 'stockQty' },
          { title: 'Status', render: (_, r) => <StatusTag status={r.status} /> },
          {
            title: 'Actions',
            render: (_, r) => (
              <Space>
                {r.status === 'active' ? (
                  <Button size="small" danger onClick={() => statusMutation.mutate({ id: r._id, newStatus: 'inactive' })}>
                    Deactivate
                  </Button>
                ) : (
                  <Button size="small" type="primary" onClick={() => statusMutation.mutate({ id: r._id, newStatus: 'active' })}>
                    Activate
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
