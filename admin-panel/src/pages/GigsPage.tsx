import { useMemo, useState } from 'react';
import {
  App as AntApp, Button, Card, Checkbox, DatePicker, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Switch,
  Table, Tag, TimePicker, Tooltip, Typography,
} from 'antd';
import { CalendarOutlined, LeftOutlined, PlusOutlined, RightOutlined, StarFilled, TeamOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { cancelGig, createGigs, exemptGigBooking, fetchGigBookings, fetchGigs, updateGig, type Gig, type GigBooking, type GigSlotInput } from '../api/gigs';
import { fetchStores } from '../api/stores';

// Delivery partner gigs: bookable shifts partners pick in the app (backend services/gig.service.js).
// A gig is completed when the partner is online for its minimum login time inside it.

const WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];
const SHIFT_PRESETS = [
  { name: 'Morning', from: '08:00', to: '12:00' },
  { name: 'Afternoon', from: '12:00', to: '16:00' },
  { name: 'Evening', from: '16:00', to: '20:00' },
  { name: 'Night', from: '20:00', to: '00:00' },
];
const BOOKING_COLORS: Record<GigBooking['status'], string> = { booked: 'blue', completed: 'green', incomplete: 'orange', cancelled: 'default' };

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// Length of a slot in minutes; "to" at or before "from" runs past midnight.
const slotLength = (from: string, to: string) => { const d = toMin(to) - toMin(from); return d > 0 ? d : d + 1440; };
const timeRange = (g: Gig) => `${dayjs(g.startAt).format('h:mma')} – ${dayjs(g.endAt).format('h:mma')}`;
const payLabel = (g: Gig) => (g.payPerHourMin != null ? `₹${g.payPerHourMin}${g.payPerHourMax != null && g.payPerHourMax !== g.payPerHourMin ? `–₹${g.payPerHourMax}` : ''}/hr` : '—');
function period(g: Gig) {
  const h = dayjs(g.startAt).hour();
  if (h >= 4 && h < 11) return 'Morning';
  if (h >= 11 && h < 15) return 'Lunch';
  if (h >= 15 && h < 19) return 'Evening';
  if (h >= 19 && h < 23) return 'Dinner';
  return 'Night';
}

interface CreateValues {
  storeId?: string;
  dates: [Dayjs, Dayjs];
  weekdays: number[];
  mode: 'shifts' | 'hourly';
  shifts: { on: boolean; name: string; from: Dayjs; to: Dayjs }[];
  hourFrom?: Dayjs;
  hourTo?: Dayjs;
  slotMinutes: number;
  payPerHourMin?: number | null;
  payPerHourMax?: number | null;
  capacity?: number | null;
  minLoginPct: number;
  isFree?: boolean;
  isPriority?: boolean;
  note?: string;
}

function buildSlots(v: Partial<CreateValues>): { from: string; to: string }[] {
  if (v.mode === 'hourly') {
    if (!v.hourFrom || !v.hourTo || !v.slotMinutes) return [];
    const start = toMin(v.hourFrom.format('HH:mm'));
    const total = slotLength(v.hourFrom.format('HH:mm'), v.hourTo.format('HH:mm'));
    const out = [];
    for (let m = 0; m + v.slotMinutes <= total && out.length < 48; m += v.slotMinutes) out.push({ from: fromMin(start + m), to: fromMin(start + m + v.slotMinutes) });
    return out;
  }
  return (v.shifts || []).filter((s) => s?.on && s.from && s.to).map((s) => ({ from: s.from.format('HH:mm'), to: s.to.format('HH:mm') }));
}

function buildDates(v: Partial<CreateValues>): string[] {
  if (!v.dates?.[0] || !v.dates?.[1]) return [];
  const days = new Set(v.weekdays || []);
  const out: string[] = [];
  for (let d = v.dates[0].startOf('day'); !d.isAfter(v.dates[1], 'day') && out.length < 62; d = d.add(1, 'day')) {
    if (days.has(d.day())) out.push(d.format('YYYY-MM-DD'));
  }
  return out;
}

