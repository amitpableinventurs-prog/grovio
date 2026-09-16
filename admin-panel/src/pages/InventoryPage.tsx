import { useState } from 'react';
import { Table, Typography, Switch, InputNumber, Space, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { fetchInventory } from '../api/inventory';
import type { Product, Store } from '../types';
import { usePageState } from '../hooks/usePageState';

export default function InventoryPage() {
  const { page, pageSize, onChange } = usePageState();
  const [lowStock, setLowStock] = useState(false);
  const [threshold, setThreshold] = useState(5);

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', page, pageSize, lowStock, threshold],
    queryFn: () => fetchInventory({ page, limit: pageSize, lowStock: lowStock ? 'true' : undefined, threshold }),
  });

  return (
    <div>
      <Typography.Title level={3}>Inventory</Typography.Title>

      <Space style={{ marginBottom: 16 }}>
        <Switch checked={lowStock} onChange={setLowStock} /> Low stock only
        {lowStock && (
          <>
            Threshold: <InputNumber min={1} value={threshold} onChange={(v) => setThreshold(v || 5)} />
          </>
        )}
      </Space>

      <Table<Product>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'SKU', dataIndex: 'sku', render: (v) => v || '—' },
          { title: 'Store', render: (_, r) => (typeof r.store === 'object' ? (r.store as Store).name : r.store) },
          {
            title: 'Stock Qty',
            render: (_, r) => <Tag color={r.stockQty <= 5 ? 'red' : r.stockQty <= 15 ? 'gold' : 'green'}>{r.stockQty}</Tag>,
          },
          { title: 'Variants', render: (_, r) => (r.variants.length ? `${r.variants.length} variant(s)` : '—') },
          { title: 'Available', render: (_, r) => <Tag color={r.isAvailable ? 'green' : 'red'}>{r.isAvailable ? 'Yes' : 'No'}</Tag> },
        ]}
      />
    </div>
  );
}
