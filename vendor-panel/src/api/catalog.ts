import { apiClient, unwrap } from './client';
import type { Category, Paginated, Product } from '../types';
import type { ListParams } from './common';

// Categories are managed by the admin; vendors only file products under them.
export function fetchCategories() {
  return unwrap<Category[]>(apiClient.get('/vendor/categories'));
}

export function fetchProducts(params: ListParams = {}) {
  return unwrap<Paginated<Product>>(apiClient.get('/vendor/products', { params }));
}

export function setProductStatus(id: string, status: 'active' | 'inactive') {
  return unwrap<Product>(apiClient.patch(`/vendor/products/${id}/status`, { status }));
}

export function createProduct(formData: FormData) {
  return unwrap<Product>(apiClient.post('/vendor/products', formData));
}

export function updateProduct(id: string, formData: FormData) {
  return unwrap<Product>(apiClient.patch(`/vendor/products/${id}`, formData));
}

export function deleteProduct(id: string) {
  return unwrap(apiClient.delete(`/vendor/products/${id}`));
}
