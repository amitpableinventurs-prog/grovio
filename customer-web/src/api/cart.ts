import { apiClient, unwrap } from './client';
import type { Cart } from '../types';

export function getCart() {
  return unwrap<Cart>(apiClient.get('/customer/cart'));
}

export function addToCart(productId: string, qty = 1, variantId?: string) {
  return unwrap<Cart>(apiClient.post('/customer/cart/items', { productId, qty, variantId }));
}

export function updateCartItem(itemId: string, qty: number) {
  return unwrap<Cart>(apiClient.patch(`/customer/cart/items/${itemId}`, { qty }));
}

export function removeCartItem(itemId: string) {
  return unwrap<Cart>(apiClient.delete(`/customer/cart/items/${itemId}`));
}

export function clearCart() {
  return unwrap<Cart>(apiClient.delete('/customer/cart'));
}

export function applyCoupon(code: string) {
  return unwrap<Cart>(apiClient.post('/customer/cart/apply-coupon', { code }));
}

export function removeCoupon() {
  return unwrap<Cart>(apiClient.delete('/customer/cart/coupon'));
}

export function listAvailableCoupons() {
  return unwrap(apiClient.get('/customer/coupons'));
}
