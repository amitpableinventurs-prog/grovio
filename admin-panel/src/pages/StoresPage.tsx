import { useState } from 'react';
import { Table, Typography, Space, Button, Modal, Form, Input, InputNumber, Select, Popconfirm, App as AntApp } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchStores, updateStore } from '../api/stores';
import type { Store, Vendor } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import HubScreensModal from '../components/HubScreensModal';

export default function StoresPage() {
  const { page, pageSize, onChange } = usePageState();
  const [editing, setEditing] = useState<Store | null>(null);
  const [screensFor, setScreensFor] = useState<Store | null>(null);
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
          { title: 'Delivery Radius', render: (_, r) => (r.serviceRadiusKm ? `${r.serviceRadiusKm} km` : 'Default') },
          { title: 'Hours', render: (_, r) => (r.openTime && r.closeTime ? `${r.openTime} - ${r.closeTime}` : '—') },
          { title: 'Open Now', render: (_, r) => <StatusTag status={r.isOpen ? 'open' : 'closed'} /> },
          { title: 'Status', render: (_, r) => <StatusTag status={r.status} /> },
          {
            title: 'Actions',
            render: (_, r) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(r);
                    form.setFieldsValue({ zoneId: r.zoneId, status: r.status, openTime: r.openTime, closeTime: r.closeTime, lat: r.lat, lng: r.lng, serviceRadiusKm: r.serviceRadiusKm });
                  }}
                >
                  Edit
                </Button>
                <Button size="small" onClick={() => setScreensFor(r)}>
                  Hub screens
                </Button>
                <Popconfirm
                  title={r.status === 'active' ? 'Deactivate this store?' : 'Activate this store?'}
                  description={r.status === 'active' ? 'Customers will no longer see this store.' : undefined}
                  onConfirm={() => updateMutation.mutate({ id: r._id, values: { status: r.status === 'active' ? 'inactive' : 'active' } })}
                >
                  <Button size="small" danger={r.status === 'active'} loading={updateMutation.isPending && updateMutation.variables?.id === r._id}>
                    {r.status === 'active' ? 'Deactivate' : 'Activate'}
                  </Button>
                </Popconfirm>
              </Space>
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
          onFinish={(values) => editing && updateMutation.mutate({ id: editing._id, values: { ...values, serviceRadiusKm: values.serviceRadiusKm ?? '' } })}
        >
          <Form.Item name="zoneId" label="Zone ID">
            <Input placeholder="e.g. ZONE-NORTH" />
          </Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="lat" label="Latitude" style={{ flex: 1 }} extra="Needed for ETAs, the live map and the delivery area">
              <InputNumber style={{ width: '100%' }} min={-90} max={90} step={0.0001} placeholder="28.4595" />
            </Form.Item>
            <Form.Item name="lng" label="Longitude" style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={-180} max={180} step={0.0001} placeholder="77.0266" />
            </Form.Item>
          </Space>
          <Form.Item name="serviceRadiusKm" label="Delivery radius (km)" extra="Addresses farther than this can't order from the store. Blank = the default in Settings.">
            <InputNumber style={{ width: '100%' }} min={0} step={0.5} />
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

      <HubScreensModal store={screensFor} onClose={() => setScreensFor(null)} />
    </div>
  );
}
