import { useState } from 'react';
import { Table, Typography, Space, Button, Modal, Form, Input, Popconfirm, App as AntApp } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchUsersByRole,
  updateDeliveryStatus,
  toggleUserActive,
  createDeliveryPartner,
  updateDeliveryPartner,
  deleteDeliveryPartner,
  type DeliveryPartnerInput,
} from '../api/users';
import type { UserWithProfile } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';

export default function DeliveryPartnersPage() {
  const { page, pageSize, onChange } = usePageState();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserWithProfile | null>(null);
  const [form] = Form.useForm<DeliveryPartnerInput>();

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-partners', page, pageSize],
    queryFn: () => fetchUsersByRole('delivery', { page, limit: pageSize }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['delivery-partners'] });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateDeliveryStatus(id, status),
    onSuccess: () => {
      message.success('Delivery partner status updated');
      invalidate();
    },
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => toggleUserActive(id, isActive),
    onSuccess: () => {
      message.success('Updated');
      invalidate();
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: DeliveryPartnerInput) => createDeliveryPartner(values),
    onSuccess: () => {
      message.success('Delivery partner created');
      closeForm();
      invalidate();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not create delivery partner'),
  });

  const updateMutation = useMutation({
    mutationFn: (values: DeliveryPartnerInput) => updateDeliveryPartner(editing!._id, values),
    onSuccess: () => {
      message.success('Delivery partner updated');
      closeForm();
      invalidate();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not update delivery partner'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDeliveryPartner(id),
    onSuccess: () => {
      message.success('Delivery partner deleted');
      invalidate();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not delete delivery partner'),
  });

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setFormOpen(true);
  }

  function openEdit(record: UserWithProfile) {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      email: record.email ?? undefined,
      vehicleType: record.deliveryProfile?.vehicleType ?? undefined,
      vehicleNumber: record.deliveryProfile?.vehicleNumber ?? undefined,
      licenseNumber: record.deliveryProfile?.licenseNumber ?? undefined,
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    form.resetFields();
  }

  function handleSubmit(values: DeliveryPartnerInput) {
    if (editing) updateMutation.mutate(values);
    else createMutation.mutate(values);
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Delivery Partners
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Delivery Partner
        </Button>
      </Space>

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
              <Space wrap>
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
                <Button size="small" onClick={() => openEdit(r)}>
                  Edit
                </Button>
                <Popconfirm
                  title="Delete this delivery partner?"
                  description="Refused if a job is still in progress with them."
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

      <Modal
        title={editing ? 'Edit Delivery Partner' : 'Add Delivery Partner'}
        open={formOpen}
        onCancel={closeForm}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Full Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {!editing && (
            <Form.Item name="phone" label="Phone" rules={[{ required: true, message: 'Phone is required' }]}>
              <Input placeholder="e.g. 9876543210" />
            </Form.Item>
          )}
          <Form.Item name="email" label="Email (optional)">
            <Input type="email" />
          </Form.Item>
          <Form.Item name="vehicleType" label="Vehicle Type">
            <Input placeholder="e.g. bike" />
          </Form.Item>
          <Form.Item name="vehicleNumber" label="Vehicle Number">
            <Input placeholder="e.g. MP20AB1234" />
          </Form.Item>
          <Form.Item name="licenseNumber" label="License Number">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
