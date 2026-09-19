import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import * as authApi from '../api/auth';
import { apiErrorMessage } from '../api/client';
import { useAuthStore } from '../store/authStore';

export default function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);

  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: () => authApi.updateMe({ name, email: email || undefined }),
    onSuccess: (updated) => {
      setUser(updated);
      setMessage('Profile updated');
      setError(null);
    },
    onError: (err) => setError(apiErrorMessage(err, 'Could not update profile')),
  });

  async function handleLogout() {
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        // ignore — clearing local session regardless
      }
    }
    clear();
    navigate('/');
  }

  if (!user) return null;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-bold text-gray-900 mb-4">My Profile</h1>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-4 mb-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-2xl font-bold text-brand-700">
            {user.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div>
            <p className="font-semibold text-gray-900">{user.name}</p>
            <p className="text-sm text-gray-500">{user.phone}</p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateMutation.mutate();
          }}
          className="flex flex-col gap-3"
        >
          <label className="text-sm font-medium text-gray-700">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </label>

          {message && <p className="text-sm text-brand-700">{message}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="mt-1 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>

      <div className="mt-4 flex flex-col divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        <Link to="/orders" className="p-4 text-sm font-medium text-gray-700 hover:bg-gray-50">
          My Orders
        </Link>
        <Link to="/addresses" className="p-4 text-sm font-medium text-gray-700 hover:bg-gray-50">
          My Addresses
        </Link>
        <Link to="/help" className="p-4 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Help &amp; Support
        </Link>
        <Link to="/returns-refunds" className="p-4 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Returns &amp; Refunds
        </Link>
        <Link to="/terms" className="p-4 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Terms &amp; Conditions
        </Link>
        <Link to="/privacy-policy" className="p-4 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Privacy Policy
        </Link>
      </div>

      <button
        onClick={handleLogout}
        className="mt-4 w-full rounded-lg border border-red-200 py-2.5 text-sm font-semibold text-red-500 hover:bg-red-50"
      >
        Logout
      </button>
    </div>
  );
}
