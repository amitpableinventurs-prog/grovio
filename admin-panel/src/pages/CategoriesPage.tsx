import { useState } from 'react';
import { Table, Typography, Button, Modal, Form, Input, Select, Upload, Space, Popconfirm, Tag, App as AntApp, Image } from 'antd';
import { PlusOutlined, UploadOutlined, AppstoreOutlined } from '@ant-design/icons';
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
  const [forcedParent, setForcedParent] = useState<Category | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [form] = Form.useForm<CategoryFormValues>();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['categories'] });

  const createMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      message.success(forcedParent ? 'Subcategory created' : 'Category created');
      invalidate();
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) => updateCategory(id, formData),
    onSuccess: () => {
      message.success('Saved');
      invalidate();
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      message.success('Deleted');
      invalidate();
    },
  });

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    setForcedParent(null);
    setFileList([]);
    form.resetFields();
  }

  // Top-level "Add Category"
  function openCreateCategory() {
    setEditing(null);
    setForcedParent(null);
    form.resetFields();
    setFileList([]);
    setModalOpen(true);
  }

  // "+ Add Subcategory" on a specific parent row
  function openCreateSubcategory(parent: Category) {
    setEditing(null);
    setForcedParent(parent);
    form.resetFields();
    form.setFieldsValue({ parentId: parent._id });
    setFileList([]);
    setModalOpen(true);
  }

  function openEdit(category: Category) {
    setEditing(category);
    setForcedParent(null);
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

  const topLevelOptions = (data || []).map((c) => ({ value: c._id, label: c.name }));

  function modalTitle() {
    if (editing) return editing.parent ? 'Edit Subcategory' : 'Edit Category';
    if (forcedParent) return `Add Subcategory to "${forcedParent.name}"`;
    return 'Add Category';
  }

  return (
    <div>
      <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Categories
          </Typography.Title>
          <Typography.Text type="secondary">Click the arrow next to a category to see/manage its subcategories.</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateCategory}>
          Add Category
        </Button>
      </Space>

      <Table<Category>
        rowKey="_id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        expandable={{
          childrenColumnName: 'children',
          defaultExpandAllRows: true,
          rowExpandable: (r) => !!r.children?.length,
        }}
        columns={[
          {
            title: 'Image',
            width: 70,
            render: (_, r) => (r.image ? <Image src={assetUrl(r.image)} width={40} height={40} style={{ objectFit: 'cover' }} /> : '—'),
          },
          { title: 'Name', dataIndex: 'name' },
          {
            title: 'Type',
            width: 130,
            render: (_, r) =>
              r.parent ? (
                <Tag>Subcategory</Tag>
              ) : (
                <Tag icon={<AppstoreOutlined />} color="blue">
                  Category
                </Tag>
              ),
          },
          { title: 'Status', width: 110, render: (_, r) => <StatusTag status={r.status} /> },
          {
            title: 'Subcategories',
            width: 120,
            render: (_, r) => (r.parent ? '—' : r.children?.length || 0),
          },
          {
            title: 'Actions',
            render: (_, r) => (
              <Space>
                {!r.parent && (
                  <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => openCreateSubcategory(r)}>
                    Add Subcategory
                  </Button>
                )}
                <Button size="small" onClick={() => openEdit(r)}>
                  Edit
                </Button>
                <Popconfirm
                  title={r.parent ? 'Delete this subcategory?' : 'Delete this category?'}
                  description={!r.parent && r.children?.length ? `It has ${r.children.length} subcategory(ies) — they won't be deleted automatically.` : undefined}
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

      <Modal
        title={modalTitle()}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="parentId" label="Parent Category">
            <Select
              allowClear
              placeholder="None (this is a top-level category)"
              disabled={!!forcedParent}
              options={topLevelOptions}
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
