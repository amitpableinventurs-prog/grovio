import { useState } from 'react';
import {
  App as AntApp, Button, DatePicker, Descriptions, Drawer, Empty, Input, Popconfirm, Segmented, Select, Space, Switch, Table, Tag, Tooltip, Typography,
} from 'antd';
import { CloudServerOutlined, DeleteOutlined, GlobalOutlined, MobileOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import {
  clearErrorLogs, deleteErrorLog, fetchErrorLog, fetchErrorLogs,
  type ErrorApp, type ErrorLevel, type ErrorLog, type ErrorLogFilters, type ErrorSource,
} from '../api/errorLogs';
import { usePageState } from '../hooks/usePageState';

// Errors from the backend (5xx responses, failed background jobs, crashes) and the ones the
// Customer / Picker / Delivery apps and web panels report, by when they happened.

const SOURCE_META: Record<ErrorSource, { label: string; icon: React.ReactNode; color: string }> = {
  backend: { label: 'Backend', icon: <CloudServerOutlined />, color: 'geekblue' },
  mobile: { label: 'Mobile', icon: <MobileOutlined />, color: 'cyan' },
  web: { label: 'Web', icon: <GlobalOutlined />, color: 'purple' },
};
const LEVEL_COLORS: Record<ErrorLevel, string> = { fatal: 'magenta', error: 'red', warning: 'orange' };
const APP_LABELS: Record<ErrorApp, string> = {
  backend: 'Server', customer: 'Customer app', picker: 'Picker app', delivery: 'Delivery app', vendor: 'Vendor panel', admin: 'Admin panel',
};
// Built on each render so "Last 1 hour" means the last hour from now, not from page load.
const rangePresets = (): { label: string; value: [Dayjs, Dayjs] }[] => [
  { label: 'Last 1 hour', value: [dayjs().subtract(1, 'hour'), dayjs()] },
  { label: 'Last 24 hours', value: [dayjs().subtract(24, 'hour'), dayjs()] },
  { label: 'Today', value: [dayjs().startOf('day'), dayjs().endOf('day')] },
  { label: 'Yesterday', value: [dayjs().subtract(1, 'day').startOf('day'), dayjs().subtract(1, 'day').endOf('day')] },
  { label: 'Last 7 days', value: [dayjs().subtract(7, 'day').startOf('day'), dayjs()] },
  { label: 'Last 30 days', value: [dayjs().subtract(30, 'day').startOf('day'), dayjs()] },
];

const errMsg = (err: any, fallback: string) => err?.response?.data?.errors?.[0]?.message || err?.response?.data?.message || fallback;

function ago(iso: string) {
  const min = dayjs().diff(dayjs(iso), 'minute');
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} hr ago`;
  return `${Math.floor(min / (24 * 60))} days ago`;
}

// A client report that reached the server well after it happened (sent after being offline).
const arrivedLate = (l: ErrorLog) => dayjs(l.createdAt).diff(dayjs(l.occurredAt), 'minute') >= 2;

function where(l: ErrorLog) {
  if (l.method || l.url) return `${l.method || ''} ${l.url || ''}${l.statusCode ? ` → ${l.statusCode}` : ''}`.trim();
  return l.screen || null;
}

function device(l: ErrorLog) {
  return [l.platform, l.appVersion && `v${l.appVersion}`, l.deviceModel, l.osVersion].filter(Boolean).join(' · ');
}

export default function ErrorLogsPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, onChange } = usePageState(20);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [source, setSource] = useState<ErrorSource | 'all'>('all');
  const [app, setApp] = useState<ErrorApp | undefined>();
  const [level, setLevel] = useState<ErrorLevel | undefined>();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const filters: ErrorLogFilters = {
    from: range?.[0].toISOString(),
    to: range?.[1].toISOString(),
    source: source === 'all' ? undefined : source,
    app,
    level,
    search: search || undefined,
  };
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['error-logs', filters, sort, page, pageSize],
    queryFn: () => fetchErrorLogs({ ...filters, sort, page, limit: pageSize }),
    refetchInterval: autoRefresh ? 30_000 : false,
  });
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['error-log', openId],
    queryFn: () => fetchErrorLog(openId!),
    enabled: !!openId,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['error-logs'] });
  const deleteMutation = useMutation({
    mutationFn: deleteErrorLog,
    onSuccess: () => { message.success('Error log deleted'); setOpenId(null); refresh(); },
    onError: (err) => message.error(errMsg(err, 'Could not delete the error log')),
  });
  const clearMutation = useMutation({
    mutationFn: () => clearErrorLogs(filters),
    onSuccess: (res) => { message.success(`Deleted ${res.deleted} error logs`); setPage(1); refresh(); },
    onError: (err) => message.error(errMsg(err, 'Could not delete the error logs')),
  });

  const summary = data?.summary;
  const total = data?.meta.totalItems || 0;
  const filtered = !!(range || source !== 'all' || app || level || search);

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Error Logs</Typography.Title>
          <Typography.Text type="secondary">Server errors and the errors the mobile apps and web panels report, by when they happened. Kept for 90 days.</Typography.Text>
        </div>
        <Space wrap>
          <Tooltip title="Reload every 30 seconds">
            <Space size={6}><Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} /> Auto-refresh</Space>
          </Tooltip>
          <Button icon={<ReloadOutlined />} loading={isFetching && !isLoading} onClick={() => refetch()}>Refresh</Button>
          <Popconfirm
            title={filtered ? `Delete the ${total} matching error logs?` : `Delete all ${total} error logs?`}
            description="This can't be undone."
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => clearMutation.mutate()}
            disabled={!total}
          >
            <Button danger icon={<DeleteOutlined />} disabled={!total} loading={clearMutation.isPending}>{filtered ? 'Delete matching' : 'Delete all'}</Button>
          </Popconfirm>
        </Space>
      </Space>

      <Space wrap style={{ marginBottom: 12 }}>
        <DatePicker.RangePicker
          showTime={{ format: 'h:mm a' }}
          format="D MMM YYYY, h:mm a"
          presets={rangePresets()}
          value={range}
          onChange={(v) => resetPage(setRange)(v && v[0] && v[1] ? [v[0], v[1]] : null)}
          placeholder={['From date & time', 'To date & time']}
        />
        <Select allowClear placeholder="All apps" style={{ width: 160 }} value={app} onChange={resetPage(setApp)}
          options={(Object.keys(APP_LABELS) as ErrorApp[]).map((a) => ({ value: a, label: APP_LABELS[a] }))} />
        <Select allowClear placeholder="All levels" style={{ width: 130 }} value={level} onChange={resetPage(setLevel)}
          options={(['fatal', 'error', 'warning'] as ErrorLevel[]).map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }))} />
        <Input.Search allowClear placeholder="Search message, URL or screen" style={{ width: 260 }} onSearch={resetPage(setSearch)} />
        <Select style={{ width: 140 }} value={sort} onChange={resetPage(setSort)} options={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }]} />
      </Space>

      <Segmented<ErrorSource | 'all'>
        style={{ marginBottom: 16 }}
        value={source}
        onChange={resetPage(setSource)}
        options={[
          { value: 'all', label: `All${summary ? ` (${summary.backend + summary.mobile + summary.web})` : ''}` },
          ...(Object.keys(SOURCE_META) as ErrorSource[]).map((s) => ({
            value: s,
            label: <Space size={4}>{SOURCE_META[s].icon}{SOURCE_META[s].label}{summary ? ` (${summary[s]})` : ''}</Space>,
          })),
        ]}
      />

      <Table<ErrorLog>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items || []}
        pagination={{ current: page, pageSize, total, onChange, showSizeChanger: true, showTotal: (n) => `${n} errors` }}
        locale={{ emptyText: <Empty description={filtered ? 'No errors match these filters' : 'No errors logged'} /> }}
        scroll={{ x: 'max-content' }}
        onRow={(l) => ({ onClick: () => setOpenId(l._id), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: 'When',
            width: 170,
            render: (_, l) => (
              <Space orientation="vertical" size={0}>
                <Typography.Text strong>{dayjs(l.occurredAt).format('h:mm:ss a')}</Typography.Text>
                <Typography.Text>{dayjs(l.occurredAt).format('ddd, D MMM YYYY')}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {ago(l.occurredAt)}
                  {arrivedLate(l) && <Tooltip title={`Reached the server ${dayjs(l.createdAt).format('D MMM, h:mm a')}`}> · sent later</Tooltip>}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: 'Source',
            render: (_, l) => (
              <Space orientation="vertical" size={2}>
                <Tag color={SOURCE_META[l.source].color} icon={SOURCE_META[l.source].icon}>{SOURCE_META[l.source].label}</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{APP_LABELS[l.app]}</Typography.Text>
              </Space>
            ),
          },
          { title: 'Level', render: (_, l) => <Tag color={LEVEL_COLORS[l.level]}>{l.level.toUpperCase()}</Tag> },
          {
            title: 'Error',
            render: (_, l) => (
              <div style={{ maxWidth: 520 }}>
                <Typography.Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2 }}>{l.message}</Typography.Paragraph>
                {where(l) && <Typography.Text type="secondary" style={{ fontSize: 12 }} code>{where(l)}</Typography.Text>}
              </div>
            ),
          },
          {
            title: 'User / device',
            render: (_, l) => (
              <Space orientation="vertical" size={0}>
                <span>{l.user ? `${l.user.name}${l.role ? ` (${l.role})` : ''}` : <Typography.Text type="secondary">Not signed in</Typography.Text>}</span>
                {device(l) && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{device(l)}</Typography.Text>}
              </Space>
            ),
          },
          {
            title: '',
            render: (_, l) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Popconfirm title="Delete this error log?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => deleteMutation.mutate(l._id)}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Delete error log" />
                </Popconfirm>
              </span>
            ),
          },
        ]}
      />

      <Drawer title="Error details" open={!!openId} onClose={() => setOpenId(null)} size="large" loading={detailLoading}>
        {detail && (
          <>
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color={SOURCE_META[detail.source].color} icon={SOURCE_META[detail.source].icon}>{SOURCE_META[detail.source].label}</Tag>
              <Tag>{APP_LABELS[detail.app]}</Tag>
              <Tag color={LEVEL_COLORS[detail.level]}>{detail.level.toUpperCase()}</Tag>
            </Space>
            <Typography.Paragraph copyable strong style={{ fontSize: 15 }}>{detail.message}</Typography.Paragraph>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Happened">{dayjs(detail.occurredAt).format('ddd, D MMM YYYY, h:mm:ss a')}</Descriptions.Item>
              {arrivedLate(detail) && <Descriptions.Item label="Reached server">{dayjs(detail.createdAt).format('ddd, D MMM YYYY, h:mm:ss a')}</Descriptions.Item>}
              {(detail.method || detail.url) && <Descriptions.Item label="Request"><Typography.Text code>{where(detail)}</Typography.Text></Descriptions.Item>}
              {detail.screen && <Descriptions.Item label="Screen">{detail.screen}</Descriptions.Item>}
              <Descriptions.Item label="User">
                {detail.user ? `${detail.user.name}${detail.role ? ` (${detail.role})` : ''}${detail.user.phone ? ` · ${detail.user.phone}` : ''}` : 'Not signed in'}
              </Descriptions.Item>
              {device(detail) && <Descriptions.Item label="Device">{device(detail)}</Descriptions.Item>}
              {detail.ip && <Descriptions.Item label="IP">{detail.ip}</Descriptions.Item>}
              {detail.userAgent && <Descriptions.Item label="User agent"><Typography.Text style={{ fontSize: 12 }}>{detail.userAgent}</Typography.Text></Descriptions.Item>}
            </Descriptions>
            {detail.stack && (
              <>
                <Typography.Title level={5}>Stack trace <Typography.Text copyable={{ text: detail.stack }} /></Typography.Title>
                <pre style={{ background: '#f6f6f6', padding: 12, borderRadius: 6, fontSize: 12, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre' }}>{detail.stack}</pre>
              </>
            )}
            {detail.context && (
              <>
                <Typography.Title level={5}>{detail.source === 'backend' ? 'Request data' : 'Context'}</Typography.Title>
                <pre style={{ background: '#f6f6f6', padding: 12, borderRadius: 6, fontSize: 12, maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(detail.context, null, 2)}</pre>
              </>
            )}
            <Popconfirm title="Delete this error log?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => deleteMutation.mutate(detail._id)}>
              <Button danger icon={<DeleteOutlined />} loading={deleteMutation.isPending} style={{ marginTop: 8 }}>Delete</Button>
            </Popconfirm>
          </>
        )}
      </Drawer>
    </div>
  );
}
