import { useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Button,
  Select,
  Segmented,
  Input,
  Drawer,
  Descriptions,
  Image,
  Tag,
  Popconfirm,
  Alert,
  App as AntApp,
} from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchUsersByRole, fetchUserDetail, updatePickerStatus, assignPickerToStore, toggleUserActive } from '../api/users';
import { fetchStores } from '../api/stores';
import type { UserWithProfile, Store, PickerOnboarding } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import { assetUrl, formatDateTime, titleCase } from '../utils/format';

type StatusFilter = 'all' | 'pending' | 'approved' | 'blocked';

// Mirrors onboarding.nextStep from the backend (utils/pickerOnboarding.js) — what a self-registered
// picker has done so far in the app: OTP signup -> Register (name/email/gender/DOB) -> KYC upload.
const ONBOARDING_TAG: Record<PickerOnboarding['nextStep'], { label: string; color: string }> = {
  profile: { label: 'Register pending', color: 'default' },
  kyc: { label: 'KYC pending', color: 'gold' },
  pending_approval: { label: 'Ready for review', color: 'blue' },
  home: { label: 'Approved', color: 'green' },
  blocked: { label: 'Blocked', color: 'red' },
};

function OnboardingTag({ onboarding }: { onboarding?: PickerOnboarding }) {
  if (!onboarding) return <>—</>;
  const { label, color } = ONBOARDING_TAG[onboarding.nextStep];
  return <Tag color={color}>{label}</Tag>;
}

// Stored as UTC midnight (see pickerAuth.controller.js#parseDateOfBirth) — format in UTC so the
// day never shifts with the viewer's timezone.
function formatDob(value?: string | null): string {
  if (!value) return '—';
  const dob = new Date(value);
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return `${dob.toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })} (${age} yrs)`;
}

const orDash = (value?: string | null) => value || '—';

