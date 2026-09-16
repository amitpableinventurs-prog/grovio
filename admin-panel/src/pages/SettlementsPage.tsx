import { useState } from 'react';
import { Table, Typography, Button, Modal, Form, Select, DatePicker, Space, Popconfirm, App as AntApp } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { fetchSettlements, generateSettlement, markSettlementPaid } from '../api/settlements';
import { fetchUsersByRole } from '../api/users';
import type { Settlement, Vendor, User } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import { formatCurrency, formatDateTime } from '../utils/format';

export default function SettlementsPage() {
  const { page, pageSize, onChange } = usePageState();
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['settlements', page, pageSize],
    queryFn: () => fetchSettlements({ page, limit: pageSize }),
  });

  const { data: vendors } = useQuery({ queryKey: ['approved-vendors'], queryFn: () => fetchUsersByRole('vendor', { limit: 100, status: 'approved' }) });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['settlements'] });

  const generateMutation = useMutation({
    mutationFn: (values: { vendorId: string; from?: string; to?: string }) => generateSettlement(values),
    onSuccess: () => {
      message.success('Settlement generated');
      invalidate();
      setModalOpen(false);
      form.resetFields();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Failed to generate settlement');
    },
  });

  const payMutation = useMutation({
    mutationFn: markSettlementPaid,
    onSuccess: () => {
      message.success('Settlement marked as paid');
      invalidate();
    },
  });

  function handleGenerate(values: { vendorId: string; range?: [dayjs.Dayjs, dayjs.Dayjs] }) {
    generateMutation.mutate({
      vendorId: values.vendorId,
      from: values.range?.[0]?.toISOString(),
      to: values.range?.[1]?.toISOString(),
    });
  }

  return (
    <div>
      <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Settlements
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Generate Settlement
        </Button>
      </Space>

      <Table<Settlement>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          { title: 'Payee', render: (_, r) => (typeof r.payeeUser === 'object' ? (r.payeeUser as User).name : r.payeeUser) },
          { title: 'Vendor', render: (_, r) => (r.vendor && typeof r.vendor === 'object' ? (r.vendor as Vendor).businessName : '—') },
          { title: 'Period', render: (_, r) => `${formatDateTime(r.periodFrom)} → ${formatDateTime(r.periodTo)}` },
          { title: 'Orders', dataIndex: 'orderCount' },
          { title: 'Gross', render: (_, r) => formatCurrency(r.grossAmount) },
          { title: 'Commission', render: (_, r) => formatCurrency(r.commissionAmount) },
          { title: 'Payout', render: (_, r) => formatCurrency(r.payoutAmount) },
          { title: 'Status', render: (_, r) => <StatusTag status={r.status} /> },
          {
            title: 'Actions',
            render: (_, r) =>
              r.status === 'pending' ? (
                <Popconfirm title="Mark this settlement as paid?" onConfirm={() => payMutation.mutate(r._id)}>
                  <Button size="small" type="primary">
                    Mark Paid
                  </Button>
                </Popconfirm>
              ) : (
                '—'
              ),
          },
        ]}
      />

      <Modal
        title="Generate Vendor Settlement"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={generateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleGenerate}>
          <Form.Item name="vendorId" label="Vendor" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={vendors?.items
                .filter((v) => v.vendorProfile)
                .map((v) => ({ value: v.vendorProfile!._id, label: v.vendorProfile?.businessName || v.name }))}
            />
          </Form.Item>
          <Form.Item name="range" label="Period (optional — leave blank for all unsettled orders)">
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
