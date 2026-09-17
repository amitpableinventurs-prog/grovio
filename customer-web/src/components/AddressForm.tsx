import { useState } from 'react';
import type { AddressInput } from '../api/addresses';

interface Props {
  initial?: Partial<AddressInput>;
  onSubmit: (payload: Partial<AddressInput>) => void;
  onCancel?: () => void;
  submitLabel?: string;
  isSubmitting?: boolean;
}

export default function AddressForm({ initial, onSubmit, onCancel, submitLabel = 'Save Address', isSubmitting }: Props) {
  const [form, setForm] = useState<Partial<AddressInput>>({
    label: initial?.label || 'Home',
    line1: initial?.line1 || '',
    landmark: initial?.landmark || '',
    city: initial?.city || '',
    state: initial?.state || '',
    pincode: initial?.pincode || '',
    isDefault: initial?.isDefault ?? false,
  });

  function set<K extends keyof AddressInput>(key: K, value: AddressInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex gap-2">
        {(['Home', 'Work', 'Other'] as const).map((label) => (
          <button
            type="button"
            key={label}
            onClick={() => set('label', label)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
              form.label === label ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        required
        value={form.line1}
        onChange={(e) => set('line1', e.target.value)}
        placeholder="House no., building, street *"
        className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
      />
      <input
        value={form.landmark || ''}
        onChange={(e) => set('landmark', e.target.value)}
        placeholder="Landmark (optional)"
        className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          value={form.city || ''}
          onChange={(e) => set('city', e.target.value)}
          placeholder="City"
          className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
        />
        <input
          value={form.state || ''}
          onChange={(e) => set('state', e.target.value)}
          placeholder="State"
          className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
        />
      </div>
      <input
        value={form.pincode || ''}
        onChange={(e) => set('pincode', e.target.value)}
        placeholder="Pincode"
        className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
      />

      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={!!form.isDefault} onChange={(e) => set('isDefault', e.target.checked)} />
        Set as default address
      </label>

      <div className="flex gap-2 mt-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-semibold text-gray-600">
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {isSubmitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
