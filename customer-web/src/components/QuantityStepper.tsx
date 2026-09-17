import { Minus, Plus } from 'lucide-react';

interface Props {
  qty: number;
  onChange: (qty: number) => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'md';
}

export default function QuantityStepper({ qty, onChange, min = 0, max = 99, size = 'sm' }: Props) {
  const dim = size === 'sm' ? 'h-8 w-8 text-sm' : 'h-10 w-10 text-base';
  return (
    <div className="inline-flex items-center rounded-lg border border-brand-600 bg-white overflow-hidden">
      <button
        type="button"
        className={`${dim} flex items-center justify-center text-brand-700 font-bold hover:bg-brand-50 disabled:opacity-40`}
        disabled={qty <= min}
        onClick={() => onChange(Math.max(min, qty - 1))}
      >
        <Minus size={size === 'sm' ? 14 : 16} />
      </button>
      <span className={`${dim} flex items-center justify-center font-semibold text-gray-900`}>{qty}</span>
      <button
        type="button"
        className={`${dim} flex items-center justify-center text-brand-700 font-bold hover:bg-brand-50 disabled:opacity-40`}
        disabled={qty >= max}
        onClick={() => onChange(Math.min(max, qty + 1))}
      >
        <Plus size={size === 'sm' ? 14 : 16} />
      </button>
    </div>
  );
}
