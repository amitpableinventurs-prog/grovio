import { useState } from 'react';
import { Table, Typography, Space, Button, Modal, Form, Input, InputNumber, Select, Dropdown, Tag, App as AntApp } from 'antd';
import { DeleteOutlined, EditOutlined, MoreOutlined, PoweroffOutlined, DesktopOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchStores, updateStore, deleteStore } from '../api/stores';
import type { Store } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import HubScreensModal from '../components/HubScreensModal';

export default function StoresPage() {
  const { page, pageSize, setPage, onChange } = usePageState();
  const [status, setStatus] = useState<Store['status'] | undefined>();
  const [editing, setEditing] = useState<Store | null>(null);
  const [screensFor, setScreensFor] = useState<Store | null>(null);
  const [form] = Form.useForm();
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['stores', page, pageSize, status],
    queryFn: () => fetchStores({ page, limit: pageSize, status }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<Store> }) => updateStore(id, values),
    onSuccess: () => {
      message.success('Store updated');
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      setEditing(null);
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not update store'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStore(id),
    onSuccess: () => {
      message.success('Store deleted');
      queryClient.invalidateQueries({ queryKey: ['stores'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not delete store'),
  });

  const openEdit = (r: Store) => {
    setEditing(r);
    form.setFieldsValue({
      name: r.name, address: r.address, zoneId: r.zoneId, status: r.status, openTime: r.openTime, closeTime: r.closeTime,
      lat: r.lat, lng: r.lng, serviceRadiusKm: r.serviceRadiusKm,
    });
  };

  const confirmToggle = (r: Store) => {
    const deactivate = r.status === 'active';
    modal.confirm({
      title: `${deactivate ? 'Deactivate' : 'Activate'} ${r.name}?`,
      content: deactivate ? 'Customers will no longer see this store.' : 'Customers will see this store again.',
      okText: deactivate ? 'Deactivate' : 'Activate',
      okButtonProps: { danger: deactivate },
      onOk: () => updateMutation.mutateAsync({ id: r._id, values: { status: deactivate ? 'inactive' : 'active' } }).catch(() => undefined),
    });
  };

  const confirmDelete = (r: Store) => {
    modal.confirm({
      title: `Delete ${r.name}?`,
      content: 'Its products and hub screens are deleted too, and its staff are unlinked. A store with order history can’t be deleted — deactivate it instead.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => deleteMutation.mutateAsync(r._id).catch(() => undefined),
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Stores</Typography.Title>
          {data && <Typography.Text type="secondary">{data.meta.totalItems} store{data.meta.totalItems === 1 ? '' : 's'}</Typography.Text>}
        </div>
        <Select
          placeholder="Filter by status"
          allowClear
          style={{ width: 200 }}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
        />
      </div>

      <Table<Store>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        scroll={{ x: 'max-content' }}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          {
            title: 'Store',
            width: 300,
            render: (_, r) => (
              <div style={{ minWidth: 220 }}>
                <Typography.Text strong>{r.name}</Typography.Text>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.address || 'No address'}</Typography.Text>
                </div>
              </div>
            ),
          },
          {
            title: 'Manager',
            render: (_, r) =>
              r.managers?.length ? (
                <div style={{ display: 'grid', gap: 6 }}>
                  {r.managers.map((m) => (
                    <div key={m._id} style={{ whiteSpace: 'nowrap' }}>
                      <Typography.Text>{m.name}</Typography.Text>
                      <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{m.email}</Typography.Text>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
          {
            title: 'Delivery area',
            render: (_, r) => (
              <div style={{ whiteSpace: 'nowrap' }}>
                {r.serviceRadiusKm ? `${r.serviceRadiusKm} km` : <Typography.Text type="secondary">Default radius</Typography.Text>}
                {r.zoneId && <div><Tag style={{ marginTop: 4 }}>{r.zoneId}</Tag></div>}
              </div>
            ),
          },
          {
            title: 'Hours',
            render: (_, r) => (
              <Space size={8} style={{ whiteSpace: 'nowrap' }}>
                <span>{r.openTime && r.closeTime ? `${r.openTime} – ${r.closeTime}` : <Typography.Text type="secondary">Not set</Typography.Text>}</span>
                <StatusTag status={r.isOpen ? 'open' : 'closed'} />
              </Space>
            ),
          },
          { title: 'Status', render: (_, r) => <StatusTag status={r.status} /> },
          {
            title: 'Actions',
            align: 'right',
            render: (_, r) => (
              <Space size={8} style={{ whiteSpace: 'nowrap' }}>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
                  Edit
                </Button>
                <Button size="small" icon={<DesktopOutlined />} onClick={() => setScreensFor(r)}>
                  Hub screens
                </Button>
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      { key: 'toggle', icon: <PoweroffOutlined />, label: r.status === 'active' ? 'Deactivate' : 'Activate', danger: r.status === 'active' },
                      { type: 'divider' },
                      { key: 'delete', icon: <DeleteOutlined />, label: 'Delete store', danger: true },
                    ],
                    onClick: ({ key }) => (key === 'delete' ? confirmDelete(r) : confirmToggle(r)),
                  }}
                >
                  <Button
                    size="small"
                    icon={<MoreOutlined />}
                    aria-label={`More actions for ${r.name}`}
                    loading={(updateMutation.isPending && updateMutation.variables?.id === r._id) || (deleteMutation.isPending && deleteMutation.variables === r._id)}
                  />
                </Dropdown>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `Edit ${editing.name}` : 'Edit Store'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        okText="Save"
        confirmLoading={updateMutation.isPending}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => editing && updateMutation.mutate({ id: editing._id, values: { ...values, serviceRadiusKm: values.serviceRadiusKm ?? '' } })}
        >
          <Form.Item name="name" label="Store name" rules={[{ required: true, whitespace: true, message: 'Enter the store name' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="address" label="Address">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
            <Form.Item name="lat" label="Latitude" extra="Needed for ETAs, the live map and the delivery area">
              <InputNumber style={{ width: '100%' }} min={-90} max={90} step={0.0001} placeholder="28.4595" />
            </Form.Item>
            <Form.Item name="lng" label="Longitude">
              <InputNumber style={{ width: '100%' }} min={-180} max={180} step={0.0001} placeholder="77.0266" />
            </Form.Item>
            <Form.Item name="zoneId" label="Zone ID">
              <Input placeholder="e.g. ZONE-NORTH" />
            </Form.Item>
            <Form.Item name="serviceRadiusKm" label="Delivery radius (km)" extra="Blank = the default in Settings">
              <InputNumber style={{ width: '100%' }} min={0} step={0.5} />
            </Form.Item>
            <Form.Item name="openTime" label="Open time">
              <Input placeholder="09:00" />
            </Form.Item>
            <Form.Item name="closeTime" label="Close time">
              <Input placeholder="21:00" />
            </Form.Item>
          </div>
          <Form.Item name="status" label="Status" style={{ marginBottom: 0 }}>
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
