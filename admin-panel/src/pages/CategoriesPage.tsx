import { useState } from 'react';
import { Table, Typography, Button, Modal, Form, Input, Select, Upload, Space, Popconfirm, App as AntApp, Image } from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchCategories, createCategory, updateCategory, deleteCategory } from '../api/catalog';
import type { Category } from '../types';
import StatusTag from '../components/StatusTag';
import { assetUrl } from '../utils/format';

interface CategoryFormValues {
  name: string;
  parentId?: string;
  status?: string;
}

export default function CategoriesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [form] = Form.useForm<CategoryFormValues>();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['categories'] });

  const createMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      message.success('Category created');
      invalidate();
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) => updateCategory(id, formData),
    onSuccess: () => {
      message.success('Category updated');
      invalidate();
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      message.success('Category deleted');
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

  function openEdit(category: Category) {
    setEditing(category);
    form.setFieldsValue({ name: category.name, parentId: category.parent || undefined, status: category.status });
    setFileList([]);
    setModalOpen(true);
  }

  function handleSubmit(values: CategoryFormValues) {
    const formData = new FormData();
    formData.append('name', values.name);
    if (values.parentId) formData.append('parentId', values.parentId);
    if (values.status) formData.append('status', values.status);
    if (fileList[0]?.originFileObj) formData.append('image', fileList[0].originFileObj);

    if (editing) {
      updateMutation.mutate({ id: editing._id, formData });
    } else {
      createMutation.mutate(formData);
    }
  }

  const flatRows: Category[] = (data || []).flatMap((parent) => [parent, ...(parent.children || [])]);

  return (
    <div>
      <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Categories
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Category
        </Button>
      </Space>

      <Table<Category>
        rowKey="_id"
        loading={isLoading}
        dataSource={flatRows}
        pagination={false}
        columns={[
          {
            title: 'Image',
            render: (_, r) => (r.image ? <Image src={assetUrl(r.image)} width={40} height={40} style={{ objectFit: 'cover' }} /> : '—'),
          },
          { title: 'Name', render: (_, r) => (r.parent ? `— ${r.name}` : r.name) },
          { title: 'Status', render: (_, r) => <StatusTag status={r.status} /> },
          {
            title: 'Actions',
            render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => openEdit(r)}>
                  Edit
                </Button>
                <Popconfirm title="Delete this category?" onConfirm={() => deleteMutation.mutate(r._id)}>
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
        title={editing ? 'Edit Category' : 'Add Category'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="parentId" label="Parent Category (optional)">
            <Select
              allowClear
              placeholder="None (top-level category)"
              options={(data || []).map((c) => ({ value: c._id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item name="status" label="Status" initialValue="active">
            <Select
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </Form.Item>
          <Form.Item label="Image">
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
