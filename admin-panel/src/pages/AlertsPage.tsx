import { useState } from 'react';
import {
  App as AntApp, Button, Checkbox, Col, DatePicker, Divider, Empty, Form, Input, Modal, Popconfirm, Radio, Row, Segmented, Select, Space, Switch,
  Table, Tag, Tooltip, Typography,
} from 'antd';
import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import {
  createAlert, deleteAlert, fetchAlerts, setAlertActive, updateAlert,
  type AlertApp, type AlertDisplay, type AlertInput, type AlertSeverity, type AlertStatus, type AppAlert,
} from '../api/alerts';
import { usePageState } from '../hooks/usePageState';

// Alert messages: a banner across the top of the app screens, or a popup when the app opens, in the
// Customer / Picker / Delivery apps (backend services/appAlert.service.js). Switching one on, off or
// editing it reaches open apps right away (socket 'alerts:changed').

const SEVERITY: Record<AlertSeverity, { label: string; color: string; bg: string; tag: string }> = {
  info: { label: 'Info', color: '#0958d9', bg: '#e6f4ff', tag: 'blue' },
  success: { label: 'Good news', color: '#389e0d', bg: '#f6ffed', tag: 'green' },
  warning: { label: 'Warning', color: '#ad6800', bg: '#fffbe6', tag: 'gold' },
  critical: { label: 'Critical', color: '#cf1322', bg: '#fff1f0', tag: 'red' },
};
const APPS: { value: AlertApp; label: string }[] = [
  { value: 'customer', label: 'Customer app' },
  { value: 'picker', label: 'Picker app' },
  { value: 'delivery', label: 'Delivery app' },
];
const STATUS: Record<AlertStatus, { label: string; color: string }> = {
  live: { label: 'Live', color: 'green' },
  scheduled: { label: 'Scheduled', color: 'blue' },
  ended: { label: 'Ended', color: 'default' },
  off: { label: 'Off', color: 'default' },
};

const errMsg = (err: any, fallback: string) => err?.response?.data?.errors?.[0]?.message || err?.response?.data?.message || fallback;
const when = (d?: string | null) => dayjs(d).format('D MMM, h:mm a');
const scheduleLabel = (a: AppAlert) =>
  `${a.startsAt ? when(a.startsAt) : 'Right away'} → ${a.endsAt ? when(a.endsAt) : 'until switched off'}`;

interface FormValues {
  title?: string;
  message: string;
  severity: AlertSeverity;
  display: AlertDisplay;
  apps: AlertApp[];
  dismissible: boolean;
  ctaLabel?: string;
  ctaUrl?: string;
  startsAt?: Dayjs | null;
  endsAt?: Dayjs | null;
  isActive: boolean;
}

function toInput(v: FormValues): AlertInput {
  return {
    title: v.title?.trim() || null,
    message: v.message.trim(),
    severity: v.severity,
    display: v.display,
    apps: v.apps,
    dismissible: v.dismissible,
    cta: v.ctaLabel?.trim() && v.ctaUrl?.trim() ? { label: v.ctaLabel.trim(), url: v.ctaUrl.trim() } : null,
    startsAt: v.startsAt ? v.startsAt.toISOString() : null,
    endsAt: v.endsAt ? v.endsAt.toISOString() : null,
    isActive: v.isActive,
  };
}

// The alert as the app shows it: a strip across the top, or a dialog over the screen.
function AlertPreview({ v }: { v: Partial<FormValues> }) {
  const s = SEVERITY[v.severity || 'info'];
  const button = v.ctaLabel?.trim() ? <Button size="small" style={{ borderColor: s.color, color: s.color, marginTop: 6 }}>{v.ctaLabel}</Button> : null;
  const text = (
    <>
      {v.title?.trim() && <div style={{ fontWeight: 600, color: s.color }}>{v.title}</div>}
      <div style={{ color: '#1f1f1f', fontSize: 13, whiteSpace: 'pre-wrap' }}>{v.message?.trim() || 'Your message appears here'}</div>
    </>
  );
  return (
    <div style={{ width: 240, height: 300, border: '8px solid #1f1f1f', borderRadius: 24, overflow: 'hidden', position: 'relative', background: '#fafafa', margin: '0 auto' }}>
      <div style={{ height: 22, background: '#1f1f1f' }} />
      {v.display === 'popup' ? (
        <div style={{ position: 'absolute', inset: '22px 0 0', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 14, width: '100%', borderTop: `4px solid ${s.color}`, position: 'relative' }}>
            {v.dismissible && <CloseOutlined style={{ position: 'absolute', top: 8, right: 8, fontSize: 11, color: '#8c8c8c' }} />}
            {text}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>{button}{v.dismissible && <Button size="small" type="primary" style={{ marginTop: 6, background: s.color }}>OK</Button>}</div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ background: s.bg, borderBottom: `2px solid ${s.color}`, padding: '8px 26px 8px 10px', position: 'relative' }}>
            {v.dismissible && <CloseOutlined style={{ position: 'absolute', top: 9, right: 8, fontSize: 11, color: '#8c8c8c' }} />}
            {text}
            {button}
          </div>
          <div style={{ padding: 10 }}>
            {[70, 90, 60, 80].map((w, i) => <div key={i} style={{ height: 10, width: `${w}%`, background: '#e8e8e8', borderRadius: 4, marginBottom: 10 }} />)}
          </div>
        </>
      )}
    </div>
  );
}

