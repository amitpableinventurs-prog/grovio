import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import * as addressApi from '../api/addresses';
import type { Address } from '../types';
import AddressForm from '../components/AddressForm';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';

export default function AddressesPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Address | null>(null);

  const { data: addresses, isLoading } = useQuery({ queryKey: ['addresses'], queryFn: addressApi.listAddresses });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['addresses'] });
    setShowForm(false);
    setEditing(null);
  }

  const createMutation = useMutation({ mutationFn: addressApi.createAddress, onSuccess: invalidate });
  const updateMutation = useMutation({
    mutationFn: (payload: Partial<addressApi.AddressInput>) => addressApi.updateAddress(editing!._id, payload),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: addressApi.deleteAddress,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['addresses'] }),
  });

  if (isLoading) return <Loader />;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">My Addresses</h1>
        {!showForm && !editing && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            + Add New
          </button>
        )}
      </div>

      {(showForm || editing) && (
        <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="font-semibold text-gray-900 mb-3">{editing ? 'Edit Address' : 'New Address'}</h2>
          <AddressForm
            initial={editing ?? undefined}
            submitLabel={editing ? 'Update Address' : 'Save Address'}
            isSubmitting={createMutation.isPending || updateMutation.isPending}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
            onSubmit={(payload) => (editing ? updateMutation.mutate(payload) : createMutation.mutate(payload))}
          />
        </div>
      )}

      {!addresses || addresses.length === 0 ? (
        !showForm && (
          <EmptyState
            icon={<MapPin size={26} strokeWidth={1.5} />}
            title="No saved addresses"
            description="Add an address to speed up checkout."
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {addresses.map((address) => (
            <div key={address._id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{address.label}</p>
                    {address.isDefault && (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">Default</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    {[address.line1, address.landmark, address.city, address.state, address.pincode].filter(Boolean).join(', ')}
                  </p>
                </div>
                <div className="flex gap-3 shrink-0 text-sm font-medium">
                  <button onClick={() => setEditing(address)} className="text-brand-700 hover:underline">
                    Edit
                  </button>
                  <button onClick={() => deleteMutation.mutate(address._id)} className="text-red-500 hover:underline">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
