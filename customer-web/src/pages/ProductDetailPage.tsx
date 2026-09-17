import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { getProduct } from '../api/catalog';
import { resolveAssetUrl } from '../api/client';
import { useCart } from '../hooks/useCart';
import { useAuthStore } from '../store/authStore';
import PriceTag from '../components/PriceTag';
import QuantityStepper from '../components/QuantityStepper';
import Loader from '../components/Loader';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isAuthed = useAuthStore((s) => !!s.accessToken);
  const { findItem, addToCart, updateItem, removeItem, isMutating } = useCart();
  const [activeImage, setActiveImage] = useState(0);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => getProduct(id as string),
    enabled: !!id,
  });

  if (isLoading) return <Loader />;
  if (!product) return <p className="text-center text-gray-500 py-20">Product not found.</p>;

  const store = typeof product.store === 'object' ? product.store : null;
  const cartItem = findItem(product._id);
  const outOfStock = !product.isAvailable || product.stockQty <= 0;
  const images = product.images.length ? product.images : [undefined];

  function handleAdd() {
    if (!isAuthed) {
      navigate('/login');
      return;
    }
    addToCart({ productId: product!._id, qty: 1 });
  }

  function handleChange(qty: number) {
    if (!cartItem) return;
    if (qty <= 0) removeItem(cartItem._id);
    else updateItem({ itemId: cartItem._id, qty });
  }

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div>
        <div className="aspect-square w-full overflow-hidden rounded-2xl bg-white border border-gray-200 flex items-center justify-center">
          {images[activeImage] ? (
            <img src={resolveAssetUrl(images[activeImage])} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <ShoppingCart size={72} className="text-gray-200" strokeWidth={1} />
          )}
        </div>
        {images.length > 1 && (
          <div className="mt-3 flex gap-2">
            {images.map((img, i) => (
              <button
                key={i}
                onClick={() => setActiveImage(i)}
                className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${
                  i === activeImage ? 'border-brand-600' : 'border-gray-200'
                }`}
              >
                {img && <img src={resolveAssetUrl(img)} alt="" className="h-full w-full object-cover" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        {store && <p className="text-sm text-gray-500 mb-1">{store.name}</p>}
        <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
        <p className="text-sm text-gray-500 mt-1">{product.unit}</p>

        <div className="mt-4">
          <PriceTag price={product.price} discountPrice={product.discountPrice} />
        </div>

        <div className="mt-6">
          {outOfStock ? (
            <span className="inline-block rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-500">
              Out of stock
            </span>
          ) : cartItem ? (
            <QuantityStepper qty={cartItem.qty} onChange={handleChange} size="md" />
          ) : (
            <button
              type="button"
              onClick={handleAdd}
              disabled={isMutating}
              className="rounded-lg bg-brand-600 px-8 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              Add to Cart
            </button>
          )}
        </div>

        {product.description && (
          <div className="mt-8 border-t border-gray-200 pt-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Description</h2>
            <p className="text-sm text-gray-600 whitespace-pre-line">{product.description}</p>
          </div>
        )}
      </div>
    </div>
  );
}
