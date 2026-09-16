import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './routes/ProtectedRoute';
import AdminLayout from './layouts/AdminLayout';
import { PERMISSIONS } from './utils/permissions';

import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import VendorsPage from './pages/VendorsPage';
import StoresPage from './pages/StoresPage';
import CustomersPage from './pages/CustomersPage';
import PickersPage from './pages/PickersPage';
import DeliveryPartnersPage from './pages/DeliveryPartnersPage';
import CategoriesPage from './pages/CategoriesPage';
import ProductsPage from './pages/ProductsPage';
import OrdersPage from './pages/OrdersPage';
import InventoryPage from './pages/InventoryPage';
import CouponsPage from './pages/CouponsPage';
import BannersPage from './pages/BannersPage';
import PaymentsPage from './pages/PaymentsPage';
import SettlementsPage from './pages/SettlementsPage';
import ReportsPage from './pages/ReportsPage';
import SupportTicketsPage from './pages/SupportTicketsPage';
import SettingsPage from './pages/SettingsPage';
import AdminsPage from './pages/AdminsPage';
import ActivityLogsPage from './pages/ActivityLogsPage';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route
            path="/vendors"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_VENDORS]}>
                <VendorsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stores"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_STORES]}>
                <StoresPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customers"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_ORDERS]}>
                <CustomersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pickers"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_PICKERS]}>
                <PickersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/delivery-partners"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_DELIVERY]}>
                <DeliveryPartnersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/categories"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_CATALOG]}>
                <CategoriesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/products"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_CATALOG]}>
                <ProductsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_ORDERS]}>
                <OrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/inventory"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_INVENTORY]}>
                <InventoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/coupons"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_PROMOTIONS]}>
                <CouponsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/banners"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_PROMOTIONS]}>
                <BannersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/payments"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_PAYMENTS]}>
                <PaymentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settlements"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_SETTLEMENTS]}>
                <SettlementsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.VIEW_REPORTS]}>
                <ReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/support-tickets"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_ORDERS]}>
                <SupportTicketsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_SETTINGS]}>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admins"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_ADMINS]}>
                <AdminsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity-logs"
            element={
              <ProtectedRoute requiredPermissions={[PERMISSIONS.MANAGE_ADMINS]}>
                <ActivityLogsPage />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
