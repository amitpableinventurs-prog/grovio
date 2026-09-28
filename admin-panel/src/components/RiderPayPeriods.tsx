import { App as AntApp, Button, Card, Empty, Input, Modal, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRiderPayPeriods, releasePayPeriod, withholdPayPeriod, type LivePeriod, type PayPeriodRow, type PayoutStatus } from '../api/riderPay';

// Delivery partner drawer: today's and this week's incentive progress, settled days / weeks with
// eligibility and payout status, and withhold / release (backend services/riderPay.service.js).

const money = (n?: number | null) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const STATUS: Record<PayoutStatus, { color: string; label: string }> = {
  pending: { color: 'default', label: 'Not settled' },
  settling: { color: 'processing', label: 'Settling' },
  paid: { color: 'green', label: 'Paid' },
  nothing_due: { color: 'default', label: 'Nothing due' },
  not_eligible: { color: 'red', label: 'Not eligible' },
  withheld: { color: 'orange', label: 'Withheld' },
};
const statusTag = (s: PayoutStatus) => <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag>;

export default function RiderPayPeriods({ riderId }: { riderId: string }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [withholding, setWithholding] = useState<{ kind: 'day' | 'week'; key: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['rider-pay-periods', riderId], queryFn: () => fetchRiderPayPeriods(riderId) });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rider-pay-periods', riderId] });
  const onError = (err: any) => message.error(err?.response?.data?.message || 'Something went wrong');
  const withhold = useMutation({
    mutationFn: () => withholdPayPeriod(riderId, withholding!.kind, withholding!.key, reason),
    onSuccess: () => { message.success('Incentives withheld'); setWithholding(null); setReason(''); refresh(); },
    onError,
  });
  const release = useMutation({
    mutationFn: (p: { kind: 'day' | 'week'; key: string }) => releasePayPeriod(riderId, p.kind, p.key),
    onSuccess: () => { message.success('Released'); refresh(); },
    onError,
  });

  const actions = (p: { kind: 'day' | 'week'; key: string; label: string; payoutStatus: PayoutStatus }) => (
    <>
      {p.payoutStatus === 'pending' && <Button size="small" onClick={() => setWithholding(p)}>Withhold</Button>}
      {p.payoutStatus === 'withheld' && <Button size="small" onClick={() => release.mutate(p)} loading={release.isPending}>Release</Button>}
    </>
  );

  const liveCard = (p: LivePeriod | null, title: string) => p && (
    <Card size="small" title={`${title} · ${p.label}`} extra={<Space>{statusTag(p.payoutStatus)}{actions(p)}</Space>} style={{ flex: 1, minWidth: 230 }}>
      <div><b>{p.deliveries}</b> deliveries{p.tier ? <> · <Tag color="gold">{p.tier}</Tag></> : null}</div>
      <div>Order pay {money(p.orderEarnings)} · incentives {money(p.incentives)}{p.estimate ? ' (estimate)' : ''}</div>
      {p.nextSlab && <Typography.Text type="secondary">{p.nextSlab.deliveriesToGo} more for {money(p.nextSlab.amount)}{p.nextSlab.tier ? ` (${p.nextSlab.tier})` : ''}</Typography.Text>}
      {p.guarantee?.enabled && <div>Guarantee {money(p.guarantee.amount)}: {p.guarantee.eligible ? `top-up ${money(p.guarantee.topUp)}` : 'not met'}</div>}
      <div>Cancellation rate {p.cancellationRatePct}%</div>
      {!p.eligibility.eligible && <Typography.Text type="danger">{p.eligibility.reasons.join('; ')}</Typography.Text>}
      {p.withheld?.reason && <Typography.Text type="warning">Withheld: {p.withheld.reason}</Typography.Text>}
    </Card>
  );

  return (
    <div style={{ marginTop: 24 }}>
      <Typography.Title level={5}>Pay & incentives</Typography.Title>
      <Space align="start" wrap style={{ width: '100%', marginBottom: 12 }}>
        {liveCard(data?.live.day ?? null, 'Today')}
        {liveCard(data?.live.week ?? null, 'This week')}
      </Space>
      <Table<PayPeriodRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={data?.periods}
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No settled days or weeks yet" /> }}
        columns={[
          { title: 'Period', render: (_, r) => <>{r.kind === 'week' ? 'Week ' : ''}{r.label}</> },
          { title: 'Deliveries', dataIndex: 'deliveries', render: (v) => v ?? '—' },
          {
            title: 'Incentives',
            render: (_, r) => (
              <Tooltip title={r.lines.filter((l) => l.amount > 0).map((l) => `${l.label}: ${money(l.amount)}`).join(' · ') || 'None'}>
                {money(r.total)}
              </Tooltip>
            ),
          },
          {
            title: 'Status',
            render: (_, r) => (
              <Tooltip title={[r.withheld?.reason && `Withheld: ${r.withheld.reason}`, ...(r.eligibility?.reasons || []), ...r.audit.map((a) => `${new Date(a.at).toLocaleString('en-IN')} ${a.action}${a.note ? `: ${a.note}` : ''}`)].filter(Boolean).join('\n')}>
                {statusTag(r.payoutStatus)}
              </Tooltip>
            ),
          },
          { title: '', render: (_, r) => actions(r) },
        ]}
      />
      <Modal
        title={`Withhold incentives — ${withholding?.kind === 'week' ? 'week of ' : ''}${withholding?.label || ''}`}
        open={!!withholding}
        onCancel={() => setWithholding(null)}
        onOk={() => withhold.mutate()}
        okText="Withhold"
        okButtonProps={{ disabled: !reason.trim(), loading: withhold.isPending }}
      >
        <Typography.Paragraph type="secondary">
          Daily / weekly incentives and the guarantee top-up for this period won't be paid until released. Order pay isn't affected.
        </Typography.Paragraph>
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. GPS mismatch under review, verified complaint #812" />
      </Modal>
    </div>
  );
}
