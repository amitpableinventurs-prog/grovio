import { Card, Col, Row, Statistic, Typography, Spin } from 'antd';
import {
  ShoppingCartOutlined,
  UserOutlined,
  ShopOutlined,
  CarOutlined,
  TeamOutlined,
  DollarCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboardStats } from '../api/dashboard';
import { formatCurrency } from '../utils/format';

export default function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboardStats });

  if (isLoading || !data) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  const cards = [
    { title: 'GMV', value: formatCurrency(data.gmv), icon: <DollarCircleOutlined />, color: '#16a34a' },
    { title: 'Average Order Value', value: formatCurrency(data.averageOrderValue), icon: <DollarCircleOutlined />, color: '#0891b2' },
    { title: 'Total Orders', value: data.totalOrders, icon: <ShoppingCartOutlined />, color: '#2563eb' },
    { title: 'Delivered Orders', value: data.deliveredOrders, icon: <CheckCircleOutlined />, color: '#16a34a' },
    { title: 'Cancelled Orders', value: data.cancelledOrders, icon: <CloseCircleOutlined />, color: '#dc2626' },
    { title: 'Total Customers', value: data.totalCustomers, icon: <UserOutlined />, color: '#7c3aed' },
    { title: 'Total Vendors', value: data.totalVendors, icon: <ShopOutlined />, color: '#ea580c' },
    { title: 'Pending Vendor Approvals', value: data.pendingVendors, icon: <ShopOutlined />, color: '#ca8a04' },
    { title: 'Active Stores', value: data.activeStores, icon: <ShopOutlined />, color: '#16a34a' },
    { title: 'Active Pickers', value: data.activePickers, icon: <TeamOutlined />, color: '#0891b2' },
    { title: 'Active Delivery Partners', value: data.activeDeliveryPartners, icon: <CarOutlined />, color: '#2563eb' },
    { title: 'Total Products', value: data.totalProducts, icon: <ShopOutlined />, color: '#7c3aed' },
  ];

  return (
    <div>
      <Typography.Title level={3}>Dashboard</Typography.Title>
      <Row gutter={[16, 16]}>
        {cards.map((c) => (
          <Col xs={24} sm={12} md={8} lg={6} key={c.title}>
            <Card>
              <Statistic title={c.title} value={c.value} valueStyle={{ color: c.color }} prefix={c.icon} />
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
