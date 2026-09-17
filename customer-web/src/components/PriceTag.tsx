import { formatPrice } from '../utils/format';

export default function PriceTag({ price, discountPrice }: { price: number; discountPrice?: number | null }) {
  const hasDiscount = discountPrice != null && discountPrice < price;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-semibold text-gray-900">{formatPrice(hasDiscount ? discountPrice! : price)}</span>
      {hasDiscount && <span className="text-xs text-gray-400 line-through">{formatPrice(price)}</span>}
    </div>
  );
}
