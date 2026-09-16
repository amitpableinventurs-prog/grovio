import { useMemo, useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Space, Typography } from 'antd';
import {
  DashboardOutlined,
  ShopOutlined,
  UserOutlined,
  TeamOutlined,
  CarOutlined,
  AppstoreOutlined,
  ShoppingCartOutlined,
  TagsOutlined,
  PictureOutlined,
  SettingOutlined,
  BarChartOutlined,
  CustomerServiceOutlined,
  DatabaseOutlined,
  CreditCardOutlined,
  WalletOutlined,
  SafetyCertificateOutlined,
  FileSearchOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { hasPermission, PERMISSIONS } from '../utils/permissions';
import { logout as logoutApi } from '../api/auth';

const { Header, Sider, Content } = Layout;

interface NavItem {
  key: string;
  path: string;
  label: string;
  icon: React.ReactNode;
  permission?: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: <DashboardOutlined /> },
  { key: 'vendors', path: '/vendors', label: 'Vendors', icon: <ShopOutlined />, permission: PERMISSIONS.MANAGE_VENDORS },
  { key: 'stores', path: '/stores', label: 'Stores', icon: <ShopOutlined />, permission: PERMISSIONS.MANAGE_STORES },
  { key: 'customers', path: '/customers', label: 'Customers', icon: <UserOutlined />, permission: PERMISSIONS.MANAGE_ORDERS },
  { key: 'pickers', path: '/pickers', label: 'Pickers', icon: <TeamOutlined />, permission: PERMISSIONS.MANAGE_PICKERS },
  { key: 'delivery', path: '/delivery-partners', label: 'Delivery Partners', icon: <CarOutlined />, permission: PERMISSIONS.MANAGE_DELIVERY },
  { key: 'categories', path: '/categories', label: 'Categories', icon: <AppstoreOutlined />, permission: PERMISSIONS.MANAGE_CATALOG },
  { key: 'products', path: '/products', label: 'Products', icon: <AppstoreOutlined />, permission: PERMISSIONS.MANAGE_CATALOG },
  { key: 'orders', path: '/orders', label: 'Orders', icon: <ShoppingCartOutlined />, permission: PERMISSIONS.MANAGE_ORDERS },
  { key: 'inventory', path: '/inventory', label: 'Inventory', icon: <DatabaseOutlined />, permission: PERMISSIONS.MANAGE_INVENTORY },
  { key: 'coupons', path: '/coupons', label: 'Coupons', icon: <TagsOutlined />, permission: PERMISSIONS.MANAGE_PROMOTIONS },
  { key: 'banners', path: '/banners', label: 'Banners', icon: <PictureOutlined />, permission: PERMISSIONS.MANAGE_PROMOTIONS },
  { key: 'payments', path: '/payments', label: 'Payments & Refunds', icon: <CreditCardOutlined />, permission: PERMISSIONS.MANAGE_PAYMENTS },
  { key: 'settlements', path: '/settlements', label: 'Settlements', icon: <WalletOutlined />, permission: PERMISSIONS.MANAGE_SETTLEMENTS },
  { key: 'reports', path: '/reports', label: 'Reports', icon: <BarChartOutlined />, permission: PERMISSIONS.VIEW_REPORTS },
  { key: 'support', path: '/support-tickets', label: 'Support Tickets', icon: <CustomerServiceOutlined />, permission: PERMISSIONS.MANAGE_ORDERS },
  { key: 'settings', path: '/settings', label: 'Settings', icon: <SettingOutlined />, permission: PERMISSIONS.MANAGE_SETTINGS },
  { key: 'admins', path: '/admins', label: 'Admins & Roles', icon: <SafetyCertificateOutlined />, permission: PERMISSIONS.MANAGE_ADMINS },
  { key: 'activity-logs', path: '/activity-logs', label: 'Activity Logs', icon: <FileSearchOutlined />, permission: PERMISSIONS.MANAGE_ADMINS },
];

export default function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, refreshToken, clear } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const visibleItems = useMemo(
    () => NAV_ITEMS.filter((item) => !item.permission || hasPermission(user?.permissions, item.permission)),
    [user]
  );

  const selectedKey = useMemo(() => {
    const match = NAV_ITEMS.find((item) => location.pathname.startsWith(item.path));
    return match?.key || 'dashboard';
  }, [location.pathname]);

  async function handleLogout() {
    try {
      if (refreshToken) await logoutApi(refreshToken);
    } catch {
      // ignore network errors on logout — clear local session regardless
    }
    clear();
    navigate('/login', { replace: true });
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} trigger={null} theme="dark" width={240}>
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          <span className="grovio-logo">{collapsed ? 'G' : 'Grovio Admin'}</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={visibleItems.map((item) => ({ key: item.key, icon: item.icon, label: item.label }))}
          onClick={({ key }) => {
            const item = visibleItems.find((i) => i.key === key);
            if (item) navigate(item.path);
          }}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span onClick={() => setCollapsed((c) => !c)} style={{ cursor: 'pointer', fontSize: 18 }}>
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </span>
          <Dropdown
            menu={{
              items: [{ key: 'logout', icon: <LogoutOutlined />, label: 'Logout', onClick: handleLogout }],
            }}
            placement="bottomRight"
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} />
              <div style={{ lineHeight: 1.2 }}>
                <Typography.Text strong style={{ display: 'block' }}>{user?.name}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {user?.permissions?.includes('*') ? 'Super Admin' : 'Staff Admin'}
                </Typography.Text>
              </div>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