export default function PickersPage() {
  const { page, pageSize, setPage, onChange } = usePageState();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['pickers', page, pageSize, statusFilter, search],
    queryFn: () =>
      fetchUsersByRole('picker', {
        page,
        limit: pageSize,
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: search || undefined,
      }),
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['picker-detail', detailId],
    queryFn: () => fetchUserDetail(detailId as string),
    enabled: !!detailId,
  });

  const { data: stores } = useQuery({ queryKey: ['all-stores'], queryFn: () => fetchStores({ limit: 100 }) });

  const refreshPickers = () => {
    queryClient.invalidateQueries({ queryKey: ['pickers'] });
    queryClient.invalidateQueries({ queryKey: ['picker-detail'] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updatePickerStatus(id, status),
    onSuccess: (_, { status }) => {
      message.success(status === 'approved' ? 'Picker approved' : `Picker ${status}`);
      refreshPickers();
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, storeId }: { id: string; storeId: string }) => assignPickerToStore(id, storeId),
    onSuccess: () => {
      message.success('Picker linked to store');
      refreshPickers();
    },
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => toggleUserActive(id, isActive),
    onSuccess: () => {
      message.success('Updated');
      refreshPickers();
    },
  });

  const storeIdOf = (r: UserWithProfile) =>
    typeof r.pickerProfile?.store === 'string' ? r.pickerProfile.store : (r.pickerProfile?.store as Store | null | undefined)?._id;

  // Approving a picker who hasn't finished the Register/KYC steps is allowed (e.g. KYC collected
  // offline) but asks for confirmation first.
  const renderStatusActions = (r: UserWithProfile) => {
    const status = r.pickerProfile?.status;
    const approve = () => statusMutation.mutate({ id: r._id, status: 'approved' });
    const missing = r.onboarding && !r.onboarding.profileComplete ? 'Register details' : r.onboarding && !r.onboarding.kycComplete ? 'KYC documents' : null;

    return (
      <>
        {status !== 'approved' && status !== 'blocked' &&
          (missing ? (
            <Popconfirm title={`${missing} not submitted yet`} description="Approve this picker anyway?" okText="Approve" onConfirm={approve}>
              <Button size="small" type="primary">Approve</Button>
            </Popconfirm>
          ) : (
            <Button size="small" type="primary" onClick={approve}>Approve</Button>
          ))}
        {status !== 'blocked' ? (
          <Popconfirm title="Block this picker?" description="They won't be assigned any pick jobs." okText="Block" okButtonProps={{ danger: true }} onConfirm={() => statusMutation.mutate({ id: r._id, status: 'blocked' })}>
            <Button size="small" danger>Block</Button>
          </Popconfirm>
        ) : (
          <Button size="small" onClick={approve}>Unblock</Button>
        )}
      </>
    );
  };

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Pickers</Typography.Title>
        <Space wrap>
          <Segmented<StatusFilter>
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Pending approval', value: 'pending' },
              { label: 'Approved', value: 'approved' },
              { label: 'Blocked', value: 'blocked' },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="Search name, phone or email"
            style={{ width: 260 }}
            onSearch={(value) => {
              setSearch(value.trim());
              setPage(1);
            }}
          />
        </Space>
      </Space>

      <Table<UserWithProfile>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: 'Name',
            render: (_, r) => (
              <div>
                <Typography.Link onClick={() => setDetailId(r._id)}>{r.name}</Typography.Link>
                {r.email && <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{r.email}</Typography.Text>}
              </div>
            ),
          },
          { title: 'Phone', dataIndex: 'phone' },
          { title: 'Onboarding', render: (_, r) => <OnboardingTag onboarding={r.onboarding} /> },
          { title: 'Status', render: (_, r) => (r.pickerProfile ? <StatusTag status={r.pickerProfile.status} /> : '—') },
          {
            title: 'Available',
            render: (_, r) => <StatusTag status={r.pickerProfile?.isAvailable ? 'active' : 'inactive'} />,
          },
          {
            title: 'Assigned Store',
            render: (_, r) => (
              <Select
                style={{ width: 200 }}
                placeholder="Assign a store"
                value={storeIdOf(r)}
                options={stores?.items.map((s) => ({ value: s._id, label: s.name }))}
                onChange={(storeId) => assignMutation.mutate({ id: r._id, storeId })}
              />
            ),
          },
          { title: 'Joined', render: (_, r) => formatDateTime(r.createdAt) },
          {
            title: 'Actions',
            render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => setDetailId(r._id)}>View</Button>
                {renderStatusActions(r)}
                <Button size="small" onClick={() => activeMutation.mutate({ id: r._id, isActive: !r.isActive })}>
                  {r.isActive ? 'Disable Login' : 'Enable Login'}
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title={detail ? detail.name : 'Picker'}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        width={560}
        loading={detailLoading}
        extra={detail && <Space>{renderStatusActions(detail)}</Space>}
      >
        {detail && (
          <>
            {detail.onboarding?.nextStep === 'pending_approval' && (
              <Alert type="info" showIcon style={{ marginBottom: 16 }} message="All onboarding details submitted — review the KYC document below and approve." />
            )}
            {detail.onboarding && !detail.onboarding.profileComplete && detail.pickerProfile?.status === 'pending' && (
              <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="The picker hasn't completed the Register step in the app yet." />
            )}

            <Descriptions title="Personal details" column={1} bordered size="small" style={{ marginBottom: 24 }}>
              <Descriptions.Item label="Name">{detail.name}</Descriptions.Item>
              <Descriptions.Item label="Mobile">{orDash(detail.phone)}</Descriptions.Item>
              <Descriptions.Item label="Email">{orDash(detail.email)}</Descriptions.Item>
              <Descriptions.Item label="Gender">{detail.gender ? titleCase(detail.gender) : '—'}</Descriptions.Item>
              <Descriptions.Item label="Date of birth">{formatDob(detail.dateOfBirth)}</Descriptions.Item>
              <Descriptions.Item label="Registered">{formatDateTime(detail.createdAt)}</Descriptions.Item>
            </Descriptions>

            <Descriptions title="KYC" column={1} bordered size="small" style={{ marginBottom: 24 }}>
              <Descriptions.Item label="ID proof type">{orDash(detail.pickerProfile?.idProofType)}</Descriptions.Item>
              <Descriptions.Item label="ID proof number">{orDash(detail.pickerProfile?.idProofNumber)}</Descriptions.Item>
              <Descriptions.Item label="ID proof document">
                {detail.pickerProfile?.idProofDocument ? (
                  <Image src={assetUrl(detail.pickerProfile.idProofDocument)} width={220} style={{ objectFit: 'contain' }} />
                ) : (
                  <Typography.Text type="secondary">Not uploaded</Typography.Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Address">{orDash(detail.pickerProfile?.address)}</Descriptions.Item>
              <Descriptions.Item label="Emergency contact">
                {detail.pickerProfile?.emergencyContactName
                  ? `${detail.pickerProfile.emergencyContactName}${detail.pickerProfile.emergencyContactPhone ? ` · ${detail.pickerProfile.emergencyContactPhone}` : ''}`
                  : '—'}
              </Descriptions.Item>
            </Descriptions>

            <Descriptions title="Account" column={1} bordered size="small">
              <Descriptions.Item label="Status">
                {detail.pickerProfile ? <StatusTag status={detail.pickerProfile.status} /> : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Onboarding"><OnboardingTag onboarding={detail.onboarding} /></Descriptions.Item>
              <Descriptions.Item label="Online">
                <StatusTag status={detail.pickerProfile?.onlineStatus === 'online' ? 'active' : 'inactive'} />
              </Descriptions.Item>
              <Descriptions.Item label="Assigned store">
                {stores?.items.find((s) => s._id === storeIdOf(detail))?.name ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Employee ID">{orDash(detail.pickerProfile?.employeeId)}</Descriptions.Item>
              <Descriptions.Item label="Login">{detail.isActive ? 'Enabled' : 'Disabled'}</Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Drawer>
    </div>
  );
}
