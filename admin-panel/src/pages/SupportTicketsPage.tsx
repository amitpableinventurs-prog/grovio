import { useEffect, useRef, useState } from 'react';
import { App as AntApp, Badge, Button, Drawer, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchTicket, fetchTickets, markTicketRead, replyToTicket } from '../api/support';
import type { SupportMessageEvent, SupportTicket, SupportTicketEvent, SupportTypingEvent, User } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import { formatDateTime, titleCase } from '../utils/format';
import { emitWithAck, onSocketEvent, useSocketConnected } from '../realtime/socket';

const CLOSED = ['resolved', 'closed'];
const ROLE_LABELS: Record<string, string> = { customer: 'Customer', delivery: 'Delivery partner', picker: 'Picker' };

const userOf = (t: SupportTicket) => (t.user && typeof t.user === 'object' ? (t.user as User) : null);
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Support chat with customers, delivery partners and pickers. Live over Socket.IO: new tickets and
// messages appear without refreshing, replies go out over the socket (REST if it's down), and the
// user sees "Support typing" and read receipts.
export default function SupportTicketsPage() {
  const { page, pageSize, onChange } = usePageState();
  const [status, setStatus] = useState<string | undefined>();
  const [activeId, setActiveId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const live = useSocketConnected();

  const { data, isLoading } = useQuery({
    queryKey: ['support-tickets', page, pageSize, status],
    queryFn: () => fetchTickets({ page, limit: pageSize, status }),
  });

  // Any ticket or message change: refresh the list (and the open conversation).
  useEffect(() => {
    const refresh = (p: { ticketId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['support-ticket', String(p.ticketId)] });
    };
    const offTicket = onSocketEvent<SupportTicketEvent>('support:ticket', refresh);
    const offMessage = onSocketEvent<SupportMessageEvent>('support:message', refresh);
    return () => { offTicket(); offMessage(); };
  }, [queryClient]);

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Support Chat</Typography.Title>
        <Tag color={live ? 'green' : 'default'}>{live ? 'Live' : 'Connecting…'}</Tag>
      </Space>

      <div>
        <Select
          placeholder="Filter by status"
          allowClear
          style={{ width: 180, marginBottom: 16 }}
          value={status}
          onChange={setStatus}
          options={['open', 'in_progress', 'resolved', 'closed'].map((s) => ({ value: s, label: titleCase(s) }))}
        />
      </div>

      <Table<SupportTicket>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        onRow={(r) => ({ onClick: () => setActiveId(r._id), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Ticket', render: (_, r) => r.ticketNumber || '—' },
          {
            title: 'Subject',
            render: (_, r) => (
              <Space>
                <Badge count={r.unreadCount || 0} size="small" />
                <span style={{ fontWeight: r.unreadCount ? 600 : 400 }}>{r.subject}</span>
              </Space>
            ),
          },
          {
            title: 'From',
            render: (_, r) => {
              const u = userOf(r);
              return u ? `${u.name} · ${ROLE_LABELS[u.role] || u.role}` : '—';
            },
          },
          { title: 'Status', render: (_, r) => <StatusTag status={r.status} /> },
          { title: 'Last message', render: (_, r) => formatDateTime(r.lastMessageAt || r.createdAt) },
          { title: '', render: (_, r) => <Button size="small" onClick={(e) => { e.stopPropagation(); setActiveId(r._id); }}>Open chat</Button> },
        ]}
      />

      {/* Keyed by ticket, so switching tickets starts with an empty reply box. */}
      <ChatDrawer key={activeId || 'none'} ticketId={activeId} onClose={() => setActiveId(null)} />
    </div>
  );
}

