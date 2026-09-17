import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as cartApi from '../api/cart';
import { useAuthStore } from '../store/authStore';
import type { Cart } from '../types';

export const CART_QUERY_KEY = ['cart'];

export function useCart() {
  const isAuthed = useAuthStore((s) => !!s.accessToken);
  const queryClient = useQueryClient();

  const query = useQuery<Cart>({
    queryKey: CART_QUERY_KEY,
    queryFn: cartApi.getCart,
    enabled: isAuthed,
    staleTime: 10_000,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
  }

  const addMutation = useMutation({
    mutationFn: ({ productId, qty, variantId }: { productId: string; qty?: number; variantId?: string }) =>
      cartApi.addToCart(productId, qty, variantId),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: ({ itemId, qty }: { itemId: string; qty: number }) => cartApi.updateCartItem(itemId, qty),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => cartApi.removeCartItem(itemId),
    onSuccess: invalidate,
  });

  const clearMutation = useMutation({
    mutationFn: cartApi.clearCart,
    onSuccess: invalidate,
  });

  const cart = query.data;
  const itemCount = cart?.items?.reduce((sum, i) => sum + i.qty, 0) ?? 0;

  function findItem(productId: string, variantId?: string | null) {
    return cart?.items.find((i) => i.product._id === productId && (i.variantId || null) === (variantId || null));
  }

  return {
    cart,
    itemCount,
    isLoading: query.isLoading,
    findItem,
    addToCart: addMutation.mutateAsync,
    updateItem: updateMutation.mutateAsync,
    removeItem: removeMutation.mutateAsync,
    clearCart: clearMutation.mutateAsync,
    isMutating: addMutation.isPending || updateMutation.isPending || removeMutation.isPending,
  };
}
