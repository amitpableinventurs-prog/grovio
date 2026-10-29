import { useMemo, useState } from 'react';
import {
  App as AntApp, Button, DatePicker, Divider, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space,
  Table, Tag, TimePicker, Tooltip, Typography,
} from 'antd';
import { DeleteOutlined, LockOutlined, PlusOutlined, TeamOutlined, UnlockOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import {
  cancelOffer, createOffer, fetchOffer, fetchOfferRiders, fetchOffers, settleOffer, updateOffer,
  type IncentiveOffer, type OfferConditions, type OfferInput, type OfferRider, type OfferRiderProgress, type OfferStatus, type OfferTier,
} from '../api/offers';
import { fetchUsersByRole } from '../api/users';

// Delivery partner incentive offers (backend services/offer.service.js). Each tier is locked until
// a partner meets all of its requirements (earnings, orders, gigs) inside the offer window; when
// the offer ends they're paid the highest unlocked tier, unless they broke a "Don't do" condition.

const STATUS_COLORS: Record<OfferStatus, string> = { live: 'green', upcoming: 'blue', expired: 'default', cancelled: 'red' };
const PROGRESS_STATUS: Record<OfferRiderProgress['status'], { color: string; label: string }> = {
  in_progress: { color: 'blue', label: 'In progress' },
  disqualified: { color: 'red', label: 'Disqualified' },
  paid: { color: 'green', label: 'Paid' },
  not_achieved: { color: 'default', label: 'Nothing unlocked' },
};
const REQUIREMENTS = [
  { key: 'minEarnings', label: 'Earnings', format: (v: number) => rupees(v) },
  { key: 'minOrders', label: 'Orders', format: (v: number) => String(v) },
  { key: 'minGigs', label: 'Gigs', format: (v: number) => String(v) },
] as const;
const CONDITION_FIELDS = [
  { name: 'maxOrderDenials', label: 'Max order denials' },
  { name: 'maxCancellations', label: 'Max cancellations' },
  { name: 'maxIncompleteGigs', label: 'Max incomplete gigs' },
] as const;

const rupees = (n?: number | null) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const has = (v?: number | null) => v !== null && v !== undefined;
const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const errMsg = (err: any, fallback: string) => err?.response?.data?.errors?.[0]?.message || err?.response?.data?.message || fallback;
const riderLabel = (r: OfferRider) => `${r.name}${r.phone ? ` · ${r.phone}` : ''}`;

interface FormValues {
  title: string;
  description?: string;
  when: [Dayjs, Dayjs];
  riders?: string[];
  tiers: OfferTier[];
  conditions?: OfferConditions;
  compulsoryLogin?: { from: Dayjs; to: Dayjs; minMinutes: number }[];
  videoUrl?: string;
}

function toInput(v: FormValues): OfferInput {
  return {
    title: v.title.trim(),
    description: v.description?.trim() || null,
    startAt: v.when[0].toISOString(),
    endAt: v.when[1].toISOString(),
    riders: v.riders || [],
    tiers: (v.tiers || []).map((t) => ({
      incentive: Number(t.incentive),
      minEarnings: numOrNull(t.minEarnings),
      minOrders: numOrNull(t.minOrders),
      minGigs: numOrNull(t.minGigs),
    })),
    conditions: Object.fromEntries(CONDITION_FIELDS.map((c) => [c.name, numOrNull(v.conditions?.[c.name])])),
    compulsoryLogin: (v.compulsoryLogin || []).map((w) => ({ from: w.from.format('HH:mm'), to: w.to.format('HH:mm'), minMinutes: Number(w.minMinutes) })),
    videoUrl: v.videoUrl?.trim() || null,
  };
}

function toFormValues(o: IncentiveOffer): FormValues {
  return {
    title: o.title,
    description: o.description || undefined,
    when: [dayjs(o.startAt), dayjs(o.endAt)],
    riders: o.riders.map((r) => (typeof r === 'string' ? r : r._id)),
    tiers: o.tiers.map((t) => ({ incentive: t.incentive, minEarnings: t.minEarnings, minOrders: t.minOrders, minGigs: t.minGigs })),
    conditions: o.conditions,
    compulsoryLogin: o.compulsoryLogin.map((w) => ({ from: dayjs(w.from, 'HH:mm'), to: dayjs(w.to, 'HH:mm'), minMinutes: w.minMinutes })),
    videoUrl: o.videoUrl || undefined,
  };
}

// The tier table as partners see it in the app: incentive on top, what unlocks it underneath.
// With `locks` it also shows each tier's lock state.
function TierLadder({ tiers, locks }: { tiers: OfferTier[]; locks?: boolean[] }) {
  const rows = REQUIREMENTS.filter((r) => tiers.some((t) => has(t[r.key])));
  const grid = { display: 'grid', gridTemplateColumns: `76px repeat(${tiers.length}, minmax(52px, 1fr))`, alignItems: 'center', columnGap: 8 };
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ ...grid, background: '#f5f5f5', borderRadius: 6, padding: '4px 6px' }}>
        <Typography.Text type="secondary">Incentive</Typography.Text>
        {tiers.map((t, i) => <Typography.Text key={i} strong>{rupees(t.incentive)}</Typography.Text>)}
      </div>
      {locks && (
        <div style={{ ...grid, padding: '2px 6px' }}>
          <span />
          {locks.map((locked, i) => (
            <span key={i} style={{ color: locked ? '#9ca3af' : '#16a34a' }}>{locked ? <LockOutlined /> : <UnlockOutlined />}</span>
          ))}
        </div>
      )}
      {rows.map((r) => (
        <div key={r.key} style={{ ...grid, padding: '2px 6px' }}>
          <Typography.Text type="secondary">{r.label}</Typography.Text>
          {tiers.map((t, i) => <span key={i}>{has(t[r.key]) ? r.format(t[r.key] as number) : '—'}</span>)}
        </div>
      ))}
    </div>
  );
}

