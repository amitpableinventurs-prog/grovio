import { useEffect, useState } from 'react';
import { Button, Card, Col, Drawer, Form, Input, InputNumber, Modal, Row, Segmented, Space, Statistic, Table, Tag, Tooltip, Typography, App as AntApp } from 'antd';
import { HistoryOutlined, InfoCircleOutlined, MoneyCollectOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchCashCollection, fetchCashLedger, recordCashDeposit, type CashLedgerEntry, type CashPosition } from '../api/cash';
import { usePageState } from '../hooks/usePageState';
import { useAuthStore } from '../store/authStore';
import { hasPermission, PERMISSIONS } from '../utils/permissions';
import { formatCurrency, formatDateTime } from '../utils/format';

// COD cash that delivery partners collect at the door is the platform's money in their hands. It
// comes off their pocket when they collect it and goes back when they hand it in at the hub, which
// is recorded here with "Receive cash".

type Rider = CashPosition['rider'];

function ReceiveCashModal({ position, onClose }: { position: CashPosition | null; onClose: () => void }) {
  const [form] = Form.useForm<{ amount: number; reference?: string }>();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const due = position?.cashToDeposit ?? 0;

  // Opening for a partner starts at the full amount they owe.
  useEffect(() => {
    if (position) form.setFieldsValue({ amount: position.cashToDeposit, reference: undefined });
  }, [position, form]);

  const mutation = useMutation({
    mutationFn: (values: { amount: number; reference?: string }) =>
      recordCashDeposit(position!.rider._id, { amount: values.amount, reference: values.reference?.trim() || null }),
    onSuccess: (_, values) => {
      message.success(`${formatCurrency(values.amount)} received from ${position!.rider.name}`);
      queryClient.invalidateQueries({ queryKey: ['cash-collection'] });
      queryClient.invalidateQueries({ queryKey: ['cash-ledger', position!.rider._id] });
      onClose();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not record the deposit'),
  });

  return (
    <Modal
      title={position ? `Receive cash from ${position.rider.name}` : 'Receive cash'}
      open={!!position}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Mark received"
      confirmLoading={mutation.isPending}
      forceRender
    >
      <Typography.Paragraph type="secondary">
        Count the cash first. The amount is added back to the partner's pocket and shows as a Cash Deposit in their app.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
        <Form.Item
          name="amount"
          label="Amount received (₹)"
          extra={`Due: ${formatCurrency(due)}`}
          rules={[
            { required: true, message: 'Enter the amount received' },
            { type: 'number', min: 1, max: due, message: `Between ₹1 and ${formatCurrency(due)}` },
          ]}
        >
          <InputNumber style={{ width: '100%' }} min={1} max={due} precision={2} prefix="₹" autoFocus />
        </Form.Item>
        <Form.Item name="reference" label="Receipt / reference no." extra="Optional — shown to the partner as the Transaction ID" style={{ marginBottom: 0 }}>
          <Input maxLength={60} placeholder="e.g. HUB-0425" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function CashHistoryDrawer({ rider, onClose }: { rider: Rider | null; onClose: () => void }) {
  const { page, pageSize, onChange } = usePageState(20);
  const { data, isLoading } = useQuery({
    queryKey: ['cash-ledger', rider?._id, page, pageSize],
    queryFn: () => fetchCashLedger(rider!._id, { page, limit: pageSize }),
    enabled: !!rider,
  });

  return (
    <Drawer title={rider ? `Cash history · ${rider.name}` : 'Cash history'} open={!!rider} onClose={onClose} size="large">
      <Table<CashLedgerEntry>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange }}
        locale={{ emptyText: 'No cash collected or deposited yet' }}
        columns={[
          { title: 'When', render: (_, e) => <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.at)}</span> },
          {
            title: 'Entry',
            render: (_, e) => (
              <div>
                <Typography.Text>{e.title}</Typography.Text>
                {e.subtitle && <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{e.subtitle}</Typography.Text></div>}
              </div>
            ),
          },
          {
            title: 'Amount',
            align: 'right',
            render: (_, e) => (
              <Typography.Text type={e.amount < 0 ? 'danger' : 'success'} style={{ whiteSpace: 'nowrap' }}>
                {e.amount < 0 ? '−' : '+'}{formatCurrency(Math.abs(e.amount))}
              </Typography.Text>
            ),
          },
        ]}
      />
    </Drawer>
  );
}

