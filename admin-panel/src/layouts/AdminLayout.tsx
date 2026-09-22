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
  FileTextOutlined,
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
  // Visible if the user holds ANY one of these (matches backend's OR-of-permissions check).
  permissions?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: <DashboardOutlined /> },
  { key: 'stores', path: '/stores', label: 'Stores', icon: <ShopOutlined />, permissions: [PERMISSIONS.MANAGE_STORES, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY] },
  { key: 'customers', path: '/customers', label: 'Customers', icon: <UserOutlined />, permissions: [PERMISSIONS.MANAGE_ORDERS] },
  { key: 'pickers', path: '/pickers', label: 'Pickers', icon: <TeamOutlined />, permissions: [PERMISSIONS.MANAGE_PICKERS] },
  { key: 'delivery', path: '/delivery-partners', label: 'Delivery Partners', icon: <CarOutlined />, permissions: [PERMISSIONS.MANAGE_DELIVERY] },
  { key: 'categories', path: '/categories', label: 'Categories', icon: <AppstoreOutlined />, permissions: [PERMISSIONS.MANAGE_CATALOG] },
  { key: 'products', path: '/products', label: 'Products', icon: <AppstoreOutlined />, permissions: [PERMISSIONS.MANAGE_CATALOG, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY] },
  { key: 'orders', path: '/orders', label: 'Orders', icon: <ShoppingCartOutlined />, permissions: [PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY] },
  { key: 'inventory', path: '/inventory', label: 'Inventory', icon: <DatabaseOutlined />, permissions: [PERMISSIONS.MANAGE_INVENTORY, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY] },
  { key: 'coupons', path: '/coupons', label: 'Coupons', icon: <TagsOutlined />, permissions: [PERMISSIONS.MANAGE_PROMOTIONS] },
  { key: 'banners', path: '/banners', label: 'Banners', icon: <PictureOutlined />, permissions: [PERMISSIONS.MANAGE_PROMOTIONS] },
  { key: 'payments', path: '/payments', label: 'Payments & Refunds', icon: <CreditCardOutlined />, permissions: [PERMISSIONS.MANAGE_PAYMENTS] },
  { key: 'settlements', path: '/settlements', label: 'Settlements', icon: <WalletOutlined />, permissions: [PERMISSIONS.MANAGE_SETTLEMENTS] },
  { key: 'reports', path: '/reports', label: 'Reports', icon: <BarChartOutlined />, permissions: [PERMISSIONS.VIEW_REPORTS] },
  { key: 'support', path: '/support-tickets', label: 'Support Tickets', icon: <CustomerServiceOutlined />, permissions: [PERMISSIONS.MANAGE_ORDERS] },
  { key: 'settings', path: '/settings', label: 'Settings', icon: <SettingOutlined />, permissions: [PERMISSIONS.MANAGE_SETTINGS] },
  { key: 'content-pages', path: '/content-pages', label: 'Content Pages', icon: <FileTextOutlined />, permissions: [PERMISSIONS.MANAGE_SETTINGS] },
  { key: 'admins', path: '/admins', label: 'Admins & Roles', icon: <SafetyCertificateOutlined />, permissions: [PERMISSIONS.MANAGE_ADMINS] },
  { key: 'activity-logs', path: '/activity-logs', label: 'Activity Logs', icon: <FileSearchOutlined />, permissions: [PERMISSIONS.MANAGE_ADMINS] },
];

// A store-manager (vendor) account holds only MANAGE_OWN_STORE_INVENTORY — everyone else with
// less than '*' is some other restricted staff-admin combination.
function isStoreManager(permissions: string[] | undefined): boolean {
  return !!permissions && permissions.length === 1 && permissions[0] === PERMISSIONS.MANAGE_OWN_STORE_INVENTORY;
}

function roleLabel(permissions: string[] | undefined): string {
  if (!permissions) return 'Staff Admin';
  if (permissions.includes('*')) return 'Super Admin';
  if (isStoreManager(permissions)) return 'Store Manager';
  return 'Staff Admin';
}

export default function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, refreshToken, clear } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const brandLabel = isStoreManager(user?.permissions) ? 'Grovio Vendor' : 'Grovio Admin';

  const visibleItems = useMemo(
    () => NAV_ITEMS.filter((item) => !item.permissions || hasPermission(user?.permissions, ...item.permissions)),
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
          <span className="grovio-logo">{collapsed ? 'G' : brandLabel}</span>
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
                  {roleLabel(user?.permissions)}
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
