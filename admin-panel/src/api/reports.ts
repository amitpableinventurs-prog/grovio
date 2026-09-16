import { apiClient, unwrap } from './client';

export interface SalesReport {
  totalOrders: number;
  totalRevenue: number;
  totalItemSales: number;
}

export interface VendorCommissionRow {
  vendorId: string;
  businessName: string;
  totalOrders: number;
  totalSales: number;
  commissionPercent: number;
  commissionAmount: number;
  payoutAmount: number;
}

export interface ProductReportRow {
  _id: string;
  name: string;
  qtySold: number;
  revenue: number;
}

export interface CustomerReportRow {
  customerId: string;
  name: string;
  phone?: string;
  totalOrders: number;
  totalSpend: number;
}

export interface DeliveryReportRow {
  deliveryPartnerId: string;
  name: string;
  phone?: string;
  totalDeliveries: number;
  totalDeliveryFees: number;
}

export function fetchSalesReport(params: { from?: string; to?: string } = {}) {
  return unwrap<SalesReport>(apiClient.get('/admin/reports/sales', { params }));
}

export function fetchVendorCommissionReport() {
  return unwrap<VendorCommissionRow[]>(apiClient.get('/admin/reports/vendor-commission'));
}

export function fetchProductReport() {
  return unwrap<ProductReportRow[]>(apiClient.get('/admin/reports/products'));
}

export function fetchCustomerReport() {
  return unwrap<CustomerReportRow[]>(apiClient.get('/admin/reports/customers'));
}

export function fetchDeliveryReport() {
  return unwrap<DeliveryReportRow[]>(apiClient.get('/admin/reports/delivery-partners'));
}
