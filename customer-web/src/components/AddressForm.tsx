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
    lat: initial?.lat ?? null,
    lng: initial?.lng ?? null,
  });
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // The address's map position — used for the delivery-area check, ETAs and live tracking.
  function fillCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError('Your browser cannot share its location.');
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) }));
        setLocating(false);
      },
      (err) => {
        setLocationError(err.code === err.PERMISSION_DENIED ? 'Location permission was denied.' : 'Could not get your location. Try again.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

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

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={fillCurrentLocation}
          disabled={locating}
          className="rounded-lg border border-brand-600 px-3 py-1.5 font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-60"
        >
          {locating ? 'Locating…' : form.lat != null ? 'Update location' : 'Use my current location'}
        </button>
        {form.lat != null && form.lng != null ? (
          <span className="text-xs text-brand-700">Location saved ({form.lat.toFixed(4)}, {form.lng.toFixed(4)})</span>
        ) : (
          <span className="text-xs text-gray-500">Stand at the delivery address — used for live tracking and ETA</span>
        )}
        {locationError && <span className="w-full text-xs text-red-600">{locationError}</span>}
      </div>

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
