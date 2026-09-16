import { useState } from 'react';
import { Table, Typography, Button, Modal, Form, Input, Select, Tag, Space, App as AntApp } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAdmins, createAdmin, updateAdminPermissions } from '../api/admins';
import type { User } from '../types';
import { usePageState } from '../hooks/usePageState';
import { ALL_PERMISSIONS } from '../utils/permissions';
import { formatDateTime, titleCase } from '../utils/format';

export default function AdminsPage() {
  const { page, pageSize, onChange } = usePageState();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [createForm] = Form.useForm();
  const [permForm] = Form.useForm();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['admins', page, pageSize], queryFn: () => fetchAdmins({ page, limit: pageSize }) });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admins'] });

  const createMutation = useMutation({
    mutationFn: createAdmin,
    onSuccess: () => {
      message.success('Admin created');
      invalidate();
      setCreateOpen(false);
      createForm.resetFields();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Failed to create admin'),
  });

  const permMutation = useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: string[] }) => updateAdminPermissions(id, permissions),
    onSuccess: () => {
      message.success('Permissions updated');
      invalidate();
      setEditing(null);
    },
  });

  return (
    <div>
      <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Admins & Roles
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          Add Staff Admin
        </Button>
      </Space>

      <Table<User>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Email', dataIndex: 'email' },
          {
            title: 'Permissions',
            render: (_, r) =>
              r.permissions?.includes('*') ? (
                <Tag color="gold">Super Admin (all)</Tag>
              ) : (
                <Space wrap>
                  {r.permissions?.map((p) => (
                    <Tag key={p}>{titleCase(p)}</Tag>
                  ))}
                </Space>
              ),
          },
          { title: 'Joined', render: (_, r) => formatDateTime(r.createdAt) },
          {
            title: 'Actions',
            render: (_, r) =>
              r.permissions?.includes('*') ? (
                '—'
              ) : (
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(r);
                    permForm.setFieldsValue({ permissions: r.permissions });
                  }}
                >
                  Edit Permissions
                </Button>
              ),
          },
        ]}
      />

      <Modal
        title="Add Staff Admin"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={createMutation.isPending}
      >
        <Form form={createForm} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="permissions" label="Permissions" rules={[{ required: true }]}>
            <Select mode="multiple" options={ALL_PERMISSIONS.map((p) => ({ value: p, label: titleCase(p) }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Edit Permissions — ${editing?.name}`}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => permForm.submit()}
        confirmLoading={permMutation.isPending}
      >
        <Form
          form={permForm}
          layout="vertical"
          onFinish={(values) => editing && permMutation.mutate({ id: editing._id, permissions: values.permissions })}
        >
          <Form.Item name="permissions" label="Permissions">
            <Select mode="multiple" options={ALL_PERMISSIONS.map((p) => ({ value: p, label: titleCase(p) }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
