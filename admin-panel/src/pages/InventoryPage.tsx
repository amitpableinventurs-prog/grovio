import { useRef, useState } from 'react';
import { Table, Typography, Switch, InputNumber, Space, Tag, Button, Modal, List, App as AntApp } from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchInventory, downloadInventoryCsv, importInventoryCsv, type ImportInventoryResult } from '../api/inventory';
import type { Product, Store } from '../types';
import { usePageState } from '../hooks/usePageState';

export default function InventoryPage() {
  const { page, pageSize, onChange } = usePageState();
  const [lowStock, setLowStock] = useState(false);
  const [threshold, setThreshold] = useState(5);
  const [exporting, setExporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportInventoryResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', page, pageSize, lowStock, threshold],
    queryFn: () => fetchInventory({ page, limit: pageSize, lowStock: lowStock ? 'true' : undefined, threshold }),
  });

  async function handleExport() {
    setExporting(true);
    try {
      await downloadInventoryCsv();
    } catch {
      message.error('Could not export inventory');
    } finally {
      setExporting(false);
    }
  }

  const importMutation = useMutation({
    mutationFn: (file: File) => importInventoryCsv(file),
    onSuccess: (result) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not import CSV'),
  });

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = ''; // allow re-selecting the same file name
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Inventory
        </Typography.Title>
        <Space>
          <Button icon={<DownloadOutlined />} loading={exporting} onClick={handleExport}>
            Export CSV
          </Button>
          <Button icon={<UploadOutlined />} loading={importMutation.isPending} onClick={() => fileInputRef.current?.click()}>
            Import CSV
          </Button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleFileSelected} />
        </Space>
      </Space>

      <Space style={{ marginBottom: 16 }}>
        <Switch checked={lowStock} onChange={setLowStock} /> Low stock only
        {lowStock && (
          <>
            Threshold: <InputNumber min={1} value={threshold} onChange={(v) => setThreshold(v || 5)} />
          </>
        )}
      </Space>

      <Table<Product>
        rowKey="_id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize, total: data?.meta.totalItems, onChange, showSizeChanger: true }}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'SKU', dataIndex: 'sku', render: (v) => v || '—' },
          { title: 'Store', render: (_, r) => (typeof r.store === 'object' ? (r.store as Store).name : r.store) },
          {
            title: 'Stock Qty',
            render: (_, r) => <Tag color={r.stockQty <= 5 ? 'red' : r.stockQty <= 15 ? 'gold' : 'green'}>{r.stockQty}</Tag>,
          },
          { title: 'Variants', render: (_, r) => (r.variants.length ? `${r.variants.length} variant(s)` : '—') },
          { title: 'Available', render: (_, r) => <Tag color={r.isAvailable ? 'green' : 'red'}>{r.isAvailable ? 'Yes' : 'No'}</Tag> },
        ]}
      />

      <Modal
        title="Import Result"
        open={!!importResult}
        onCancel={() => setImportResult(null)}
        onOk={() => setImportResult(null)}
        footer={[
          <Button key="ok" type="primary" onClick={() => setImportResult(null)}>
            Close
          </Button>,
        ]}
      >
        {importResult && (
          <>
            <Typography.Paragraph>
              <b>{importResult.updated}</b> row(s) updated
              {importResult.errors.length > 0 && (
                <>
                  , <b>{importResult.errors.length}</b> error(s):
                </>
              )}
            </Typography.Paragraph>
            {importResult.errors.length > 0 && (
              <List
                size="small"
                bordered
                dataSource={importResult.errors}
                renderItem={(err) => (
                  <List.Item>
                    Row {err.row}
                    {err.productId ? ` (${err.productId})` : ''}: {err.message}
                  </List.Item>
                )}
                style={{ maxHeight: 300, overflowY: 'auto' }}
              />
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
