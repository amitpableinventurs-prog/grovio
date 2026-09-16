import { useState } from 'react';
import { Table, Typography, Button, Modal, Form, Input, InputNumber, Select, Switch, DatePicker, Space, Popconfirm, App as AntApp } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { fetchCoupons, createCoupon, updateCoupon, deleteCoupon } from '../api/coupons';
import type { Coupon } from '../types';
import { formatCurrency } from '../utils/format';

export default function CouponsPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form] = Form.useForm();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['coupons'], queryFn: fetchCoupons });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['coupons'] });

  const createMutation = useMutation({
    mutationFn: createCoupon,
    onSuccess: () => {
      message.success('Coupon created');
      invalidate();
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Coupon> }) => updateCoupon(id, data),
    onSuccess: () => {
      message.success('Coupon updated');
      invalidate();
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCoupon,
    onSuccess: () => {
      message.success('Coupon deleted');
      invalidate();
    },
  });

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  }

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  }

  function openEdit(coupon: Coupon) {
    setEditing(coupon);
    form.setFieldsValue({
      ...coupon,
      validFrom: coupon.validFrom ? dayjs(coupon.validFrom) : undefined,
      validTo: coupon.validTo ? dayjs(coupon.validTo) : undefined,
    });
    setModalOpen(true);
  }

  function handleSubmit(values: Record<string, unknown>) {
    const payload = {
      ...values,
      validFrom: values.validFrom ? (values.validFrom as dayjs.Dayjs).toISOString() : null,
      validTo: values.validTo ? (values.validTo as dayjs.Dayjs).toISOString() : null,
    };
    if (editing) {
      updateMutation.mutate({ id: editing._id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <div>
      <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Coupons
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Coupon
        </Button>
      </Space>

      <Table<Coupon>
        rowKey="_id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        columns={[
          { title: 'Code', dataIndex: 'code' },
          { title: 'Type', dataIndex: 'discountType' },
          {
            title: 'Value',
            render: (_, r) => (r.discountType === 'flat' ? formatCurrency(r.discountValue) : `${r.discountValue}%`),
          },
          { title: 'Min Order', render: (_, r) => formatCurrency(r.minOrderAmount) },
          { title: 'Per-user Limit', dataIndex: 'perUserLimit' },
          { title: 'Scope', render: (_, r) => (r.vendor ? 'Vendor-specific' : 'Platform-wide') },
          { title: 'Active', render: (_, r) => (r.isActive ? 'Yes' : 'No') },
          {
            title: 'Actions',
            render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => openEdit(r)}>
                  Edit
                </Button>
                <Popconfirm title="Delete this coupon?" onConfirm={() => deleteMutation.mutate(r._id)}>
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
        title={editing ? 'Edit Coupon' : 'Add Coupon'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="code" label="Coupon Code" rules={[{ required: true }]}>
            <Input disabled={!!editing} style={{ textTransform: 'uppercase' }} />
          </Form.Item>
          <Form.Item name="discountType" label="Discount Type" rules={[{ required: true }]} initialValue="flat">
            <Select
              options={[
                { value: 'flat', label: 'Flat Amount' },
                { value: 'percent', label: 'Percentage' },
              ]}
            />
          </Form.Item>
          <Form.Item name="discountValue" label="Discount Value" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="minOrderAmount" label="Minimum Order Amount" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="maxDiscount" label="Max Discount Cap (for percentage)">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="perUserLimit" label="Per-user Usage Limit" initialValue={1}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="validFrom" label="Valid From" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="validTo" label="Valid To" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="isActive" label="Active" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
