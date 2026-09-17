import { useNavigate } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import type { Product } from '../types';
import { resolveAssetUrl } from '../api/client';
import { useCart } from '../hooks/useCart';
import { useAuthStore } from '../store/authStore';
import PriceTag from './PriceTag';
import QuantityStepper from './QuantityStepper';

export default function ProductCard({ product }: { product: Product }) {
  const navigate = useNavigate();
  const isAuthed = useAuthStore((s) => !!s.accessToken);
  const { findItem, addToCart, updateItem, removeItem, isMutating } = useCart();

  const cartItem = findItem(product._id);
  const image = resolveAssetUrl(product.images?.[0]);
  const outOfStock = !product.isAvailable || product.stockQty <= 0;

  function handleAdd() {
    if (!isAuthed) {
      navigate('/login');
      return;
    }
    addToCart({ productId: product._id, qty: 1 });
  }

  function handleChange(qty: number) {
    if (!cartItem) return;
    if (qty <= 0) removeItem(cartItem._id);
    else updateItem({ itemId: cartItem._id, qty });
  }

  return (
    <div className="group flex flex-col rounded-xl border border-gray-200 bg-white p-3 hover:shadow-md transition-shadow">
      <button
        type="button"
        onClick={() => navigate(`/products/${product._id}`)}
        className="aspect-square w-full overflow-hidden rounded-lg bg-gray-50 mb-2"
      >
        {image ? (
          <img src={image} alt={product.name} className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-300">
            <ShoppingCart size={32} strokeWidth={1.2} />
          </div>
        )}
      </button>
      <button type="button" onClick={() => navigate(`/products/${product._id}`)} className="text-left">
        <p className="text-sm font-medium text-gray-900 line-clamp-2 min-h-[2.5rem]">{product.name}</p>
        <p className="text-xs text-gray-500 mt-0.5">{product.unit}</p>
      </button>
      <div className="mt-2 flex items-center justify-between gap-2">
        <PriceTag price={product.price} discountPrice={product.discountPrice} />
        {outOfStock ? (
          <span className="text-xs font-medium text-red-500">Out of stock</span>
        ) : cartItem ? (
          <QuantityStepper qty={cartItem.qty} onChange={handleChange} />
        ) : (
          <button
            type="button"
            onClick={handleAdd}
            disabled={isMutating}
            className="rounded-lg border border-brand-600 px-4 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            ADD
          </button>
        )}
      </div>
    </div>
  );
}
