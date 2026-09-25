import { useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Button,
  Modal,
  Form,
  Input,
  Popconfirm,
  Segmented,
  Drawer,
  Descriptions,
  Image,
  Tag,
  Alert,
  Divider,
  App as AntApp,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchUsersByRole,
  fetchUserDetail,
  updateDeliveryStatus,
  toggleUserActive,
  createDeliveryPartner,
  updateDeliveryPartner,
  deleteDeliveryPartner,
  type DeliveryPartnerInput,
} from '../api/users';
import type { DeliveryOnboarding, DeliveryPartner } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import { assetUrl, formatDateTime, titleCase } from '../utils/format';

type StatusFilter = 'all' | 'pending' | 'approved' | 'blocked';

// Mirrors onboarding.nextStep from the backend (utils/deliveryOnboarding.js) — how far a
// self-registered partner has got in the app: vehicle -> PAN/Aadhaar -> address proof -> selfie ->
// bank details.
const ONBOARDING_TAG: Record<DeliveryOnboarding['nextStep'], { label: string; color: string }> = {
  vehicle: { label: 'Vehicle pending', color: 'default' },
  identity: { label: 'PAN / Aadhaar pending', color: 'gold' },
  addressProof: { label: 'Address proof pending', color: 'gold' },
  selfie: { label: 'Selfie pending', color: 'gold' },
  bank: { label: 'Bank details pending', color: 'gold' },
  pending_approval: { label: 'Ready for review', color: 'blue' },
  home: { label: 'Approved', color: 'green' },
  blocked: { label: 'Blocked', color: 'red' },
};

function OnboardingTag({ onboarding }: { onboarding?: DeliveryOnboarding }) {
  if (!onboarding) return <>—</>;
  const { label, color } = ONBOARDING_TAG[onboarding.nextStep];
  const inProgress = onboarding.nextStep !== 'home' && onboarding.nextStep !== 'blocked';
  return (
    <Tag color={color}>
      {label}
      {inProgress ? ` · ${onboarding.completedSteps}/${onboarding.totalSteps}` : ''}
    </Tag>
  );
}

