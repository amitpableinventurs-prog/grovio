import { useEffect, useMemo, useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Space, Typography, Badge, Tooltip, Alert } from 'antd';
import {
  DashboardOutlined,
  ShopOutlined,
  UserOutlined,
  AppstoreOutlined,
  ShoppingCartOutlined,
  DatabaseOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { fetchMe, logout as logoutApi } from '../api/auth';
import { useOrderRealtime } from '../realtime/useOrderRealtime';
import { useSocketConnected } from '../realtime/socket';

const { Header, Sider, Content } = Layout;

const NAV_ITEMS = [
  { key: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: <DashboardOutlined /> },
  { key: 'orders', path: '/orders', label: 'Orders', icon: <ShoppingCartOutlined /> },
  { key: 'products', path: '/products', label: 'Products', icon: <AppstoreOutlined /> },
  { key: 'inventory', path: '/inventory', label: 'Inventory', icon: <DatabaseOutlined /> },
  { key: 'store', path: '/store', label: 'My Store', icon: <ShopOutlined /> },
];

export default function VendorLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, store, refreshToken, clear, setProfile } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const live = useSocketConnected();
  useOrderRealtime();

  // Keeps the header and the approval banner current (e.g. after the admin approves the store).
  const { data: me } = useQuery({ queryKey: ['vendor-me'], queryFn: fetchMe, refetchInterval: 5 * 60 * 1000 });
  useEffect(() => {
    if (me) setProfile(me);
  }, [me, setProfile]);

  const selectedKey = useMemo(() => NAV_ITEMS.find((item) => location.pathname.startsWith(item.path))?.key || 'dashboard', [location.pathname]);

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
      <Sider collapsible collapsed={collapsed} trigger={null} theme="dark" width={220} breakpoint="lg" onBreakpoint={setCollapsed}>
        <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          {collapsed ? (
            <span className="grovio-logo-badge"><img src="/brand/grovio-icon.svg" alt="Grovio" /></span>
          ) : (
            <span className="grovio-logo" title="Grovio Vendor">
              <img src="/brand/grovio-logo-compact-white.svg" alt="Grovio" />
              <span className="grovio-logo-role">Vendor</span>
            </span>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={NAV_ITEMS.map((item) => ({ key: item.key, icon: item.icon, label: item.label }))}
          onClick={({ key }) => {
            const item = NAV_ITEMS.find((i) => i.key === key);
            if (item) navigate(item.path);
          }}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space>
            <span onClick={() => setCollapsed((c) => !c)} style={{ cursor: 'pointer', fontSize: 18 }}>
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </span>
            {store && <Typography.Text strong className="vendor-store-name">{store.name}</Typography.Text>}
          </Space>
          <Space size="large">
            <Tooltip title={live ? 'Receiving order updates in real time' : 'Real-time updates disconnected — reconnecting…'}>
              <Badge status={live ? 'success' : 'default'} text={live ? 'Live' : 'Offline'} />
            </Tooltip>
            <Dropdown menu={{ items: [{ key: 'logout', icon: <LogoutOutlined />, label: 'Logout', onClick: handleLogout }] }} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar icon={<UserOutlined />} />
                <div style={{ lineHeight: 1.2 }} className="vendor-user">
                  <Typography.Text strong style={{ display: 'block' }}>{user?.name}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Store Manager</Typography.Text>
                </div>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ margin: 16 }}>
          {store?.status === 'inactive' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              title="Your store is waiting for approval"
              description="Customers can't see your store yet. You can add products and set up stock now — the Grovio team will review and activate the store."
            />
          )}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
