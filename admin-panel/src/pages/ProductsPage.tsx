import { useState } from 'react';
import {
  Table,
  Typography,
  Select,
  Space,
  Button,
  Image,
  Modal,
  Form,
  Input,
  InputNumber,
  Upload,
  Popconfirm,
  App as AntApp,
} from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchProducts, setProductStatus, createProduct, updateProduct, deleteProduct, fetchCategories } from '../api/catalog';
import { fetchStores } from '../api/stores';
import type { Product, Store, Category } from '../types';
import { usePageState } from '../hooks/usePageState';
import StatusTag from '../components/StatusTag';
import { assetUrl, formatCurrency } from '../utils/format';

interface ProductFormValues {
  storeId: string;
  categoryId: string;
  name: string;
  description?: string;
  unit: string;
  price: number;
  discountPrice?: number;
  stockQty: number;
  sku?: string;
}

export default function ProductsPage() {
  const { page, pageSize, onChange } = usePageState();
  const [status, setStatus] = useState<string | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [form] = Form.useForm<ProductFormValues>();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['products', page, pageSize, status],
    queryFn: () => fetchProducts({ page, limit: pageSize, status }),
  });

  const { data: stores } = useQuery({ queryKey: ['all-stores-for-products'], queryFn: () => fetchStores({ limit: 100 }) });
  const { data: categoryTree } = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });
  const flatCategories: Category[] = (categoryTree || []).flatMap((c) => [c, ...(c.children || [])]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['products'] });

  const statusMutation = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: 'active' | 'inactive' }) => setProductStatus(id, newStatus),
    onSuccess: () => {
      message.success('Product status updated');
      invalidate();
    },
  });

  const createMutation = useMutation({
    mutationFn: createProduct,
    onSuccess: () => {
      message.success('Product created');
      invalidate();
      closeModal();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Failed to create product'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) => updateProduct(id, formData),
    onSuccess: () => {
      message.success('Product updated');
      invalidate();
      closeModal();
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Failed to update product'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => {
      message.success('Product deleted');
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

  function openEdit(product: Product) {
    setEditing(product);
    form.setFieldsValue({
      storeId: typeof product.store === 'object' ? (product.store as Store)._id : product.store,
      categoryId: typeof product.category === 'object' ? (product.category as Category)._id : product.category,
      name: product.name,
      description: product.description || undefined,
      unit: product.unit,
      price: product.price,
      discountPrice: product.discountPrice || undefined,
      stockQty: product.stockQty,
      sku: product.sku || undefined,
    });
    setFileList([]);
    setModalOpen(true);
  }

  function handleSubmit(values: ProductFormValues) {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== null) formData.append(key, String(value));
    });
    fileList.forEach((f) => {
      if (f.originFileObj) formData.append('images', f.originFileObj);
    });

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
          Products
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Product
        </Button>
      </Space>

      <Select
        placeholder="Filter by status"
        allowClear
        style={{ width: 180, marginBottom: 16 }}
        value={status}
        onChange={setStatus}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
        ]}
      />

      <Table<Product>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          {
            title: 'Image',
            render: (_, r) => (r.images[0] ? <Image src={assetUrl(r.images[0])} width={40} height={40} style={{ objectFit: 'cover' }} /> : '—'),
          },
          { title: 'Name', dataIndex: 'name' },
          {
            title: 'Store',
            render: (_, r) => (typeof r.store === 'object' ? (r.store as Store).name : r.store),
          },
          { title: 'Price', render: (_, r) => formatCurrency(r.discountPrice || r.price) },
          { title: 'Stock', dataIndex: 'stockQty' },
          { title: 'Status', render: (_, r) => <StatusTag status={r.status} /> },
          {
            title: 'Actions',
            render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => openEdit(r)}>
                  Edit
                </Button>
                {r.status === 'active' ? (
                  <Button size="small" danger onClick={() => statusMutation.mutate({ id: r._id, newStatus: 'inactive' })}>
                    Deactivate
                  </Button>
                ) : (
                  <Button size="small" type="primary" onClick={() => statusMutation.mutate({ id: r._id, newStatus: 'active' })}>
                    Activate
                  </Button>
                )}
                <Popconfirm title="Delete this product?" description="This cannot be undone." onConfirm={() => deleteMutation.mutate(r._id)}>
                  <Button size="small" danger>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
        scroll={{ x: 900 }}
      />

      <Modal
        title={editing ? 'Edit Product' : 'Add Product'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="storeId" label="Store" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Select store"
                options={stores?.items.map((s) => ({ value: s._id, label: s.name }))}
              />
            </Form.Item>
            <Form.Item name="categoryId" label="Category" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Select category"
                options={flatCategories.map((c) => ({ value: c._id, label: c.name }))}
              />
            </Form.Item>
          </Space>

          <Form.Item name="name" label="Product Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>

          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>

          <Space style={{ display: 'flex' }}>
            <Form.Item name="unit" label="Unit" rules={[{ required: true }]} initialValue="pcs" style={{ flex: 1 }}>
              <Input placeholder="kg, pcs, ltr..." />
            </Form.Item>
            <Form.Item name="sku" label="SKU" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>

          <Space style={{ display: 'flex' }}>
            <Form.Item name="price" label="Price" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="discountPrice" label="Discount Price" style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="stockQty" label="Stock Qty" rules={[{ required: true }]} initialValue={0} style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Space>

          <Form.Item label="Images">
            <Upload
              listType="picture-card"
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList: fl }) => setFileList(fl.slice(-5))}
              multiple
              maxCount={5}
            >
              {fileList.length < 5 && (
                <div>
                  <UploadOutlined />
                  <div style={{ marginTop: 8 }}>Upload</div>
                </div>
              )}
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
