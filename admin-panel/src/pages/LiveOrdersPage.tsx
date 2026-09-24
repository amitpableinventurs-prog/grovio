import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Radio,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  App as AntApp,
} from 'antd';
import { SoundOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { acceptOrder, rejectOrder, fetchOrderSettings, updateOrderSettings } from '../api/orders';
import { useIncomingOrders } from '../hooks/useIncomingOrders';
import { useSocketConnected } from '../realtime/socket';
import { setOrderSoundEnabled, useOrderSoundEnabled } from '../realtime/newOrderSound';
import { useAuthStore } from '../store/authStore';
import { hasPermission, PERMISSIONS } from '../utils/permissions';
import { formatCurrency } from '../utils/format';
import type { Order, Store, User } from '../types';
import { ConfirmationTag } from '../components/OrderLiveTracking';

// How long an order can wait before its card is flagged — amber, then red.
const WAIT_WARN_MS = 3 * 60_000;
const WAIT_LATE_MS = 8 * 60_000;
const MAX_ITEMS_SHOWN = 6;

const REJECT_REASONS = ['Items out of stock', 'Store is closing', 'Address not serviceable', 'Other'];

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatWait(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
}

function paymentTag(order: Order) {
  if (order.paymentMethod === 'COD') return <Tag>Cash on delivery</Tag>;
  if (order.paymentStatus === 'paid') return <Tag color="green">{order.paymentMethod === 'WALLET' ? 'Paid · Wallet' : 'Paid online'}</Tag>;
  if (order.paymentStatus === 'failed') return <Tag color="red">Payment failed</Tag>;
  return <Tag color="gold">Awaiting payment</Tag>;
}

const ONLINE_METHODS = ['RAZORPAY', 'PAYU', 'PHONEPE'];
const awaitingOnlinePayment = (order: Order) => ONLINE_METHODS.includes(order.paymentMethod) && order.paymentStatus !== 'paid';

function BillLine({ label, value, negative }: { label: string; value?: number; negative?: boolean }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text style={{ fontVariantNumeric: 'tabular-nums' }}>
        {negative ? '−' : ''}{formatCurrency(value)}
      </Typography.Text>
    </div>
  );
}

function OrderCard({
  order,
  now,
  onAccept,
  onReject,
  accepting,
}: {
  order: Order;
  now: number;
  onAccept: () => void;
  onReject: () => void;
  accepting: boolean;
}) {
  const waitedMs = now - new Date(order.createdAt).getTime();
  const urgency = waitedMs >= WAIT_LATE_MS ? 'late' : waitedMs >= WAIT_WARN_MS ? 'warn' : 'ok';
  const borderColor = urgency === 'late' ? '#dc2626' : urgency === 'warn' ? '#d97706' : undefined;
  const customer = typeof order.customer === 'object' ? (order.customer as User) : null;
  const store = typeof order.store === 'object' ? (order.store as Store) : null;
  const itemCount = order.items.reduce((sum, i) => sum + i.qty, 0);
  const blocked = awaitingOnlinePayment(order);

  return (
    <Card
      size="small"
      style={{ borderColor, borderWidth: borderColor ? 2 : 1 }}
      title={
        <Space size={8} wrap>
          <Typography.Text strong>{order.orderNumber}</Typography.Text>
          {paymentTag(order)}
          <ConfirmationTag value={order.ivrConfirmation} />
        </Space>
      }
      extra={
        <Tooltip title={`Placed ${new Date(order.createdAt).toLocaleTimeString('en-IN')}`}>
          <Typography.Text type={urgency === 'ok' ? 'secondary' : urgency === 'warn' ? 'warning' : 'danger'} style={{ fontVariantNumeric: 'tabular-nums' }}>
            <ClockCircleOutlined /> {formatWait(waitedMs)}
          </Typography.Text>
        </Tooltip>
      }
      actions={[
        <Tooltip key="accept" title={blocked ? 'Waiting for the customer to finish paying online' : undefined}>
          <Button type="primary" block onClick={onAccept} loading={accepting} disabled={blocked} style={{ width: 'calc(100% - 24px)' }}>
            Accept
          </Button>
        </Tooltip>,
        <Button key="reject" danger block onClick={onReject} style={{ width: 'calc(100% - 24px)' }}>
          Reject
        </Button>,
      ]}
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div>
          <Typography.Text strong>{customer?.name ?? 'Customer'}</Typography.Text>
          {customer?.phone && <Typography.Text type="secondary"> · {customer.phone}</Typography.Text>}
          {store && <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Hub: {store.name}</Typography.Text>}
        </div>

        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </Typography.Text>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {order.items.slice(0, MAX_ITEMS_SHOWN).map((item) => (
              <li key={item._id}>
                <Typography.Text>{item.qty} × {item.nameSnapshot}</Typography.Text>
              </li>
            ))}
          </ul>
          {order.items.length > MAX_ITEMS_SHOWN && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>+{order.items.length - MAX_ITEMS_SHOWN} more</Typography.Text>
          )}
        </div>

        <div style={{ display: 'grid', gap: 2, fontSize: 13 }}>
          <BillLine label="Items" value={order.itemTotal} />
          <BillLine label="Delivery" value={order.deliveryFee} />
          <BillLine label="Handling" value={order.handlingCharge} />
          <BillLine label="Packing" value={order.packingCharge} />
          <BillLine label={order.surchargeLabel || 'Surcharge'} value={order.surcharge} />
          <BillLine label="Discount" value={order.discount} negative />
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 4, marginTop: 2 }}>
            <Typography.Text strong>Total</Typography.Text>
            <Typography.Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(order.grandTotal)}</Typography.Text>
          </div>
        </div>
      </Space>
    </Card>
  );
}