export default function GigsPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Dayjs>(dayjs().startOf('day'));
  const [storeId, setStoreId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Gig | null>(null);
  const [bookingsFor, setBookingsFor] = useState<Gig | null>(null);
  const [createForm] = Form.useForm<CreateValues>();
  const [editForm] = Form.useForm();
  const createValues = Form.useWatch([], createForm) as Partial<CreateValues> | undefined;

  const weekStart = selected.subtract((selected.day() + 6) % 7, 'day');
  const { data, isLoading } = useQuery({
    queryKey: ['gigs', weekStart.format('YYYY-MM-DD'), storeId],
    queryFn: () => fetchGigs({ date: weekStart.format('YYYY-MM-DD'), days: 7, storeId }),
  });
  const { data: stores } = useQuery({ queryKey: ['stores', 'all'], queryFn: () => fetchStores({ limit: 100 }) });
  const { data: bookings, isLoading: bookingsLoading } = useQuery({
    queryKey: ['gig-bookings', bookingsFor?._id],
    queryFn: () => fetchGigBookings(bookingsFor!._id),
    enabled: !!bookingsFor,
  });

  const dayGigs = useMemo(() => (data?.items || []).filter((g) => dayjs(g.startAt).isSame(selected, 'day')), [data, selected]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['gigs'] });
  const errMsg = (err: any, fallback: string) => err?.response?.data?.errors?.[0]?.message || err?.response?.data?.message || fallback;

  const createMutation = useMutation({
    mutationFn: createGigs,
    onSuccess: (res) => {
      message.success(`${res.created} gigs created${res.skipped ? `, ${res.skipped} already existed` : ''}`);
      setCreating(false);
      refresh();
    },
    onError: (err) => message.error(errMsg(err, 'Could not create gigs')),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateGig>[1] }) => updateGig(id, body),
    onSuccess: () => { message.success('Gig updated'); setEditing(null); refresh(); },
    onError: (err) => message.error(errMsg(err, 'Could not update the gig')),
  });
  const cancelMutation = useMutation({
    mutationFn: cancelGig,
    onSuccess: () => { message.success('Gig cancelled — partners who booked it were notified'); refresh(); },
    onError: (err) => message.error(errMsg(err, 'Could not cancel the gig')),
  });
  const exemptMutation = useMutation({
    mutationFn: ({ id, exempted }: { id: string; exempted: boolean }) => exemptGigBooking(id, exempted, exempted ? 'Exempted by admin' : undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gig-bookings'] }),
    onError: (err) => message.error(errMsg(err, 'Could not update')),
  });

  const previewDates = buildDates(createValues || {});
  const previewSlots = buildSlots(createValues || {});

  function openCreate() {
    createForm.resetFields();
    createForm.setFieldsValue({
      dates: [selected, selected.add(6, 'day')],
      weekdays: WEEKDAYS.map((w) => w.value),
      mode: 'shifts',
      shifts: SHIFT_PRESETS.map((s) => ({ on: true, name: s.name, from: dayjs(s.from, 'HH:mm'), to: dayjs(s.to, 'HH:mm') })),
      hourFrom: dayjs('08:00', 'HH:mm'),
      hourTo: dayjs('00:00', 'HH:mm'),
      slotMinutes: 60,
      minLoginPct: 83,
      payPerHourMin: 50,
      payPerHourMax: 70,
    });
    setCreating(true);
  }

  function submitCreate(v: CreateValues) {
    const dates = buildDates(v);
    const slots = buildSlots(v);
    if (!dates.length) return message.error('Pick at least one day');
    if (dates.length > 31) return message.error('At most 31 days at a time');
    if (!slots.length) return message.error('Add at least one gig time');
    const body: GigSlotInput[] = slots.map((s) => ({
      ...s,
      payPerHourMin: v.payPerHourMin ?? null,
      payPerHourMax: v.payPerHourMax ?? v.payPerHourMin ?? null,
      capacity: v.capacity ?? null,
      minLoginMinutes: Math.max(0, Math.round((slotLength(s.from, s.to) * v.minLoginPct) / 100)),
      isFree: !!v.isFree,
      isPriority: !!v.isPriority,
      ...(v.note ? { note: v.note } : {}),
    }));
    createMutation.mutate({ storeId: v.storeId || null, dates, slots: body });
  }

  function openEdit(g: Gig) {
    editForm.setFieldsValue({
      payPerHourMin: g.payPerHourMin, payPerHourMax: g.payPerHourMax, capacity: g.capacity, minLoginMinutes: g.minLoginMinutes,
      isFree: g.isFree, isPriority: g.isPriority, note: g.note,
    });
    setEditing(g);
  }

  const ended = (g: Gig) => dayjs(g.endAt).isBefore(dayjs());

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Gigs</Typography.Title>
          <Typography.Text type="secondary">Shifts delivery partners book in the app. A gig counts as done when they stay online for its minimum login time.</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Create gigs</Button>
      </Space>

      <Space wrap style={{ marginBottom: 16 }}>
        <Button icon={<LeftOutlined />} onClick={() => setSelected(selected.subtract(7, 'day'))} aria-label="Previous week" />
        <DatePicker value={selected} onChange={(d) => d && setSelected(d.startOf('day'))} allowClear={false} format="ddd, D MMM YYYY" />
        <Button icon={<RightOutlined />} onClick={() => setSelected(selected.add(7, 'day'))} aria-label="Next week" />
        <Button onClick={() => setSelected(dayjs().startOf('day'))}>Today</Button>
        <Select
          allowClear
          placeholder="All stores"
          style={{ width: 240 }}
          value={storeId}
          onChange={setStoreId}
          options={[{ value: 'none', label: 'Any zone (no store)' }, ...(stores?.items || []).map((s) => ({ value: s._id, label: s.name }))]}
        />
      </Space>

      {/* Week strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8, marginBottom: 16 }}>
        {(data?.summary || []).map((d) => {
          const active = d.date === selected.format('YYYY-MM-DD');
          const isToday = d.date === dayjs().format('YYYY-MM-DD');
          return (
            <Card
              key={d.date}
              size="small"
              hoverable
              onClick={() => setSelected(dayjs(d.date))}
              style={{ borderColor: active ? '#16a34a' : undefined, background: active ? '#f0fdf4' : undefined, cursor: 'pointer' }}
              styles={{ body: { padding: 10 } }}
            >
              <Typography.Text strong>{d.weekday}</Typography.Text> <Typography.Text type="secondary">{d.label}</Typography.Text>
              {isToday && <Tag color="green" style={{ marginLeft: 6 }}>Today</Tag>}
              <div style={{ marginTop: 4, fontSize: 13 }}>
                {d.gigs ? <>{d.gigs} gigs · <TeamOutlined /> {d.booked}{d.seats != null ? `/${d.seats}` : ''}</> : <Typography.Text type="secondary">No gigs</Typography.Text>}
              </div>
            </Card>
          );
        })}
      </div>

      <Table<Gig>
        rowKey="_id"
        loading={isLoading}
        dataSource={dayGigs}
        pagination={false}
        locale={{ emptyText: <Empty description={`No gigs on ${selected.format('ddd, D MMM')}`}><Button type="primary" onClick={openCreate}>Create gigs</Button></Empty> }}
        rowClassName={(g) => (g.status === 'cancelled' ? 'ant-table-row-disabled' : '')}
        columns={[
          {
            title: 'Time',
            render: (_, g) => (
              <Space orientation="vertical" size={0}>
                <Typography.Text strong delete={g.status === 'cancelled'}>{timeRange(g)}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{period(g)} · {Math.round((dayjs(g.endAt).diff(dayjs(g.startAt), 'minute')) / 6) / 10} h</Typography.Text>
              </Space>
            ),
          },
          { title: 'Store', render: (_, g) => g.store?.name || <Typography.Text type="secondary">Any zone</Typography.Text> },
          { title: 'Pay', render: (_, g) => payLabel(g) },
          {
            title: 'Booked',
            render: (_, g) => (
              <Button type="link" style={{ padding: 0 }} onClick={() => setBookingsFor(g)}>
                <TeamOutlined /> {g.bookedCount}{g.capacity != null ? ` / ${g.capacity}` : ''}
              </Button>
            ),
          },
          { title: 'Min. login', render: (_, g) => `${g.minLoginMinutes} min` },
          {
            title: '',
            render: (_, g) => (
              <Space size={4} wrap>
                {g.status === 'cancelled' && <Tag>Cancelled</Tag>}
                {g.isFree && <Tooltip title="No penalty if incomplete"><Tag color="orange">Free</Tag></Tooltip>}
                {g.isPriority && <Tag color="purple" icon={<StarFilled />}>Peak</Tag>}
                {ended(g) && g.status === 'active' && <Tag>Ended</Tag>}
              </Space>
            ),
          },
          {
            title: 'Actions',
            render: (_, g) => (
              <Space>
                <Button size="small" onClick={() => setBookingsFor(g)}>Bookings</Button>
                {g.status === 'active' && !ended(g) && (
                  <>
                    <Button size="small" onClick={() => openEdit(g)}>Edit</Button>
                    <Popconfirm
                      title="Cancel this gig?"
                      description={g.bookedCount ? `${g.bookedCount} partner(s) booked it — they'll be notified.` : undefined}
                      okText="Cancel gig"
                      okButtonProps={{ danger: true }}
                      cancelText="Keep"
                      onConfirm={() => cancelMutation.mutate(g._id)}
                    >
                      <Button size="small" danger>Cancel</Button>
                    </Popconfirm>
                  </>
                )}
              </Space>
            ),
          },
        ]}
      />

      {/* Create */}
      <Modal
        title="Create gigs"
        open={creating}
        onCancel={() => setCreating(false)}
        onOk={() => createForm.submit()}
        okText={previewDates.length && previewSlots.length ? `Create ${previewDates.length * previewSlots.length} gigs` : 'Create'}
        confirmLoading={createMutation.isPending}
        width={720}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={submitCreate} requiredMark={false}>
          <Space style={{ display: 'flex' }} align="start" wrap>
            <Form.Item name="dates" label="Dates" rules={[{ required: true }]}>
              <DatePicker.RangePicker format="D MMM YYYY" disabledDate={(d) => d.isBefore(dayjs().startOf('day'))} />
            </Form.Item>
            <Form.Item name="storeId" label="Store" extra="Blank = any zone" style={{ minWidth: 220 }}>
              <Select allowClear placeholder="Any zone" options={(stores?.items || []).map((s) => ({ value: s._id, label: s.name }))} />
            </Form.Item>
          </Space>
          <Form.Item name="weekdays" label="On these days">
            <Checkbox.Group options={WEEKDAYS} />
          </Form.Item>

          <Form.Item name="mode" label="Gig times">
            <Radio.Group optionType="button" options={[{ value: 'shifts', label: 'Shifts' }, { value: 'hourly', label: 'Hourly slots' }]} />
          </Form.Item>

          {createValues?.mode !== 'hourly' ? (
            <Form.List name="shifts">
              {(fields, { add, remove }) => (
                <div style={{ marginBottom: 12 }}>
                  {fields.map((f) => (
                    <Space key={f.key} align="baseline" style={{ display: 'flex', marginBottom: 4 }}>
                      <Form.Item name={[f.name, 'on']} valuePropName="checked" noStyle><Checkbox /></Form.Item>
                      <Form.Item name={[f.name, 'name']} noStyle><Input placeholder="Name" style={{ width: 120 }} /></Form.Item>
                      <Form.Item name={[f.name, 'from']} noStyle><TimePicker format="HH:mm" minuteStep={15} needConfirm={false} /></Form.Item>
                      <span>to</span>
                      <Form.Item name={[f.name, 'to']} noStyle><TimePicker format="HH:mm" minuteStep={15} needConfirm={false} /></Form.Item>
                      <Button type="link" danger onClick={() => remove(f.name)}>Remove</Button>
                    </Space>
                  ))}
                  <Button size="small" onClick={() => add({ on: true, name: '', from: dayjs('10:00', 'HH:mm'), to: dayjs('14:00', 'HH:mm') })} icon={<PlusOutlined />}>Add shift</Button>
                </div>
              )}
            </Form.List>
          ) : (
            <Space wrap align="start">
              <Form.Item name="hourFrom" label="From"><TimePicker format="HH:mm" minuteStep={15} needConfirm={false} /></Form.Item>
              <Form.Item name="hourTo" label="Until" extra="00:00 = midnight"><TimePicker format="HH:mm" minuteStep={15} needConfirm={false} /></Form.Item>
              <Form.Item name="slotMinutes" label="Each gig">
                <Select style={{ width: 130 }} options={[{ value: 30, label: '30 min' }, { value: 60, label: '1 hour' }, { value: 120, label: '2 hours' }, { value: 180, label: '3 hours' }, { value: 240, label: '4 hours' }]} />
              </Form.Item>
            </Space>
          )}

          <Space wrap align="start">
            <Form.Item name="payPerHourMin" label="Pay per hour from (₹)" extra="Shown to partners as a guide"><InputNumber min={0} style={{ width: 150 }} /></Form.Item>
            <Form.Item name="payPerHourMax" label="to (₹)"><InputNumber min={0} style={{ width: 110 }} /></Form.Item>
            <Form.Item name="capacity" label="Partners per gig" extra="Blank = unlimited"><InputNumber min={1} style={{ width: 150 }} /></Form.Item>
            <Form.Item name="minLoginPct" label="Minimum login" extra="% of each gig to count as done"><InputNumber min={0} max={100} suffix="%" style={{ width: 130 }} /></Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="isFree" label="Free gig" valuePropName="checked" extra="No penalty if incomplete"><Switch /></Form.Item>
            <Form.Item name="isPriority" label="Peak gig (star)" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="note" label="Note" style={{ minWidth: 260 }}><Input placeholder="e.g. Rain bonus applies" maxLength={120} /></Form.Item>
          </Space>

          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            <CalendarOutlined /> {previewDates.length} day{previewDates.length === 1 ? '' : 's'} × {previewSlots.length} gig{previewSlots.length === 1 ? '' : 's'} a day
            {previewSlots.length > 0 && <> ({previewSlots.slice(0, 6).map((s) => `${s.from}–${s.to}`).join(', ')}{previewSlots.length > 6 ? ', …' : ''})</>}.
            {' '}Gigs that already exist are skipped.
          </Typography.Paragraph>
        </Form>
      </Modal>

      {/* Edit */}
      <Modal
        title={editing ? `Edit gig · ${dayjs(editing.startAt).format('ddd D MMM')}, ${timeRange(editing)}` : 'Edit gig'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => editForm.submit()}
        confirmLoading={updateMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(v) => editing && updateMutation.mutate({ id: editing._id, body: { ...v, capacity: v.capacity ?? null, note: v.note || null } })}
        >
          <Space wrap>
            <Form.Item name="payPerHourMin" label="Pay per hour from (₹)"><InputNumber min={0} /></Form.Item>
            <Form.Item name="payPerHourMax" label="to (₹)"><InputNumber min={0} /></Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="capacity" label="Partners per gig" extra={editing?.bookedCount ? `${editing.bookedCount} already booked` : 'Blank = unlimited'}>
              <InputNumber min={Math.max(1, editing?.bookedCount || 1)} />
            </Form.Item>
            <Form.Item name="minLoginMinutes" label="Minimum login (min)"><InputNumber min={0} /></Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="isFree" label="Free gig" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="isPriority" label="Peak gig" valuePropName="checked"><Switch /></Form.Item>
          </Space>
          <Form.Item name="note" label="Note"><Input maxLength={120} /></Form.Item>
        </Form>
      </Modal>

      {/* Bookings */}
      <Drawer
        title={bookingsFor ? `Bookings · ${dayjs(bookingsFor.startAt).format('ddd D MMM')}, ${timeRange(bookingsFor)}` : 'Bookings'}
        open={!!bookingsFor}
        onClose={() => setBookingsFor(null)}
        size="large"
      >
        <Table<GigBooking>
          rowKey="_id"
          loading={bookingsLoading}
          dataSource={bookings || []}
          pagination={false}
          locale={{ emptyText: 'Nobody has booked this gig yet' }}
          columns={[
            {
              title: 'Partner',
              render: (_, b) => (
                <Space orientation="vertical" size={0}>
                  <span>{b.rider?.name || '—'}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{b.rider?.phone}</Typography.Text>
                </Space>
              ),
            },
            {
              title: 'Status',
              render: (_, b) => (
                <Space size={4} wrap>
                  <Tag color={BOOKING_COLORS[b.status]}>{b.status[0].toUpperCase() + b.status.slice(1)}</Tag>
                  {b.exempted && <Tooltip title={b.exemptReason}><Tag>Exempted</Tag></Tooltip>}
                </Space>
              ),
            },
            { title: 'Online', render: (_, b) => (b.loginMinutes != null ? `${b.loginMinutes} min` : '—') },
            { title: 'Trips', render: (_, b) => b.trips ?? '—' },
            { title: 'Earned', render: (_, b) => (b.earnings != null ? `₹${b.earnings}` : '—') },
            {
              title: '',
              render: (_, b) => b.status === 'incomplete' && (
                <Button size="small" loading={exemptMutation.isPending} onClick={() => exemptMutation.mutate({ id: b._id, exempted: !b.exempted })}>
                  {b.exempted ? 'Remove exemption' : 'Exempt'}
                </Button>
              ),
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          Exempt an incomplete gig when it wasn't the partner's fault (app or store problem) — it then doesn't count against their offers.
        </Typography.Paragraph>
      </Drawer>
    </div>
  );
}
