import { Table, Typography, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { fetchActivityLogs } from '../api/admins';
import type { AdminActivityLog, User } from '../types';
import { usePageState } from '../hooks/usePageState';
import { formatDateTime, titleCase } from '../utils/format';

export default function ActivityLogsPage() {
  const { page, pageSize, onChange } = usePageState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['activity-logs', page, pageSize],
    queryFn: () => fetchActivityLogs({ page, limit: pageSize }),
  });

  return (
    <div>
      <Typography.Title level={3}>Activity Logs</Typography.Title>

      <Table<AdminActivityLog>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          { title: 'Admin', render: (_, r) => (typeof r.admin === 'object' ? (r.admin as User).name : r.admin) },
          { title: 'Action', render: (_, r) => <Tag color="blue">{titleCase(r.action)}</Tag> },
          { title: 'Entity Type', dataIndex: 'entityType', render: (v) => v || '—' },
          {
            title: 'Metadata',
            render: (_, r) => <code style={{ fontSize: 12 }}>{JSON.stringify(r.metadata)}</code>,
          },
          { title: 'When', render: (_, r) => formatDateTime(r.createdAt) },
        ]}
      />
    </div>
  );
}
