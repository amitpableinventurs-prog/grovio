import { useState } from 'react';
import { Table, Typography, Button, Modal, Form, Input, Select, InputNumber, Switch, Upload, Space, Popconfirm, Image, App as AntApp } from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchBanners, createBanner, updateBanner, deleteBanner } from '../api/banners';
import type { Banner } from '../types';
import { assetUrl } from '../utils/format';

export default function BannersPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Banner | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [form] = Form.useForm();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['banners'], queryFn: fetchBanners });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['banners'] });

  const createMutation = useMutation({
    mutationFn: createBanner,
    onSuccess: () => {
      message.success('Banner created');
      invalidate();
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) => updateBanner(id, formData),
    onSuccess: () => {
      message.success('Banner updated');
      invalidate();
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBanner,
    onSuccess: () => {
      message.success('Banner deleted');
      invalidate();
    },
  });

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    setFileList([]);
    form.resetFields();
  }

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setFileList([]);
    setModalOpen(true);
  }

  function openEdit(banner: Banner) {
    setEditing(banner);
    form.setFieldsValue(banner);
    setFileList([]);
    setModalOpen(true);
  }

  function handleSubmit(values: Record<string, unknown>) {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== null) formData.append(key, String(value));
    });
    if (fileList[0]?.originFileObj) formData.append('image', fileList[0].originFileObj);

    if (editing) {
      updateMutation.mutate({ id: editing._id, formData });
    } else {
      createMutation.mutate(formData);
    }
  }

  return (
    <div>
      <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Banners
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Banner
        </Button>
      </Space>

      <Table<Banner>
        rowKey="_id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        columns={[
          { title: 'Image', render: (_, r) => <Image src={assetUrl(r.image)} width={80} height={40} style={{ objectFit: 'cover' }} /> },
          { title: 'Title', dataIndex: 'title', render: (v) => v || '—' },
          { title: 'Link Type', dataIndex: 'linkType' },
          { title: 'Position', dataIndex: 'position' },
          { title: 'Active', render: (_, r) => (r.isActive ? 'Yes' : 'No') },
          {
            title: 'Actions',
            render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => openEdit(r)}>
                  Edit
                </Button>
                <Popconfirm title="Delete this banner?" onConfirm={() => deleteMutation.mutate(r._id)}>
                  <Button size="small" danger>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? 'Edit Banner' : 'Add Banner'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="title" label="Title">
            <Input />
          </Form.Item>
          <Form.Item name="linkType" label="Link Type" initialValue="none">
            <Select
              options={['product', 'category', 'vendor', 'url', 'none'].map((v) => ({ value: v, label: v }))}
            />
          </Form.Item>
          <Form.Item name="linkValue" label="Link Value (ID or URL)">
            <Input />
          </Form.Item>
          <Form.Item name="position" label="Position" initialValue={0}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="isActive" label="Active" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
          <Form.Item label="Image" required={!editing}>
            <Upload
              listType="picture"
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Select Image</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
