import { Typography, Tabs, Row, Col, Statistic, Card, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  fetchSalesReport,
  fetchVendorCommissionReport,
  fetchProductReport,
  fetchCustomerReport,
  fetchDeliveryReport,
} from '../api/reports';
import { formatCurrency } from '../utils/format';

function SalesTab() {
  const { data, isLoading } = useQuery({ queryKey: ['report-sales'], queryFn: () => fetchSalesReport() });
  return (
    <Row gutter={16}>
      <Col span={8}>
        <Card loading={isLoading}>
          <Statistic title="Total Orders" value={data?.totalOrders || 0} />
        </Card>
      </Col>
      <Col span={8}>
        <Card loading={isLoading}>
          <Statistic title="Total Revenue" value={formatCurrency(data?.totalRevenue)} />
        </Card>
      </Col>
      <Col span={8}>
        <Card loading={isLoading}>
          <Statistic title="Total Item Sales" value={formatCurrency(data?.totalItemSales)} />
        </Card>
      </Col>
    </Row>
  );
}

function VendorCommissionTab() {
  const { data, isLoading } = useQuery({ queryKey: ['report-vendor-commission'], queryFn: fetchVendorCommissionReport });
  return (
    <Table
      rowKey="vendorId"
      loading={isLoading}
      dataSource={data}
      pagination={false}
      columns={[
        { title: 'Vendor', dataIndex: 'businessName' },
        { title: 'Orders', dataIndex: 'totalOrders' },
        { title: 'Total Sales', render: (_, r) => formatCurrency(r.totalSales) },
        { title: 'Commission %', dataIndex: 'commissionPercent' },
        { title: 'Commission Amount', render: (_, r) => formatCurrency(r.commissionAmount) },
        { title: 'Payout Amount', render: (_, r) => formatCurrency(r.payoutAmount) },
      ]}
    />
  );
}

function ProductsTab() {
  const { data, isLoading } = useQuery({ queryKey: ['report-products'], queryFn: fetchProductReport });
  return (
    <Table
      rowKey="_id"
      loading={isLoading}
      dataSource={data}
      pagination={false}
      columns={[
        { title: 'Product', dataIndex: 'name' },
        { title: 'Qty Sold', dataIndex: 'qtySold' },
        { title: 'Revenue', render: (_, r) => formatCurrency(r.revenue) },
      ]}
    />
  );
}

function CustomersTab() {
  const { data, isLoading } = useQuery({ queryKey: ['report-customers'], queryFn: fetchCustomerReport });
  return (
    <Table
      rowKey="customerId"
      loading={isLoading}
      dataSource={data}
      pagination={false}
      columns={[
        { title: 'Customer', dataIndex: 'name' },
        { title: 'Phone', dataIndex: 'phone' },
        { title: 'Total Orders', dataIndex: 'totalOrders' },
        { title: 'Total Spend', render: (_, r) => formatCurrency(r.totalSpend) },
      ]}
    />
  );
}

function DeliveryTab() {
  const { data, isLoading } = useQuery({ queryKey: ['report-delivery'], queryFn: fetchDeliveryReport });
  return (
    <Table
      rowKey="deliveryPartnerId"
      loading={isLoading}
      dataSource={data}
      pagination={false}
      columns={[
        { title: 'Delivery Partner', dataIndex: 'name' },
        { title: 'Phone', dataIndex: 'phone' },
        { title: 'Total Deliveries', dataIndex: 'totalDeliveries' },
        { title: 'Total Delivery Fees Earned', render: (_, r) => formatCurrency(r.totalDeliveryFees) },
      ]}
    />
  );
}

export default function ReportsPage() {
  return (
    <div>
      <Typography.Title level={3}>Reports</Typography.Title>
      <Tabs
        items={[
          { key: 'sales', label: 'Sales', children: <SalesTab /> },
          { key: 'vendor', label: 'Vendor Commission', children: <VendorCommissionTab /> },
          { key: 'products', label: 'Products', children: <ProductsTab /> },
          { key: 'customers', label: 'Customers', children: <CustomersTab /> },
          { key: 'delivery', label: 'Delivery Partners', children: <DeliveryTab /> },
        ]}
      />
    </div>
  );
}
