import { apiClient, unwrap } from './client';
import type { Paginated, Product } from '../types';
import type { ListParams } from './common';

export function fetchInventory(params: ListParams = {}) {
  return unwrap<Paginated<Product>>(apiClient.get('/admin/inventory', { params }));
}
