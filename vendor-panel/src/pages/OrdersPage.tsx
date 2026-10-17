import { useState } from 'react';
import { Table, Typography, Select, Space, Button, Drawer, Descriptions, Timeline, Modal, Form, Input, App as AntApp } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchOrders, fetchOrder, cancelOrder, markOrderReturned } from '../api/orders';
import { apiErrorMessage } from '../api/client';
import type { Order, User } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import { formatCurrency, formatDateTime, titleCase } from '../utils/format';

const ORDER_STATUSES = [
  'placed', 'accepted', 'rejected', 'picking', 'partially_picked', 'packed', 'assigned', 'picked_up',
  'out_for_delivery', 'delivery_failed', 'delivered', 'cancelled', 'returned',
];

// Mirrors the backend's TRANSITIONS map (order.service.js) — cancellation isn't allowed once an
// order is out for delivery, delivered, or already in a terminal state.
const NON_CANCELLABLE_STATUSES = ['out_for_delivery', 'delivered', 'cancelled', 'rejected', 'returned'];

const nameOf = (u: string | User | null | undefined) => (u && typeof u === 'object' ? u.name : null);

// Orders my store is the hub of or supplies items to. Pickers and delivery partners are assigned
// automatically (or by the Grovio admin); here the vendor follows progress and can cancel or take
// back a failed delivery.
export default function OrdersPage() {
  const { page, pageSize, onChange } = usePageState();
  const [status, setStatus] = useState<string | undefined>();
  const [detailId, setDetailId] = useState<string | null>(null);
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

  const invalidateDetail = () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['order-detail', detailId] });
  };

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => cancelOrder(detailId as string, reason),
    onSuccess: () => {
      message.success('Order cancelled');
      setCancelOpen(false);
      cancelForm.resetFields();
      invalidateDetail();
    },
    onError: (err) => message.error(apiErrorMessage(err, 'Could not cancel order')),
  });

  const returnMutation = useMutation({
    mutationFn: (reason: string) => markOrderReturned(detailId as string, reason),
    onSuccess: () => {
      message.success('Order marked as returned');
      setReturnOpen(false);
      returnForm.resetFields();
      invalidateDetail();
    },
    onError: (err) => message.error(apiErrorMessage(err, 'Could not mark order as returned')),
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
        scroll={{ x: 760 }}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        onRow={(r) => ({ onClick: () => setDetailId(r._id), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Order #', dataIndex: 'orderNumber' },
          { title: 'Customer', render: (_, r) => nameOf(r.customer) || '—' },
          { title: 'Items', render: (_, r) => r.items.length },
          { title: 'Total', render: (_, r) => formatCurrency(r.grandTotal) },
          { title: 'Payment', render: (_, r) => <StatusTag status={r.paymentStatus} /> },
          { title: 'Status', render: (_, r) => <StatusTag status={r.orderStatus} /> },
          { title: 'Placed', render: (_, r) => formatDateTime(r.placedAt) },
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
              <Descriptions.Item label="Customer">{nameOf(order.customer) || '—'}</Descriptions.Item>
              <Descriptions.Item label="Item Total">{formatCurrency(order.itemTotal)}</Descriptions.Item>
              <Descriptions.Item label="Discount">{formatCurrency(order.discount)}</Descriptions.Item>
              <Descriptions.Item label="Grand Total">{formatCurrency(order.grandTotal)}</Descriptions.Item>
              <Descriptions.Item label="Delivery partner">{nameOf(order.delivery) || 'Not assigned yet'}</Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5}>Items</Typography.Title>
            <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
              {order.items.map((item) => (
                <div key={item._id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    {item.isAvailable === false ? '❌ ' : item.pickedQty != null ? '✅ ' : '⬜ '}
                    {item.nameSnapshot} × {item.qty}
                  </span>
                  <span>{formatCurrency(item.price * item.qty)}</span>
                </div>
              ))}
            </Space>

            <Typography.Title level={5}>Pickers</Typography.Title>
            <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
              {order.pickTasks.length === 0 && <Typography.Text type="secondary">No pickers assigned yet.</Typography.Text>}
              {order.pickTasks.map((task) => (
                <div key={task._id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{nameOf(task.picker) || 'Picker'}</span>
                  <StatusTag status={task.status} />
                </div>
              ))}
            </Space>

            <Space style={{ marginBottom: 16 }} wrap>
              <Button danger disabled={NON_CANCELLABLE_STATUSES.includes(order.orderStatus)} onClick={() => setCancelOpen(true)}>
                Cancel Order
              </Button>
              <Button disabled={order.orderStatus !== 'delivery_failed'} onClick={() => setReturnOpen(true)}>
                Mark as Returned
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
