import { apiClient, unwrap } from './client';
import type { Paginated, Product } from '../types';
import type { ListParams } from './common';

export function fetchInventory(params: ListParams = {}) {
  return unwrap<Paginated<Product>>(apiClient.get('/admin/inventory', { params }));
}

// Downloads the CSV and triggers a browser save — axios needs responseType: 'blob' for a binary
// file response, then a throwaway <a> click is the standard way to hand a Blob to the browser's
// save dialog since there's no direct "download this blob" browser API.
export async function downloadInventoryCsv(storeId?: string) {
  const res = await apiClient.get('/admin/inventory/export', { params: { storeId }, responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const link = document.createElement('a');
  link.href = url;
  link.download = `grovio-inventory-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export interface ImportInventoryResult {
  updated: number;
  errors: { row: number; productId?: string; message: string }[];
}

export function importInventoryCsv(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return unwrap<ImportInventoryResult>(apiClient.post('/admin/inventory/import', formData));
}
