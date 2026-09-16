import { useState } from 'react';
import { Table, Typography, Select, Button, Drawer, Descriptions, Input, Space, App as AntApp } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTickets, replyToTicket } from '../api/support';
import type { SupportTicket, User } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import { formatDateTime } from '../utils/format';

export default function SupportTicketsPage() {
  const { page, pageSize, onChange } = usePageState();
  const [status, setStatus] = useState<string | undefined>();
  const [active, setActive] = useState<SupportTicket | null>(null);
  const [reply, setReply] = useState('');
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['support-tickets', page, pageSize, status],
    queryFn: () => fetchTickets({ page, limit: pageSize, status }),
  });

  const replyMutation = useMutation({
    mutationFn: ({ id, adminReply, newStatus }: { id: string; adminReply: string; newStatus: string }) =>
      replyToTicket(id, { adminReply, status: newStatus }),
    onSuccess: () => {
      message.success('Reply sent');
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      setActive(null);
      setReply('');
    },
  });

  return (
    <div>
      <Typography.Title level={3}>Support Tickets</Typography.Title>

      <Select
        placeholder="Filter by status"
        allowClear
        style={{ width: 180, marginBottom: 16 }}
        value={status}
        onChange={setStatus}
        options={['open', 'in_progress', 'resolved', 'closed'].map((s) => ({ value: s, label: s }))}
      />

      <Table<SupportTicket>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          { title: 'Subject', dataIndex: 'subject' },
          { title: 'From', render: (_, r) => (typeof r.user === 'object' ? (r.user as User).name : '—') },
          { title: 'Status', render: (_, r) => <StatusTag status={r.status} /> },
          { title: 'Created', render: (_, r) => formatDateTime(r.createdAt) },
          {
            title: 'Actions',
            render: (_, r) => (
              <Button
                size="small"
                onClick={() => {
                  setActive(r);
                  setReply(r.adminReply || '');
                }}
              >
                View / Reply
              </Button>
            ),
          },
        ]}
      />

      <Drawer title="Support Ticket" open={!!active} onClose={() => setActive(null)} width={450}>
        {active && (
          <>
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Subject">{active.subject}</Descriptions.Item>
              <Descriptions.Item label="Message">{active.message}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <StatusTag status={active.status} />
              </Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5}>Reply</Typography.Title>
            <Input.TextArea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} />
            <Space style={{ marginTop: 12 }}>
              <Button
                type="primary"
                loading={replyMutation.isPending}
                onClick={() => replyMutation.mutate({ id: active._id, adminReply: reply, newStatus: 'in_progress' })}
              >
                Send Reply
              </Button>
              <Button
                onClick={() => replyMutation.mutate({ id: active._id, adminReply: reply, newStatus: 'resolved' })}
                loading={replyMutation.isPending}
              >
                Reply & Mark Resolved
              </Button>
            </Space>
          </>
        )}
      </Drawer>
    </div>
  );
}