function ChatDrawer({ ticketId, onClose }: { ticketId: string | null; onClose: () => void }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [typingName, setTypingName] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  const { data: ticket } = useQuery({
    queryKey: ['support-ticket', ticketId],
    queryFn: () => fetchTicket(ticketId as string),
    enabled: !!ticketId,
  });
  const messages = ticket?.messages || [];
  const closed = !!ticket && CLOSED.includes(ticket.status);

  // Opening it (and every new message while open) marks it read for support.
  const lastId = messages[messages.length - 1]?._id;
  useEffect(() => {
    if (!ticketId || !lastId) return;
    emitWithAck('support:read', { ticketId }).then((r) => {
      if (!r.ok) markTicketRead(ticketId).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
    });
  }, [ticketId, lastId, queryClient]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [lastId, typingName]);

  // "<name> is typing" from the user, cleared after a few seconds without a new ping.
  useEffect(() => {
    if (!ticketId) return undefined;
    return onSocketEvent<SupportTypingEvent>('support:typing', (p) => {
      if (String(p.ticketId) !== ticketId || p.from !== 'user') return;
      if (typingTimer.current) clearTimeout(typingTimer.current);
      setTypingName(p.typing ? p.name || 'User' : null);
      if (p.typing) typingTimer.current = setTimeout(() => setTypingName(null), 4000);
    });
  }, [ticketId]);

  const statusMutation = useMutation({
    mutationFn: (status: string) => replyToTicket(ticketId as string, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
    },
  });

  const onType = (value: string) => {
    setText(value);
    if (!ticketId || Date.now() - lastTypingSent.current < 2000) return;
    lastTypingSent.current = Date.now();
    void emitWithAck('support:typing', { ticketId, typing: true });
  };

  const send = async () => {
    const body = text.trim();
    if (!ticketId || !body) return;
    setSending(true);
    try {
      const r = await emitWithAck<{ ok: boolean; message?: string }>('support:send', { ticketId, text: body, clientId: `admin-${Date.now()}` });
      if (!r.ok) {
        // Socket down: same reply over REST.
        if (r.message === 'Not connected' || r.message === 'No reply from the server') await replyToTicket(ticketId, { adminReply: body });
        else { message.error(typeof r.message === 'string' ? r.message : 'Could not send'); return; }
      }
      setText('');
      void emitWithAck('support:typing', { ticketId, typing: false });
      queryClient.invalidateQueries({ queryKey: ['support-ticket', ticketId] });
    } catch {
      message.error('Could not send the message');
    } finally {
      setSending(false);
    }
  };

  const u = ticket ? userOf(ticket) : null;
  const order = ticket?.order && typeof ticket.order === 'object' ? ticket.order : null;

  return (
    <Drawer
      title={ticket ? `${ticket.subject}${ticket.ticketNumber ? ` · #${ticket.ticketNumber}` : ''}` : 'Support chat'}
      open={!!ticketId}
      onClose={onClose}
      size="large"
      styles={{ body: { display: 'flex', flexDirection: 'column', padding: 0 } }}
    >
      {ticket && (
        <>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0f0f0' }}>
            <Space wrap>
              <StatusTag status={ticket.status} />
              {u && <Typography.Text>{u.name} · {ROLE_LABELS[u.role] || u.role}{u.phone ? ` · ${u.phone}` : ''}</Typography.Text>}
              {order && <Tag>Order {order.orderNumber}</Tag>}
              {ticket.rating && <Tag color={ticket.rating === 'up' ? 'green' : 'red'}>Rated {ticket.rating === 'up' ? '👍' : '👎'}</Tag>}
            </Space>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 20, background: '#f6f8f7' }}>
            {messages.map((m) => (
              m.sender === 'system' ? (
                <div key={m._id} style={{ textAlign: 'center', color: '#6b7280', fontSize: 12, margin: '10px 0' }}>{m.text} · {timeOf(m.createdAt)}</div>
              ) : (
                <div key={m._id} style={{ display: 'flex', justifyContent: m.sender === 'agent' ? 'flex-end' : 'flex-start', margin: '6px 0' }}>
                  <div style={{
                    maxWidth: '75%', padding: '8px 12px', borderRadius: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    background: m.sender === 'agent' ? '#158a4d' : '#fff', color: m.sender === 'agent' ? '#fff' : '#1f2937',
                    border: m.sender === 'agent' ? 'none' : '1px solid #e5e7eb',
                  }}>
                    <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 2 }}>{m.sender === 'agent' ? (m.senderName || 'Support') : (m.senderName || 'User')} · {timeOf(m.createdAt)}</div>
                    {m.text}
                  </div>
                </div>
              )
            ))}
            {typingName && <div style={{ color: '#6b7280', fontSize: 12, fontStyle: 'italic', marginTop: 6 }}>{typingName} is typing…</div>}
            <div ref={bottomRef} />
          </div>

          <div style={{ padding: 16, borderTop: '1px solid #f0f0f0' }}>
            {closed ? (
              <Space>
                <Typography.Text type="secondary">This ticket is {ticket.status}.</Typography.Text>
                <Button onClick={() => statusMutation.mutate('in_progress')} loading={statusMutation.isPending}>Reopen</Button>
              </Space>
            ) : (
              <>
                <Input.TextArea
                  rows={3}
                  value={text}
                  maxLength={2000}
                  placeholder="Type a reply… (Enter to send, Shift+Enter for a new line)"
                  onChange={(e) => onType(e.target.value)}
                  onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); void send(); } }}
                />
                <Space style={{ marginTop: 10 }}>
                  <Button type="primary" onClick={() => void send()} loading={sending} disabled={!text.trim()}>Send</Button>
                  <Button onClick={() => statusMutation.mutate('resolved')} loading={statusMutation.isPending}>Mark resolved</Button>
                  <Button danger onClick={() => statusMutation.mutate('closed')} loading={statusMutation.isPending}>Close</Button>
                </Space>
              </>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}