export default function LiveOrdersPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canToggleAutoAccept = hasPermission(user?.permissions, PERMISSIONS.MANAGE_ORDERS);
  const live = useSocketConnected();
  const soundOn = useOrderSoundEnabled();
  const now = useNow(1000);
  const [rejecting, setRejecting] = useState<Order | null>(null);
  const [rejectForm] = Form.useForm<{ reason: string; note?: string }>();
  const rejectReason = Form.useWatch('reason', rejectForm);

  const { data: orders = [], isLoading } = useIncomingOrders();
  const { data: orderSettings } = useQuery({ queryKey: ['order-settings'], queryFn: fetchOrderSettings });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['orders'] });

  const acceptMutation = useMutation({
    mutationFn: (order: Order) => acceptOrder(order._id),
    onSuccess: (order) => {
      message.success(`${order.orderNumber} accepted`);
      refresh();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not accept the order'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ order, reason }: { order: Order; reason: string }) => rejectOrder(order._id, reason),
    onSuccess: (order) => {
      message.success(
        order.paymentStatus === 'refunded'
          ? `${order.orderNumber} rejected — ${formatCurrency(order.grandTotal)} refunded to the customer's wallet`
          : `${order.orderNumber} rejected`,
      );
      setRejecting(null);
      refresh();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not reject the order'),
  });

  const autoAcceptMutation = useMutation({
    mutationFn: updateOrderSettings,
    onSuccess: (data) => {
      message.success(data.autoAcceptOrders ? 'Auto-accept on — new orders go straight to pickers' : 'Auto-accept off — new orders wait here');
      queryClient.setQueryData(['order-settings'], data);
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not change auto-accept'),
  });

  const openReject = (order: Order) => {
    rejectForm.setFieldsValue({ reason: REJECT_REASONS[0], note: '' });
    setRejecting(order);
  };

  const submitReject = async () => {
    if (!rejecting) return;
    const { reason, note } = await rejectForm.validateFields();
    const text = reason === 'Other' ? (note ?? '').trim() : note?.trim() ? `${reason} — ${note.trim()}` : reason;
    rejectMutation.mutate({ order: rejecting, reason: text });
  };

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 16 }} align="center">
        <Space align="center" size={12}>
          <Typography.Title level={3} style={{ margin: 0 }}>Live Orders</Typography.Title>
          <Badge count={orders.length} showZero color={orders.length ? '#dc2626' : '#9ca3af'} />
          <Badge status={live ? 'processing' : 'default'} text={live ? 'Live' : 'Reconnecting…'} />
        </Space>
        <Space size="large" wrap>
          <Space>
            <SoundOutlined />
            <Typography.Text>Sound</Typography.Text>
            <Switch checked={soundOn} onChange={setOrderSoundEnabled} size="small" />
          </Space>
          {orderSettings && (
            <Tooltip title={canToggleAutoAccept ? undefined : 'Only order managers can change this'}>
              <Space>
                <Typography.Text>Auto-accept</Typography.Text>
                <Switch
                  checked={orderSettings.autoAcceptOrders}
                  disabled={!canToggleAutoAccept}
                  loading={autoAcceptMutation.isPending}
                  onChange={(checked) => autoAcceptMutation.mutate(checked)}
                  size="small"
                />
              </Space>
            </Tooltip>
          )}
        </Space>
      </Space>

      {orderSettings?.autoAcceptOrders && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Auto-accept is on"
          description="New orders are accepted and sent to pickers automatically, so they won't wait here. Turn auto-accept off to review each order first."
        />
      )}

      {isLoading ? (
        <Card loading />
      ) : orders.length === 0 ? (
        <Card>
          <Empty description="No orders waiting. New orders appear here the moment they're placed." />
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
          {orders.map((order) => (
            <OrderCard
              key={order._id}
              order={order}
              now={now}
              accepting={acceptMutation.isPending && acceptMutation.variables?._id === order._id}
              onAccept={() => acceptMutation.mutate(order)}
              onReject={() => openReject(order)}
            />
          ))}
        </div>
      )}

      <Modal
        title={rejecting ? `Reject ${rejecting.orderNumber}?` : 'Reject order'}
        open={!!rejecting}
        onCancel={() => setRejecting(null)}
        onOk={submitReject}
        okText="Reject order"
        okButtonProps={{ danger: true, loading: rejectMutation.isPending }}
        destroyOnHidden
      >
        {rejecting?.paymentStatus === 'paid' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={`This order is paid — ${formatCurrency(rejecting.grandTotal)} will be refunded to the customer's wallet.`}
          />
        )}
        <Form form={rejectForm} layout="vertical">
          <Form.Item name="reason" label="Reason (the customer sees this)">
            <Radio.Group>
              <Space direction="vertical">
                {REJECT_REASONS.map((r) => <Radio key={r} value={r}>{r}</Radio>)}
              </Space>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            name="note"
            label={rejectReason === 'Other' ? 'Describe the reason' : 'Add a note (optional)'}
            rules={rejectReason === 'Other' ? [{ required: true, whitespace: true, message: 'Tell the customer why the order was rejected' }] : []}
          >
            <Input.TextArea rows={2} maxLength={200} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