export default function AlertsPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, onChange } = usePageState(20);
  const [status, setStatus] = useState<AlertStatus | 'all'>('all');
  const [app, setApp] = useState<AlertApp | undefined>();
  const [editing, setEditing] = useState<AppAlert | 'new' | null>(null);
  const [form] = Form.useForm<FormValues>();
  const preview = (Form.useWatch([], form) || {}) as Partial<FormValues>;

  const { data, isLoading } = useQuery({
    queryKey: ['alerts', status, app, page, pageSize],
    queryFn: () => fetchAlerts({ status: status === 'all' ? undefined : status, app, page, limit: pageSize }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['alerts'] });
  const saveMutation = useMutation({
    mutationFn: (body: AlertInput) => (editing && editing !== 'new' ? updateAlert(editing._id, body) : createAlert(body)),
    onSuccess: (a) => {
      message.success(editing === 'new' ? `Alert created${a.status === 'live' ? ' and live in the apps' : ''}` : 'Alert updated');
      setEditing(null);
      refresh();
    },
    onError: (err) => message.error(errMsg(err, 'Could not save the alert')),
  });
  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setAlertActive(id, isActive),
    onSuccess: (a) => { message.success(a.isActive ? 'Alert switched on' : 'Alert switched off'); refresh(); },
    onError: (err) => message.error(errMsg(err, 'Could not switch the alert')),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAlert,
    onSuccess: () => { message.success('Alert deleted'); refresh(); },
    onError: (err) => message.error(errMsg(err, 'Could not delete the alert')),
  });

  function openCreate() {
    form.resetFields();
    form.setFieldsValue({ severity: 'info', display: 'banner', apps: ['customer'], dismissible: true, isActive: true, startsAt: null, endsAt: null });
    setEditing('new');
  }

  function openEdit(a: AppAlert) {
    form.resetFields();
    form.setFieldsValue({
      title: a.title || undefined,
      message: a.message,
      severity: a.severity,
      display: a.display,
      apps: a.apps,
      dismissible: a.dismissible,
      ctaLabel: a.cta?.label || undefined,
      ctaUrl: a.cta?.url || undefined,
      startsAt: a.startsAt ? dayjs(a.startsAt) : null,
      endsAt: a.endsAt ? dayjs(a.endsAt) : null,
      isActive: a.isActive,
    });
    setEditing(a);
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Alert Messages</Typography.Title>
          <Typography.Text type="secondary">A banner or popup in the Customer, Picker and Delivery apps. Switching one on or off reaches open apps right away.</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>New alert</Button>
      </Space>

      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented<AlertStatus | 'all'>
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[{ value: 'all', label: 'All' }, ...(Object.keys(STATUS) as AlertStatus[]).map((s) => ({ value: s, label: STATUS[s].label }))]}
        />
        <Select allowClear placeholder="All apps" style={{ width: 160 }} value={app} onChange={(v) => { setApp(v); setPage(1); }} options={APPS} />
      </Space>

      <Table<AppAlert>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items || []}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems || 0, onChange }}
        locale={{ emptyText: <Empty description="No alerts"><Button type="primary" onClick={openCreate}>New alert</Button></Empty> }}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: 'Alert',
            render: (_, a) => (
              <div style={{ maxWidth: 420, background: SEVERITY[a.severity].bg, borderLeft: `3px solid ${SEVERITY[a.severity].color}`, padding: '6px 10px', borderRadius: 4 }}>
                {a.title && <div style={{ fontWeight: 600, color: SEVERITY[a.severity].color }}>{a.title}</div>}
                <Typography.Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2, tooltip: a.message }}>{a.message}</Typography.Paragraph>
                {a.cta?.label && <Typography.Text type="secondary" style={{ fontSize: 12 }}>Button: {a.cta.label}</Typography.Text>}
              </div>
            ),
          },
          { title: 'Apps', render: (_, a) => <Space size={4} wrap>{a.apps.map((x) => <Tag key={x}>{APPS.find((o) => o.value === x)?.label}</Tag>)}</Space> },
          {
            title: 'Style',
            render: (_, a) => (
              <Space orientation="vertical" size={2}>
                <Space size={4}><Tag color={SEVERITY[a.severity].tag}>{SEVERITY[a.severity].label}</Tag><Tag>{a.display === 'popup' ? 'Popup' : 'Banner'}</Tag></Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{a.dismissible ? 'Users can close it' : "Users can't close it"}</Typography.Text>
              </Space>
            ),
          },
          { title: 'Shows', render: (_, a) => <span style={{ whiteSpace: 'nowrap' }}>{scheduleLabel(a)}</span> },
          { title: 'Status', render: (_, a) => <Tag color={STATUS[a.status].color}>{STATUS[a.status].label}</Tag> },
          {
            title: 'On / Off',
            render: (_, a) => (
              <Tooltip title={a.isActive ? 'Switch off: it disappears from the apps' : 'Switch on'}>
                <Switch
                  checked={a.isActive}
                  loading={activeMutation.isPending && activeMutation.variables?.id === a._id}
                  onChange={(isActive) => activeMutation.mutate({ id: a._id, isActive })}
                />
              </Tooltip>
            ),
          },
          {
            title: 'Actions',
            render: (_, a) => (
              <Space>
                <Button size="small" onClick={() => openEdit(a)}>Edit</Button>
                <Popconfirm title="Delete this alert?" description="It disappears from the apps." okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => deleteMutation.mutate(a._id)}>
                  <Button size="small" danger>Delete</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing === 'new' ? 'New alert' : 'Edit alert'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        okText={editing === 'new' ? 'Create alert' : 'Save'}
        confirmLoading={saveMutation.isPending}
        width={860}
        destroyOnHidden
      >
        <Row gutter={24}>
          <Col xs={24} md={15}>
            <Form<FormValues> form={form} layout="vertical" requiredMark={false} onFinish={(v) => saveMutation.mutate(toInput(v))}>
              <Form.Item name="title" label="Title (optional)" rules={[{ max: 80 }]}>
                <Input placeholder="Heavy rain" maxLength={80} />
              </Form.Item>
              <Form.Item name="message" label="Message" rules={[{ required: true, whitespace: true, min: 2, message: 'Write the alert message' }, { max: 500 }]}>
                <Input.TextArea rows={3} maxLength={500} showCount placeholder="Deliveries may take a little longer today. Thanks for your patience!" />
              </Form.Item>
              <Form.Item name="apps" label="Show in" rules={[{ required: true, type: 'array', min: 1, message: 'Pick at least one app' }]}>
                <Checkbox.Group options={APPS} />
              </Form.Item>
              <Form.Item name="severity" label="Type">
                <Radio.Group optionType="button" options={(Object.keys(SEVERITY) as AlertSeverity[]).map((s) => ({ value: s, label: SEVERITY[s].label }))} />
              </Form.Item>
              <Space wrap size="large">
                <Form.Item name="display" label="Style">
                  <Radio.Group optionType="button" options={[{ value: 'banner', label: 'Banner on top' }, { value: 'popup', label: 'Popup on open' }]} />
                </Form.Item>
                <Form.Item name="dismissible" label="Users can close it" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Space>

              <Divider titlePlacement="start" plain style={{ marginTop: 0 }}>Button (optional)</Divider>
              <Space wrap align="start">
                <Form.Item
                  name="ctaLabel"
                  dependencies={['ctaUrl']}
                  rules={[
                    { max: 30 },
                    ({ getFieldValue }) => ({ validator: (_, v) => (!v?.trim() && getFieldValue('ctaUrl')?.trim() ? Promise.reject(new Error('Add the button text')) : Promise.resolve()) }),
                  ]}
                >
                  <Input placeholder="Button text" maxLength={30} style={{ width: 160 }} />
                </Form.Item>
                <Form.Item
                  name="ctaUrl"
                  dependencies={['ctaLabel']}
                  rules={[
                    { type: 'url', message: 'Enter a full link (https://…)' },
                    ({ getFieldValue }) => ({ validator: (_, v) => (!v?.trim() && getFieldValue('ctaLabel')?.trim() ? Promise.reject(new Error('Add the link')) : Promise.resolve()) }),
                  ]}
                >
                  <Input placeholder="https://…" style={{ width: 260 }} />
                </Form.Item>
              </Space>

              <Divider titlePlacement="start" plain style={{ marginTop: 0 }}>When</Divider>
              <Space wrap align="start">
                <Form.Item name="startsAt" label="From" extra="Empty = right away">
                  <DatePicker showTime={{ format: 'h:mm a', minuteStep: 5 }} format="D MMM YYYY, h:mm a" placeholder="Right away" />
                </Form.Item>
                <Form.Item
                  name="endsAt"
                  label="Until"
                  extra="Empty = until switched off"
                  dependencies={['startsAt']}
                  rules={[({ getFieldValue }) => ({
                    validator: (_, v?: Dayjs | null) => {
                      const start: Dayjs | null = getFieldValue('startsAt');
                      return v && start && !v.isAfter(start) ? Promise.reject(new Error('Must be after the start')) : Promise.resolve();
                    },
                  })]}
                >
                  <DatePicker showTime={{ format: 'h:mm a', minuteStep: 5 }} format="D MMM YYYY, h:mm a" placeholder="Until switched off" />
                </Form.Item>
              </Space>
              <Form.Item name="isActive" label="Switched on" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Switch />
              </Form.Item>
            </Form>
          </Col>
          <Col xs={24} md={9}>
            <Typography.Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 8 }}>Preview</Typography.Text>
            <AlertPreview v={preview} />
          </Col>
        </Row>
      </Modal>
    </div>
  );
}