// Stored as UTC midnight — format in UTC so the day never shifts with the viewer's timezone.
function formatDob(value?: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function DocImage({ path, label }: { path?: string | null; label: string }) {
  return path ? (
    <Image src={assetUrl(path)} width={220} style={{ objectFit: 'contain' }} alt={label} />
  ) : (
    <Typography.Text type="secondary">Not uploaded</Typography.Text>
  );
}

const orDash = (value?: string | null) => value || '—';

const ID_TITLE = { pan: 'PAN', aadhaar: 'Aadhaar' } as const;

export default function DeliveryPartnersPage() {
  const { page, pageSize, onChange } = usePageState();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryPartner | null>(null);
  const [form] = Form.useForm<DeliveryPartnerInput>();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-partners', page, pageSize, statusFilter],
    queryFn: () =>
      fetchUsersByRole<DeliveryPartner>('delivery', {
        page,
        limit: pageSize,
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      }),
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['delivery-partner-detail', detailId],
    queryFn: () => fetchUserDetail<DeliveryPartner>(detailId as string),
    enabled: !!detailId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['delivery-partners'] });
    queryClient.invalidateQueries({ queryKey: ['delivery-partner-detail'] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateDeliveryStatus(id, status),
    onSuccess: () => {
      message.success('Delivery partner status updated');
      invalidate();
    },
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => toggleUserActive(id, isActive),
    onSuccess: () => {
      message.success('Updated');
      invalidate();
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: DeliveryPartnerInput) => createDeliveryPartner(values),
    onSuccess: () => {
      message.success('Delivery partner created');
      closeForm();
      invalidate();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not create delivery partner'),
  });

  const updateMutation = useMutation({
    mutationFn: (values: DeliveryPartnerInput) => updateDeliveryPartner(editing!._id, values),
    onSuccess: () => {
      message.success('Delivery partner updated');
      closeForm();
      invalidate();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not update delivery partner'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDeliveryPartner(id),
    onSuccess: () => {
      message.success('Delivery partner deleted');
      invalidate();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not delete delivery partner'),
  });

  // Approving a partner who hasn't finished onboarding in the app is allowed (e.g. documents
  // checked offline) but asks for confirmation first.
  const renderStatusActions = (r: DeliveryPartner) => {
    const status = r.deliveryProfile?.status;
    const approve = () => statusMutation.mutate({ id: r._id, status: 'approved' });
    const incomplete = !!r.onboarding && r.onboarding.completedSteps < r.onboarding.totalSteps;

    return (
      <>
        {status !== 'approved' && status !== 'blocked' &&
          (incomplete ? (
            <Popconfirm title="Onboarding not finished in the app" description="Approve this delivery partner anyway?" okText="Approve" onConfirm={approve}>
              <Button size="small" type="primary">Approve</Button>
            </Popconfirm>
          ) : (
            <Button size="small" type="primary" onClick={approve}>Approve</Button>
          ))}
        {status !== 'blocked' ? (
          <Popconfirm
            title="Block this delivery partner?"
            description="They won't be assigned any delivery jobs."
            okText="Block"
            okButtonProps={{ danger: true }}
            onConfirm={() => statusMutation.mutate({ id: r._id, status: 'blocked' })}
          >
            <Button size="small" danger>Block</Button>
          </Popconfirm>
        ) : (
          <Button size="small" onClick={() => statusMutation.mutate({ id: r._id, status: 'approved' })}>
            Unblock
          </Button>
        )}
      </>
    );
  };

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setFormOpen(true);
  }

  function openEdit(record: DeliveryPartner) {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      email: record.email ?? undefined,
      vehicleType: record.deliveryProfile?.vehicleType ?? undefined,
      vehicleNumber: record.deliveryProfile?.vehicleNumber ?? undefined,
      licenseNumber: record.deliveryProfile?.licenseNumber ?? undefined,
      bankDetails: {
        accountHolderName: record.deliveryProfile?.bankDetails?.accountHolderName ?? undefined,
        accountNumber: record.deliveryProfile?.bankDetails?.accountNumber ?? undefined,
        ifsc: record.deliveryProfile?.bankDetails?.ifsc ?? undefined,
        bankName: record.deliveryProfile?.bankDetails?.bankName ?? undefined,
      },
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    form.resetFields();
  }

  function handleSubmit(values: DeliveryPartnerInput) {
    if (editing) updateMutation.mutate(values);
    else createMutation.mutate(values);
  }

  const profile = detail?.deliveryProfile;
  const kyc = profile?.kyc;

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Delivery Partners
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Delivery Partner
        </Button>
      </Space>

      <Segmented<StatusFilter>
        style={{ marginBottom: 16 }}
        value={statusFilter}
        onChange={(v) => {
          setStatusFilter(v);
          onChange(1, pageSize);
        }}
        options={[
          { label: 'All', value: 'all' },
          { label: 'Pending', value: 'pending' },
          { label: 'Approved', value: 'approved' },
          { label: 'Blocked', value: 'blocked' },
        ]}
      />

      <Table<DeliveryPartner>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Phone', dataIndex: 'phone' },
          { title: 'Vehicle', render: (_, r) => (r.deliveryProfile?.vehicleType ? titleCase(r.deliveryProfile.vehicleType) : '—') },
          { title: 'Vehicle No.', render: (_, r) => r.deliveryProfile?.vehicleNumber || '—' },
          { title: 'Status', render: (_, r) => (r.deliveryProfile ? <StatusTag status={r.deliveryProfile.status} /> : '—') },
          { title: 'Onboarding', render: (_, r) => <OnboardingTag onboarding={r.onboarding} /> },
          { title: 'Available', render: (_, r) => <StatusTag status={r.deliveryProfile?.isAvailable ? 'active' : 'inactive'} /> },
          {
            title: 'Actions',
            render: (_, r) => (
              <Space wrap>
                <Button size="small" onClick={() => setDetailId(r._id)}>
                  View KYC
                </Button>
                {renderStatusActions(r)}
                <Button size="small" onClick={() => activeMutation.mutate({ id: r._id, isActive: !r.isActive })}>
                  {r.isActive ? 'Disable Login' : 'Enable Login'}
                </Button>
                <Button size="small" onClick={() => openEdit(r)}>
                  Edit
                </Button>
                <Popconfirm
                  title="Delete this delivery partner?"
                  description="Refused if a job is still in progress with them."
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => deleteMutation.mutate(r._id)}
                >
                  <Button size="small" danger>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title={detail ? detail.name : 'Delivery partner'}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        width={560}
        loading={detailLoading}
        extra={detail && <Space>{renderStatusActions(detail)}</Space>}
      >
        {detail && (
          <>
            {detail.onboarding?.nextStep === 'pending_approval' && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="All onboarding steps submitted — check the documents below match, then approve."
              />
            )}
            {detail.onboarding && detail.onboarding.completedSteps < detail.onboarding.totalSteps && profile?.status === 'pending' && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message={`Still onboarding in the app — ${ONBOARDING_TAG[detail.onboarding.nextStep].label.toLowerCase()}.`}
              />
            )}

            <Descriptions title="Account" column={1} bordered size="small" style={{ marginBottom: 24 }}>
              <Descriptions.Item label="Name">{detail.name}</Descriptions.Item>
              <Descriptions.Item label="Mobile">{orDash(detail.phone)}</Descriptions.Item>
              <Descriptions.Item label="Status">{profile ? <StatusTag status={profile.status} /> : '—'}</Descriptions.Item>
              <Descriptions.Item label="Onboarding"><OnboardingTag onboarding={detail.onboarding} /></Descriptions.Item>
              <Descriptions.Item label="Submitted">{formatDateTime(profile?.onboardingCompletedAt)}</Descriptions.Item>
              <Descriptions.Item label="Registered">{formatDateTime(detail.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="Login">{detail.isActive ? 'Enabled' : 'Disabled'}</Descriptions.Item>
            </Descriptions>

            <Descriptions title="Vehicle" column={1} bordered size="small" style={{ marginBottom: 24 }}>
              <Descriptions.Item label="Type">{profile?.vehicleType ? titleCase(profile.vehicleType) : '—'}</Descriptions.Item>
              <Descriptions.Item label="Number">{orDash(profile?.vehicleNumber)}</Descriptions.Item>
              <Descriptions.Item label="Licence">{orDash(profile?.licenseNumber)}</Descriptions.Item>
            </Descriptions>

            <Descriptions
              title={kyc?.idType ? ID_TITLE[kyc.idType] : 'Identity proof'}
              column={1}
              bordered
              size="small"
              style={{ marginBottom: 24 }}
            >
              <Descriptions.Item label="Number">{orDash(kyc?.idNumber)}</Descriptions.Item>
              <Descriptions.Item label="Name on card">{orDash(kyc?.fullName)}</Descriptions.Item>
              <Descriptions.Item label="Gender">{kyc?.gender ? titleCase(kyc.gender) : '—'}</Descriptions.Item>
              <Descriptions.Item label="Father's name">{orDash(kyc?.fatherName)}</Descriptions.Item>
              <Descriptions.Item label="Date of birth">{formatDob(kyc?.dateOfBirth)}</Descriptions.Item>
              <Descriptions.Item label="Card photo"><DocImage path={kyc?.document} label="ID card" /></Descriptions.Item>
            </Descriptions>

            <Descriptions title="Address proof" column={1} bordered size="small" style={{ marginBottom: 24 }}>
              <Descriptions.Item label="Front"><DocImage path={profile?.addressProof?.frontImage} label="Address proof front" /></Descriptions.Item>
              <Descriptions.Item label="Back"><DocImage path={profile?.addressProof?.backImage} label="Address proof back" /></Descriptions.Item>
            </Descriptions>

            <Descriptions title="Selfie" column={1} bordered size="small" style={{ marginBottom: 24 }}>
              <Descriptions.Item label="Photo"><DocImage path={profile?.selfie?.image} label="Selfie" /></Descriptions.Item>
            </Descriptions>

            <Descriptions title="Bank details (payouts)" column={1} bordered size="small">
              <Descriptions.Item label="Account holder">{orDash(profile?.bankDetails?.accountHolderName)}</Descriptions.Item>
              <Descriptions.Item label="Account number">{orDash(profile?.bankDetails?.accountNumber)}</Descriptions.Item>
              <Descriptions.Item label="IFSC">{orDash(profile?.bankDetails?.ifsc)}</Descriptions.Item>
              <Descriptions.Item label="Bank">{orDash(profile?.bankDetails?.bankName)}</Descriptions.Item>
              <Descriptions.Item label="Cheque / passbook"><DocImage path={profile?.bankDetails?.document} label="Cancelled cheque or passbook" /></Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Drawer>

      <Modal
        title={editing ? 'Edit Delivery Partner' : 'Add Delivery Partner'}
        open={formOpen}
        onCancel={closeForm}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Full Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {!editing && (
            <Form.Item name="phone" label="Phone" rules={[{ required: true, message: 'Phone is required' }]}>
              <Input placeholder="e.g. 9876543210" />
            </Form.Item>
          )}
          <Form.Item name="email" label="Email (optional)">
            <Input type="email" />
          </Form.Item>
          <Form.Item name="vehicleType" label="Vehicle Type">
            <Input placeholder="motorcycle, bicycle or electric_scooter" />
          </Form.Item>
          <Form.Item name="vehicleNumber" label="Vehicle Number">
            <Input placeholder="e.g. MP20AB1234" />
          </Form.Item>
          <Form.Item name="licenseNumber" label="License Number">
            <Input />
          </Form.Item>

          <Divider titlePlacement="start" plain>Bank details (for payouts)</Divider>
          <Form.Item name={['bankDetails', 'accountHolderName']} label="Account Holder Name">
            <Input />
          </Form.Item>
          <Form.Item
            name={['bankDetails', 'accountNumber']}
            label="Account Number"
            rules={[{ pattern: /^[0-9]{9,18}$/, message: 'Enter 9–18 digits' }]}
          >
            <Input inputMode="numeric" />
          </Form.Item>
          <Form.Item
            name={['bankDetails', 'ifsc']}
            label="IFSC Code"
            normalize={(v?: string) => v?.toUpperCase()}
            rules={[{ pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/, message: 'Enter a valid IFSC code (e.g. SBIN0001234)' }]}
          >
            <Input placeholder="e.g. SBIN0001234" />
          </Form.Item>
          <Form.Item name={['bankDetails', 'bankName']} label="Bank Name">
            <Input placeholder="e.g. State Bank of India" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
