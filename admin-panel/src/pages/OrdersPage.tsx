import { useMemo, useState } from 'react';
import {
  Table,
  Typography,
  Select,
  Space,
  Button,
  Drawer,
  Descriptions,
  Timeline,
  Modal,
  Form,
  InputNumber,
  Input,
  App as AntApp,
} from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchOrders, fetchOrder, assignPickerToOrder, assignDeliveryToOrder, issueRefund } from '../api/orders';
import { fetchUsersByRole } from '../api/users';
import type { Order, User, Store } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import { formatCurrency, formatDateTime, titleCase } from '../utils/format';

const ORDER_STATUSES = [
  'placed', 'accepted', 'rejected', 'picking', 'packed', 'assigned',
  'out_for_delivery', 'delivery_failed', 'delivered', 'cancelled', 'returned',
];

export default function OrdersPage() {
  const { page, pageSize, onChange } = usePageState();
  const [status, setStatus] = useState<string | undefined>();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundForm] = Form.useForm();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['orders', page, pageSize, status],
    queryFn: () => fetchOrders({ page, limit: pageSize, status }),
  });

  const { data: order } = useQuery({
    queryKey: ['order-detail', detailId],
    queryFn: () => fetchOrder(detailId as string),
    enabled: !!detailId,
  });

  const { data: pickers } = useQuery({ queryKey: ['approved-pickers'], queryFn: () => fetchUsersByRole('picker', { limit: 100, status: 'approved' }) });
  const { data: deliveryPartners } = useQuery({ queryKey: ['approved-delivery'], queryFn: () => fetchUsersByRole('delivery', { limit: 100, status: 'approved' }) });

  // The Select only knows the label for a user in its fetched (approved) options list. If the
  // order's already-assigned picker/delivery partner isn't in that list for any reason, fall back
  // to the name the order itself was populated with — otherwise the Select shows the raw user ID.
  const pickerOptions = useMemo(() => {
    const base = pickers?.items.map((p) => ({ value: p._id, label: p.name })) ?? [];
    const assigned = order && typeof order.picker === 'object' ? (order.picker as User) : null;
    if (assigned && !base.some((o) => o.value === assigned._id)) {
      base.push({ value: assigned._id, label: assigned.name });
    }
    return base;
  }, [pickers, order]);

  const deliveryOptions = useMemo(() => {
    const base = deliveryPartners?.items.map((p) => ({ value: p._id, label: p.name })) ?? [];
    const assigned = order && typeof order.delivery === 'object' ? (order.delivery as User) : null;
    if (assigned && !base.some((o) => o.value === assigned._id)) {
      base.push({ value: assigned._id, label: assigned.name });
    }
    return base;
  }, [deliveryPartners, order]);

  const invalidateDetail = () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['order-detail', detailId] });
  };

  const assignPickerMutation = useMutation({
    mutationFn: (pickerId: string) => assignPickerToOrder(detailId as string, pickerId),
    onSuccess: () => {
      message.success('Picker assigned');
      invalidateDetail();
    },
  });

  const assignDeliveryMutation = useMutation({
    mutationFn: (deliveryId: string) => assignDeliveryToOrder(detailId as string, deliveryId),
    onSuccess: () => {
      message.success('Delivery partner assigned');
      invalidateDetail();
    },
  });

  const refundMutation = useMutation({
    mutationFn: (values: { amount: number; reason: string }) => issueRefund(detailId as string, values.amount, values.reason),
    onSuccess: () => {
      message.success('Refund issued');
      setRefundOpen(false);
      refundForm.resetFields();
      invalidateDetail();
    },
  });

  return (
    <div>
      <Typography.Title level={3}>Orders</Typography.Title>

      <Select
        placeholder="Filter by status"
        allowClear
        style={{ width: 220, marginBottom: 16 }}
        value={status}
        onChange={setStatus}
        options={ORDER_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))}
      />

      <Table<Order>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          { title: 'Order #', dataIndex: 'orderNumber' },
          { title: 'Customer', render: (_, r) => (typeof r.customer === 'object' ? (r.customer as User).name : '—') },
          { title: 'Store', render: (_, r) => (typeof r.store === 'object' ? (r.store as Store).name : '—') },
          { title: 'Total', render: (_, r) => formatCurrency(r.grandTotal) },
          { title: 'Payment', render: (_, r) => <StatusTag status={r.paymentStatus} /> },
          { title: 'Status', render: (_, r) => <StatusTag status={r.orderStatus} /> },
          { title: 'Placed', render: (_, r) => formatDateTime(r.placedAt) },
          {
            title: 'Actions',
            render: (_, r) => (
              <Button size="small" onClick={() => setDetailId(r._id)}>
                View
              </Button>
            ),
          },
        ]}
      />

      <Drawer title={order ? `Order ${order.orderNumber}` : 'Order Detail'} open={!!detailId} onClose={() => setDetailId(null)} width={520}>
        {order && (
          <>
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Status">
                <StatusTag status={order.orderStatus} />
              </Descriptions.Item>
              <Descriptions.Item label="Payment">
                <StatusTag status={order.paymentStatus} /> ({order.paymentMethod})
              </Descriptions.Item>
              <Descriptions.Item label="Item Total">{formatCurrency(order.itemTotal)}</Descriptions.Item>
              <Descriptions.Item label="Delivery Fee">{formatCurrency(order.deliveryFee)}</Descriptions.Item>
              <Descriptions.Item label="Discount">{formatCurrency(order.discount)}</Descriptions.Item>
              <Descriptions.Item label="Grand Total">{formatCurrency(order.grandTotal)}</Descriptions.Item>
              {order.couponCode && <Descriptions.Item label="Coupon">{order.couponCode}</Descriptions.Item>}
            </Descriptions>

            <Typography.Title level={5}>Items</Typography.Title>
            <ul>
              {order.items.map((item) => (
                <li key={item._id}>
                  {item.nameSnapshot} × {item.qty} — {formatCurrency(item.price * item.qty)}
                </li>
              ))}
            </ul>

            <Typography.Title level={5}>Assignment</Typography.Title>
            <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
              <Select
                style={{ width: '100%' }}
                placeholder="Assign picker"
                value={typeof order.picker === 'object' ? (order.picker as User)?._id : order.picker || undefined}
                options={pickerOptions}
                onChange={(pickerId) => assignPickerMutation.mutate(pickerId)}
              />
              <Select
                style={{ width: '100%' }}
                placeholder="Assign delivery partner"
                value={typeof order.delivery === 'object' ? (order.delivery as User)?._id : order.delivery || undefined}
                options={deliveryOptions}
                onChange={(deliveryId) => assignDeliveryMutation.mutate(deliveryId)}
              />
            </Space>

            <Space style={{ marginBottom: 16 }}>
              <Button danger onClick={() => setRefundOpen(true)}>
                Issue Refund
              </Button>
            </Space>

            <Typography.Title level={5}>Status Timeline</Typography.Title>
            <Timeline
              items={order.statusLogs.map((log) => ({
                children: (
                  <>
                    <StatusTag status={log.status} /> <Typography.Text type="secondary">{formatDateTime(log.createdAt)}</Typography.Text>
                    {log.note && <div>{log.note}</div>}
                  </>
                ),
              }))}
            />
          </>
        )}
      </Drawer>

      <Modal
        title="Issue Refund"
        open={refundOpen}
        onCancel={() => setRefundOpen(false)}
        onOk={() => refundForm.submit()}
        confirmLoading={refundMutation.isPending}
      >
        <Form form={refundForm} layout="vertical" onFinish={(values) => refundMutation.mutate(values)}>
          <Form.Item name="amount" label="Amount" rules={[{ required: true }]}>
            <InputNumber min={1} max={order?.grandTotal} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
