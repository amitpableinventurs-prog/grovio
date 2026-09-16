import { useState } from 'react';
import { Table, Typography, Space, Button, Modal, Form, Input, Select, App as AntApp } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchStores, updateStore } from '../api/stores';
import type { Store, Vendor } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';

export default function StoresPage() {
  const { page, pageSize, onChange } = usePageState();
  const [editing, setEditing] = useState<Store | null>(null);
  const [form] = Form.useForm();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['stores', page, pageSize],
    queryFn: () => fetchStores({ page, limit: pageSize }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<Store> }) => updateStore(id, values),
    onSuccess: () => {
      message.success('Store updated');
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      setEditing(null);
    },
  });

  return (
    <div>
      <Typography.Title level={3}>Stores</Typography.Title>

      <Table<Store>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          { title: 'Store Name', dataIndex: 'name' },
          {
            title: 'Vendor',
            render: (_, r) => (typeof r.vendor === 'object' ? (r.vendor as Vendor).businessName : r.vendor),
          },
          { title: 'Address', dataIndex: 'address' },
          { title: 'Zone', dataIndex: 'zoneId', render: (v) => v || '—' },
          { title: 'Hours', render: (_, r) => (r.openTime && r.closeTime ? `${r.openTime} - ${r.closeTime}` : '—') },
          { title: 'Open Now', render: (_, r) => <StatusTag status={r.isOpen ? 'open' : 'closed'} /> },
          { title: 'Status', render: (_, r) => <StatusTag status={r.status} /> },
          {
            title: 'Actions',
            render: (_, r) => (
              <Button
                size="small"
                onClick={() => {
                  setEditing(r);
                  form.setFieldsValue({ zoneId: r.zoneId, status: r.status, openTime: r.openTime, closeTime: r.closeTime });
                }}
              >
                Edit
              </Button>
            ),
          },
        ]}
      />

      <Modal
        title="Edit Store"
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={updateMutation.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => editing && updateMutation.mutate({ id: editing._id, values })}
        >
          <Form.Item name="zoneId" label="Zone ID">
            <Input placeholder="e.g. ZONE-NORTH" />
          </Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="openTime" label="Open Time" style={{ flex: 1 }}>
              <Input placeholder="09:00" />
            </Form.Item>
            <Form.Item name="closeTime" label="Close Time" style={{ flex: 1 }}>
              <Input placeholder="21:00" />
            </Form.Item>
          </Space>
          <Form.Item name="status" label="Status">
            <Select
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
