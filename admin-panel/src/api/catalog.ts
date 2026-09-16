import { apiClient, unwrap } from './client';
import type { Category, Paginated, Product } from '../types';
import type { ListParams } from './common';

export function fetchCategories() {
  return unwrap<Category[]>(apiClient.get('/admin/categories'));
}

export function createCategory(formData: FormData) {
  return unwrap<Category>(apiClient.post('/admin/categories', formData));
}

export function updateCategory(id: string, formData: FormData) {
  return unwrap<Category>(apiClient.patch(`/admin/categories/${id}`, formData));
}

export function deleteCategory(id: string) {
  return unwrap(apiClient.delete(`/admin/categories/${id}`));
}

export function fetchProducts(params: ListParams = {}) {
  return unwrap<Paginated<Product>>(apiClient.get('/admin/products', { params }));
}

export function setProductStatus(id: string, status: 'active' | 'inactive') {
  return unwrap<Product>(apiClient.patch(`/admin/products/${id}/status`, { status }));
}

export function createProduct(formData: FormData) {
  return unwrap<Product>(apiClient.post('/admin/products', formData));
}

export function updateProduct(id: string, formData: FormData) {
  return unwrap<Product>(apiClient.patch(`/admin/products/${id}`, formData));
}

export function deleteProduct(id: string) {
  return unwrap(apiClient.delete(`/admin/products/${id}`));
}
