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
import { fetchOrders, fetchOrder, assignPickerToOrder, assignDeliveryToOrder, issueRefund, fetchScannerLogs, cancelOrderAdmin, markOrderReturned } from '../api/orders';
import { fetchUsersByRole } from '../api/users';
import type { Order, User, Store } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import OrderLiveTracking from '../components/OrderLiveTracking';
import { formatCurrency, formatDateTime, titleCase } from '../utils/format';

const ORDER_STATUSES = [
  'placed', 'accepted', 'rejected', 'picking', 'partially_picked', 'packed', 'assigned', 'picked_up',
  'out_for_delivery', 'delivery_failed', 'delivered', 'cancelled', 'returned',
];

// Mirrors the backend's TRANSITIONS map (order.service.js) — cancellation isn't allowed once an
// order is out for delivery, delivered, or already in a terminal state.
const NON_CANCELLABLE_STATUSES = ['out_for_delivery', 'delivered', 'cancelled', 'rejected', 'returned'];

export default function OrdersPage() {
  const { page, pageSize, onChange } = usePageState();
  const [status, setStatus] = useState<string | undefined>();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundForm] = Form.useForm();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelForm] = Form.useForm();
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnForm] = Form.useForm();
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

  const { data: scannerLogs } = useQuery({
    queryKey: ['order-scanner-logs', detailId],
    queryFn: () => fetchScannerLogs(detailId as string),
    enabled: !!detailId,
  });

  const { data: pickers } = useQuery({ queryKey: ['approved-pickers'], queryFn: () => fetchUsersByRole('picker', { limit: 100, status: 'approved' }) });
  const { data: deliveryPartners } = useQuery({ queryKey: ['approved-delivery'], queryFn: () => fetchUsersByRole('delivery', { limit: 100, status: 'approved' }) });

  // The Select only knows the label for a user in its fetched (approved) options list. If any of
  // the order's already-assigned pickers aren't in that list for some reason, fall back to the
  // names the order itself was populated with — otherwise the Select would show a raw user ID.
  const pickerOptions = useMemo(() => {
    const base = pickers?.items.map((p) => ({ value: p._id, label: p.name })) ?? [];
    (order?.pickTasks ?? []).forEach((t) => {
      if (typeof t.picker === 'object') {
        const assigned = t.picker as User;
        if (!base.some((o) => o.value === assigned._id)) base.push({ value: assigned._id, label: assigned.name });
      }
    });
    return base;
  }, [pickers, order]);

  const pickerName = (userOrId: string | User | null | undefined) => {
    if (!userOrId) return null;
    if (typeof userOrId === 'object') return userOrId.name;
    return pickerOptions.find((o) => o.value === userOrId)?.label ?? userOrId;
  };

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
    mutationFn: ({ itemId, pickerId }: { itemId: string; pickerId: string }) => assignPickerToOrder(detailId as string, itemId, pickerId),
    onSuccess: () => {
      message.success('Item reassigned');
      invalidateDetail();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not reassign item'),
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

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => cancelOrderAdmin(detailId as string, reason),
    onSuccess: () => {
      message.success('Order cancelled');
      setCancelOpen(false);
      cancelForm.resetFields();
      invalidateDetail();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not cancel order'),
  });

  const returnMutation = useMutation({
    mutationFn: (reason: string) => markOrderReturned(detailId as string, reason),
    onSuccess: () => {
      message.success('Order marked as returned');
      setReturnOpen(false);
      returnForm.resetFields();
      invalidateDetail();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not mark order as returned'),
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
              {!!order.handlingCharge && <Descriptions.Item label="Handling Charge">{formatCurrency(order.handlingCharge)}</Descriptions.Item>}
              {!!order.packingCharge && <Descriptions.Item label="Packing Charge">{formatCurrency(order.packingCharge)}</Descriptions.Item>}
              {!!order.surcharge && <Descriptions.Item label={order.surchargeLabel || 'Surcharge'}>{formatCurrency(order.surcharge)}</Descriptions.Item>}
              <Descriptions.Item label="Discount">{formatCurrency(order.discount)}</Descriptions.Item>
              <Descriptions.Item label="Grand Total">{formatCurrency(order.grandTotal)}</Descriptions.Item>
              {order.couponCode && <Descriptions.Item label="Coupon">{order.couponCode}</Descriptions.Item>}
            </Descriptions>

            <Typography.Title level={5}>Items (split across {order.pickTasks.length || 0} picker(s))</Typography.Title>
            <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
              {order.items.map((item) => (
                <div key={item._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    {item.pickedAt ? '✅ ' : '⬜ '}
                    {item.nameSnapshot} × {item.qty} — {formatCurrency(item.price * item.qty)}
                  </span>
                  <Select
                    size="small"
                    style={{ width: 160 }}
                    placeholder="Picker"
                    value={typeof item.assignedPicker === 'object' ? (item.assignedPicker as User)?._id : item.assignedPicker || undefined}
                    options={pickerOptions}
                    onChange={(pickerId) => assignPickerMutation.mutate({ itemId: item._id, pickerId })}
                  />
                </div>
              ))}
            </Space>

            <Typography.Title level={5}>Pick Tasks</Typography.Title>
            <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
              {order.pickTasks.length === 0 && <Typography.Text type="secondary">No pickers assigned yet.</Typography.Text>}
              {order.pickTasks.map((task) => (
                <div key={task._id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{pickerName(task.picker)}</span>
                  <StatusTag status={task.status} />
                </div>
              ))}
            </Space>

            <Typography.Title level={5}>Delivery</Typography.Title>
            <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
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
              <Button
                danger
                disabled={NON_CANCELLABLE_STATUSES.includes(order.orderStatus)}
                onClick={() => setCancelOpen(true)}
              >
                Cancel Order
              </Button>
              <Button disabled={order.orderStatus !== 'delivery_failed'} onClick={() => setReturnOpen(true)}>
                Mark as Returned
              </Button>
            </Space>

            <OrderLiveTracking order={order} />

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

            {!!scannerLogs?.items.length && (
              <>
                <Typography.Title level={5}>Handover Scans</Typography.Title>
                <Table
                  size="small"
                  rowKey="_id"
                  pagination={false}
                  dataSource={scannerLogs.items}
                  columns={[
                    { title: 'When', render: (_, r) => formatDateTime(r.createdAt) },
                    { title: 'By', render: (_, r) => (typeof r.scannedBy === 'object' ? r.scannedBy.name : r.scannedBy) },
                    { title: 'Role', render: (_, r) => titleCase(r.userType) },
                    { title: 'Result', render: (_, r) => <StatusTag status={r.status} /> },
                    { title: 'Reason', render: (_, r) => r.failureReason || '—' },
                  ]}
                />
              </>
            )}
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

      <Modal
        title="Cancel Order"
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        onOk={() => cancelForm.submit()}
        confirmLoading={cancelMutation.isPending}
        okText="Cancel Order"
        okButtonProps={{ danger: true }}
      >
        <Form form={cancelForm} layout="vertical" onFinish={(values) => cancelMutation.mutate(values.reason)}>
          <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="Why is this order being cancelled?" />
          </Form.Item>
          {order?.paymentStatus === 'paid' && (
            <Typography.Text type="secondary">
              This order is already paid — cancelling will refund {formatCurrency(order.grandTotal)} to the customer's wallet.
            </Typography.Text>
          )}
        </Form>
      </Modal>

      <Modal
        title="Mark as Returned"
        open={returnOpen}
        onCancel={() => setReturnOpen(false)}
        onOk={() => returnForm.submit()}
        confirmLoading={returnMutation.isPending}
      >
        <Form form={returnForm} layout="vertical" onFinish={(values) => returnMutation.mutate(values.reason)}>
          <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="e.g. Customer refused delivery, item brought back to store" />
          </Form.Item>
          {order?.paymentStatus === 'paid' && (
            <Typography.Text type="secondary">
              This order is already paid — marking it returned will refund {formatCurrency(order.grandTotal)} to the customer's wallet.
            </Typography.Text>
          )}
        </Form>
      </Modal>
    </div>
  );
}