export default function OffersPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<OfferStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<IncentiveOffer | 'new' | null>(null);
  const [editRiders, setEditRiders] = useState<OfferRider[]>([]);
  const [progressFor, setProgressFor] = useState<IncentiveOffer | null>(null);
  const [form] = Form.useForm<FormValues>();
  const previewTiers = (Form.useWatch('tiers', form) || []).filter((t) => t && t.incentive);

  const { data, isLoading } = useQuery({
    queryKey: ['offers', status, page],
    queryFn: () => fetchOffers({ status: status === 'all' ? undefined : status, page, limit: 20 }),
  });
  const { data: partners } = useQuery({ queryKey: ['delivery-partners', 'offer-picker'], queryFn: () => fetchUsersByRole<OfferRider>('delivery', { limit: 100 }) });
  const { data: progress, isLoading: progressLoading } = useQuery({
    queryKey: ['offer-riders', progressFor?._id],
    queryFn: () => fetchOfferRiders(progressFor!._id),
    enabled: !!progressFor,
  });

  // Partners for the "Who" picker, plus anyone already on the offer being edited.
  const riderOptions = useMemo(() => {
    const byId = new Map<string, OfferRider>();
    [...editRiders, ...(partners?.items || [])].forEach((r) => byId.set(r._id, r));
    return [...byId.values()].map((r) => ({ value: r._id, label: riderLabel(r) }));
  }, [partners, editRiders]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['offers'] });
  const saveMutation = useMutation({
    mutationFn: (body: OfferInput) => (editing && editing !== 'new' ? updateOffer(editing._id, body) : createOffer(body)),
    onSuccess: () => { message.success(editing === 'new' ? 'Offer created' : 'Offer updated'); setEditing(null); refresh(); },
    onError: (err) => message.error(errMsg(err, 'Could not save the offer')),
  });
  const cancelMutation = useMutation({
    mutationFn: cancelOffer,
    onSuccess: () => { message.success('Offer cancelled — nobody will be paid for it'); refresh(); },
    onError: (err) => message.error(errMsg(err, 'Could not cancel the offer')),
  });
  const settleMutation = useMutation({
    mutationFn: settleOffer,
    onSuccess: (res) => {
      message.success(`Paid ${res.paid} of ${res.riders} partners ${rupees(res.total)}`);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['offer-riders'] });
    },
    onError: (err) => message.error(errMsg(err, 'Could not pay out the offer')),
  });

  function openCreate() {
    const start = dayjs().add(1, 'day').hour(4).minute(0).second(0).millisecond(0);
    form.resetFields();
    form.setFieldsValue({ when: [start, start.add(1, 'day')], riders: [], tiers: [{ incentive: undefined as unknown as number, minEarnings: undefined }], compulsoryLogin: [] });
    setEditRiders([]);
    setEditing('new');
  }

  async function openEdit(o: IncentiveOffer) {
    try {
      const full = await queryClient.fetchQuery({ queryKey: ['offer', o._id], queryFn: () => fetchOffer(o._id) });
      form.resetFields();
      form.setFieldsValue(toFormValues(full));
      setEditRiders(full.riders.filter((r): r is OfferRider => typeof r !== 'string'));
      setEditing(full);
    } catch (err) {
      message.error(errMsg(err, 'Could not load the offer'));
    }
  }

  const editable = (o: IncentiveOffer) => o.status !== 'cancelled' && !o.settledAt;

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Incentive Offers</Typography.Title>
          <Typography.Text type="secondary">
            Extra pay for delivery partners. Each tier stays locked until a partner reaches its earnings / orders / gigs; when the offer ends they're paid the highest unlocked tier.
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>New offer</Button>
      </Space>

      <Segmented<OfferStatus | 'all'>
        style={{ marginBottom: 16 }}
        value={status}
        onChange={(v) => { setStatus(v); setPage(1); }}
        options={[
          { value: 'all', label: 'All' }, { value: 'live', label: 'Live' }, { value: 'upcoming', label: 'Upcoming' },
          { value: 'expired', label: 'Expired' }, { value: 'cancelled', label: 'Cancelled' },
        ]}
      />

      <Table<IncentiveOffer>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items || []}
        pagination={{ current: page, pageSize: 20, total: data?.meta.totalItems || 0, onChange: setPage, showSizeChanger: false }}
        locale={{ emptyText: <Empty description="No offers"><Button type="primary" onClick={openCreate}>New offer</Button></Empty> }}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: 'Offer',
            render: (_, o) => (
              <Space orientation="vertical" size={0}>
                <Typography.Text strong delete={o.status === 'cancelled'}>{o.title}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{o.spanLabel}</Typography.Text>
              </Space>
            ),
          },
          {
            title: 'Status',
            render: (_, o) => (
              <Space size={4} wrap>
                <Tag color={STATUS_COLORS[o.status]}>{o.status[0].toUpperCase() + o.status.slice(1)}</Tag>
                {o.settledAt && <Tooltip title={`Paid out ${dayjs(o.settledAt).format('D MMM, h:mm a')}`}><Tag color="purple">Paid out</Tag></Tooltip>}
              </Space>
            ),
          },
          { title: 'Tiers', render: (_, o) => <div style={{ minWidth: 260 }}><TierLadder tiers={o.tiers} /></div> },
          { title: 'Extra', render: (_, o) => <Typography.Text strong>{rupees(o.maxIncentive)}</Typography.Text> },
          { title: 'Who', render: (_, o) => (o.riders.length ? `${o.riders.length} partner${o.riders.length === 1 ? '' : 's'}` : 'Everyone') },
          {
            title: 'Actions',
            render: (_, o) => (
              <Space wrap>
                <Button size="small" icon={<TeamOutlined />} onClick={() => setProgressFor(o)}>Progress</Button>
                {editable(o) && <Button size="small" onClick={() => openEdit(o)}>Edit</Button>}
                {o.status === 'expired' && !o.settledAt && (
                  <Popconfirm
                    title="Pay out this offer now?"
                    description="Each partner gets the incentive of their highest unlocked tier. This happens automatically a few minutes after the offer ends."
                    okText="Pay out"
                    onConfirm={() => settleMutation.mutate(o._id)}
                  >
                    <Button size="small" type="primary" loading={settleMutation.isPending && settleMutation.variables === o._id}>Pay out</Button>
                  </Popconfirm>
                )}
                {editable(o) && (
                  <Popconfirm
                    title="Cancel this offer?"
                    description="It disappears from the app and nobody is paid for it."
                    okText="Cancel offer"
                    okButtonProps={{ danger: true }}
                    cancelText="Keep"
                    onConfirm={() => cancelMutation.mutate(o._id)}
                  >
                    <Button size="small" danger>Cancel</Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      {/* Create / edit */}
      <Modal
        title={editing === 'new' ? 'New incentive offer' : 'Edit offer'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        okText={editing === 'new' ? 'Create offer' : 'Save'}
        confirmLoading={saveMutation.isPending}
        width={760}
        destroyOnHidden
      >
        <Form<FormValues> form={form} layout="vertical" requiredMark={false} onFinish={(v) => saveMutation.mutate(toInput(v))}>
          <Form.Item name="title" label="Title" rules={[{ required: true, min: 2, max: 80, whitespace: true, message: 'Title is required (2–80 characters)' }]}>
            <Input placeholder="AF - LN | Ultra Marathon" maxLength={80} />
          </Form.Item>
          <Form.Item name="description" label="Description (optional)">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
          <Form.Item
            name="when"
            label="Runs"
            rules={[
              { required: true, message: 'Pick when the offer starts and ends' },
              { validator: (_, v?: [Dayjs, Dayjs]) => (!v || v[1].isAfter(v[0]) ? Promise.resolve() : Promise.reject(new Error('The end must be after the start'))) },
            ]}
          >
            <DatePicker.RangePicker showTime={{ format: 'h:mm a', minuteStep: 15 }} format="D MMM YYYY, h:mm a" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="riders" label="Who" extra="Leave empty to offer it to every delivery partner.">
            <Select mode="multiple" allowClear placeholder="Everyone" options={riderOptions} optionFilterProp="label" />
          </Form.Item>

          <Divider titlePlacement="start" plain>Tiers</Divider>
          <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
            A tier unlocks when the partner meets every requirement filled in on its row. List them smallest to biggest.
          </Typography.Paragraph>
          <Form.List
            name="tiers"
            rules={[{
              validator: async (_, tiers?: OfferTier[]) => {
                if (!tiers?.length) throw new Error('Add at least one tier');
                if (tiers.some((t) => t && !has(numOrNull(t.minEarnings)) && !has(numOrNull(t.minOrders)) && !has(numOrNull(t.minGigs)))) {
                  throw new Error('Each tier needs at least one of earnings, orders or gigs');
                }
              },
            }]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field, i) => (
                  <Space key={field.key} align="start" wrap style={{ display: 'flex', marginBottom: 4 }}>
                    <Typography.Text type="secondary" style={{ display: 'inline-block', width: 44, paddingTop: 5 }}>Tier {i + 1}</Typography.Text>
                    <Form.Item name={[field.name, 'incentive']} rules={[{ required: true, message: 'Incentive' }]} style={{ marginBottom: 8 }}>
                      <InputNumber min={1} prefix="₹" placeholder="Incentive" style={{ width: 130 }} />
                    </Form.Item>
                    <span style={{ display: 'inline-block', paddingTop: 5 }}>unlocks at</span>
                    <Form.Item name={[field.name, 'minEarnings']} style={{ marginBottom: 8 }}>
                      <InputNumber min={0} prefix="₹" placeholder="Earnings" style={{ width: 130 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'minOrders']} style={{ marginBottom: 8 }}>
                      <InputNumber min={0} precision={0} placeholder="Orders" style={{ width: 100 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'minGigs']} style={{ marginBottom: 8 }}>
                      <InputNumber min={0} precision={0} placeholder="Gigs" style={{ width: 90 }} />
                    </Form.Item>
                    {fields.length > 1 && <Button type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} aria-label={`Remove tier ${i + 1}`} />}
                  </Space>
                ))}
                {fields.length < 10 && <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()}>Add tier</Button>}
                <Form.ErrorList errors={errors} />
              </>
            )}
          </Form.List>
          {previewTiers.length > 0 && (
            <div style={{ marginTop: 12, padding: 12, border: '1px solid #f0f0f0', borderRadius: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>In the app (all tiers start locked)</Typography.Text>
              <div style={{ marginTop: 6 }}><TierLadder tiers={previewTiers} locks={previewTiers.map(() => true)} /></div>
            </div>
          )}

          <Divider titlePlacement="start" plain>"Don't do" conditions</Divider>
          <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>Going over any limit loses the whole offer. Leave empty for no limit; 0 means none allowed.</Typography.Paragraph>
          <Space wrap>
            {CONDITION_FIELDS.map((c) => (
              <Form.Item key={c.name} name={['conditions', c.name]} label={c.label} style={{ marginBottom: 8 }}>
                <InputNumber min={0} precision={0} placeholder="No limit" style={{ width: 150 }} />
              </Form.Item>
            ))}
          </Space>

          <Divider titlePlacement="start" plain>Compulsory login</Divider>
          <Form.List name="compulsoryLogin">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="start" wrap style={{ display: 'flex', marginBottom: 4 }}>
                    <Form.Item name={[field.name, 'from']} rules={[{ required: true, message: 'From' }]} style={{ marginBottom: 8 }}>
                      <TimePicker format="h:mm a" minuteStep={15} placeholder="From" use12Hours />
                    </Form.Item>
                    <Form.Item name={[field.name, 'to']} rules={[{ required: true, message: 'To' }]} style={{ marginBottom: 8 }}>
                      <TimePicker format="h:mm a" minuteStep={15} placeholder="To" use12Hours />
                    </Form.Item>
                    <Form.Item name={[field.name, 'minMinutes']} rules={[{ required: true, message: 'Minutes online' }]} style={{ marginBottom: 8 }}>
                      <InputNumber min={1} precision={0} suffix="min online" style={{ width: 160 }} />
                    </Form.Item>
                    <Button type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} aria-label="Remove login window" />
                  </Space>
                ))}
                {fields.length < 5 && <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ minMinutes: 240 })}>Add login window</Button>}
              </>
            )}
          </Form.List>

          <Form.Item name="videoUrl" label='"How it works" video URL (optional)' rules={[{ type: 'url', message: 'Enter a full URL' }]} style={{ marginTop: 16 }}>
            <Input placeholder="https://…" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Partner progress: which tiers each partner has unlocked */}
      <Drawer
        title={progressFor ? `${progressFor.title} · partners` : 'Partners'}
        open={!!progressFor}
        onClose={() => setProgressFor(null)}
        size="large"
      >
        {progressFor && (
          <div style={{ marginBottom: 16 }}>
            <Typography.Text type="secondary">{progressFor.spanLabel}</Typography.Text>
            <div style={{ marginTop: 8 }}><TierLadder tiers={progressFor.tiers} /></div>
          </div>
        )}
        <Table<OfferRiderProgress>
          rowKey={(r) => r.rider._id}
          loading={progressLoading}
          dataSource={progress || []}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'No partner has any activity in this offer yet' }}
          columns={[
            {
              title: 'Partner',
              render: (_, r) => (
                <Space orientation="vertical" size={0}>
                  <span>{r.rider.name}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.rider.phone}</Typography.Text>
                </Space>
              ),
            },
            {
              title: 'Progress',
              render: (_, r) => (r.progress ? (
                <Space orientation="vertical" size={0}>
                  <span>{rupees(r.progress.earnings)} earnings</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.progress.orders} orders · {r.progress.gigs} gigs</Typography.Text>
                </Space>
              ) : '—'),
            },
            {
              title: 'Tiers',
              render: (_, r) => (
                <Space size={4} wrap>
                  {r.tiers.map((t, i) => (
                    <Tooltip key={i} title={`Tier ${i + 1}: ${t.locked ? 'locked' : 'unlocked'}`}>
                      <Tag color={t.locked ? 'default' : 'green'} icon={t.locked ? <LockOutlined /> : <UnlockOutlined />}>{rupees(t.incentive)}</Tag>
                    </Tooltip>
                  ))}
                </Space>
              ),
            },
            { title: 'Incentive', render: (_, r) => <Typography.Text strong>{rupees(r.amount)}</Typography.Text> },
            {
              title: 'Status',
              render: (_, r) => (
                <Tooltip title={r.reason}>
                  <Tag color={PROGRESS_STATUS[r.status].color}>{PROGRESS_STATUS[r.status].label}</Tag>
                </Tooltip>
              ),
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          Live offers show progress so far. A disqualified partner broke a "Don't do" condition or missed a compulsory login, so they get nothing even with tiers unlocked.
        </Typography.Paragraph>
      </Drawer>
    </div>
  );
}