export default function CashCollectionPage() {
  const { page, pageSize, setPage, onChange } = usePageState();
  const [holding, setHolding] = useState(true);
  const [search, setSearch] = useState('');
  const [receiving, setReceiving] = useState<CashPosition | null>(null);
  const [historyFor, setHistoryFor] = useState<Rider | null>(null);
  const canReceive = hasPermission(useAuthStore((s) => s.user?.permissions) || [], PERMISSIONS.MANAGE_DELIVERY);

  const { data, isLoading } = useQuery({
    queryKey: ['cash-collection', page, pageSize, holding, search],
    queryFn: () => fetchCashCollection({ page, limit: pageSize, search: search || undefined, holding: holding ? 'true' : undefined }),
  });
  const totals = data?.totals;

  return (
    <div>
      <Typography.Title level={3} style={{ marginBottom: 4 }}>Cash Collection</Typography.Title>
      <Typography.Paragraph type="secondary">
        Cash-on-delivery money delivery partners collect at the door, and what they've handed in at the hub.
      </Typography.Paragraph>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} lg={6}>
          <Card loading={isLoading && !totals}>
            <Statistic title="Cash with partners" value={formatCurrency(totals?.cashWithRiders)} styles={{ content: { color: totals?.cashWithRiders ? '#cf1322' : undefined } }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={isLoading && !totals}>
            <Statistic title="Partners holding cash" value={totals?.ridersHolding ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={isLoading && !totals}>
            <Statistic title="Collected today" value={formatCurrency(totals?.collectedToday)} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={isLoading && !totals}>
            <Statistic title="Received today" value={formatCurrency(totals?.depositedToday)} />
          </Card>
        </Col>
      </Row>

      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <Segmented
          value={holding ? 'holding' : 'all'}
          onChange={(v) => {
            setHolding(v === 'holding');
            setPage(1);
          }}
          options={[
            { value: 'holding', label: 'Holding cash' },
            { value: 'all', label: 'All partners' },
          ]}
        />
        <Input.Search
          allowClear
          placeholder="Search name or phone"
          prefix={<SearchOutlined />}
          style={{ width: 280 }}
          onSearch={(v) => {
            setSearch(v.trim());
            setPage(1);
          }}
        />
      </div>

      <Table<CashPosition>
        rowKey={(r) => r.rider._id}
        loading={isLoading}
        dataSource={data?.items}
        scroll={{ x: 'max-content' }}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        locale={{ emptyText: holding ? 'No delivery partner is holding cash right now' : 'No delivery partners found' }}
        columns={[
          {
            title: 'Delivery partner',
            render: (_, r) => (
              <div style={{ whiteSpace: 'nowrap' }}>
                <Typography.Text strong>{r.rider.name}</Typography.Text>
                {r.rider.isActive === false && <Tag style={{ marginLeft: 8 }}>Inactive</Tag>}
                <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.rider.phone || '—'}</Typography.Text></div>
              </div>
            ),
          },
          {
            title: (
              <Space size={4}>
                To deposit
                <Tooltip title="Cash collected minus cash handed in, less any earnings already in the partner's pocket — the same amount their app asks them to deposit.">
                  <InfoCircleOutlined />
                </Tooltip>
              </Space>
            ),
            align: 'right',
            render: (_, r) =>
              r.cashToDeposit > 0 ? (
                <Typography.Text strong type="danger" style={{ whiteSpace: 'nowrap' }}>{formatCurrency(r.cashToDeposit)}</Typography.Text>
              ) : (
                <Tag color="green">Settled</Tag>
              ),
          },
          { title: 'Cash collected', align: 'right', render: (_, r) => <span style={{ whiteSpace: 'nowrap' }}>{formatCurrency(r.cashCollected)}</span> },
          { title: 'Handed in', align: 'right', render: (_, r) => <span style={{ whiteSpace: 'nowrap' }}>{formatCurrency(r.deposited)}</span> },
          { title: 'Last collected', render: (_, r) => <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.lastCollectedAt)}</span> },
          { title: 'Last handed in', render: (_, r) => <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.lastDepositAt)}</span> },
          {
            title: 'Actions',
            align: 'right',
            render: (_, r) => (
              <Space size={8} style={{ whiteSpace: 'nowrap' }}>
                {canReceive && (
                  <Button size="small" type="primary" icon={<MoneyCollectOutlined />} disabled={r.cashToDeposit <= 0} onClick={() => setReceiving(r)}>
                    Receive cash
                  </Button>
                )}
                <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistoryFor(r.rider)}>
                  History
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <ReceiveCashModal position={receiving} onClose={() => setReceiving(null)} />
      <CashHistoryDrawer key={historyFor?._id} rider={historyFor} onClose={() => setHistoryFor(null)} />
    </div>
  );
}
