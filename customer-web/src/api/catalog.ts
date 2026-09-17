import { apiClient, unwrap } from './client';
import type { Banner, Category, Coupon, Paginated, Product } from '../types';

export function getHome() {
  return unwrap<{ banners: Banner[]; categories: Category[]; featuredProducts: Product[]; offers: Coupon[] }>(
    apiClient.get('/customer/home')
  );
}

export function listCategories() {
  return unwrap<Category[]>(apiClient.get('/customer/categories'));
}

export interface ListProductsParams {
  storeId?: string;
  categoryId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export function listProducts(params: ListProductsParams = {}) {
  return unwrap<Paginated<Product>>(apiClient.get('/customer/products', { params }));
}

export function getProduct(id: string) {
  return unwrap<Product>(apiClient.get(`/customer/products/${id}`));
}
