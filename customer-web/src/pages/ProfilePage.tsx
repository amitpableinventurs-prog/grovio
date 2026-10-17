import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  BadgeCheck, ChevronRight, CircleHelp, FileText, Info, LogOut, Mail, MapPin, Package, Pencil, Phone, RotateCcw, ShieldCheck, Wallet, X,
} from 'lucide-react';
import * as authApi from '../api/auth';
import * as ordersApi from '../api/orders';
import * as walletApi from '../api/wallet';
import { apiErrorMessage } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { User } from '../types';

const GENDERS: { value: NonNullable<User['gender']>; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

// Numbers are stored either as 10 digits or with +91 — always show "+91 91234 56780".
function formatPhone(phone?: string | null) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return ten.length === 10 ? `+91 ${ten.slice(0, 5)} ${ten.slice(5)}` : phone;
}

function MenuRow({ to, icon, label, hint }: { to: string; icon: ReactNode; label: string; hint?: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-medium text-gray-800">{label}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
      <ChevronRight className="h-4 w-4 text-gray-400" />
    </Link>
  );
}

function Tile({ to, icon, value, label }: { to: string; icon: ReactNode; value: string; label: string }) {
  return (
    <Link to={to} className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-4 hover:border-brand-300 hover:shadow-sm">
      <span className="text-brand-600">{icon}</span>
      <span className="text-lg font-bold text-gray-900">{value}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </Link>
  );
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [gender, setGender] = useState<User['gender']>(user?.gender ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: orders } = useQuery({ queryKey: ['orders'], queryFn: () => ordersApi.listOrders() });
  const { data: wallet } = useQuery({ queryKey: ['wallet-balance'], queryFn: walletApi.fetchWalletBalance });

  const updateMutation = useMutation({
    mutationFn: () => authApi.updateMe({ name: name.trim(), email: email.trim() || undefined, gender: gender || undefined }),
    onSuccess: (updated) => {
      setUser(updated);
      setMessage('Profile updated');
      setError(null);
      setEditing(false);
    },
    onError: (err) => setError(apiErrorMessage(err, 'Could not update profile')),
  });

  function startEdit() {
    setName(user?.name || '');
    setEmail(user?.email || '');
    setGender(user?.gender ?? null);
    setError(null);
    setMessage(null);
    setEditing(true);
  }

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

  const orderCount = orders?.meta?.totalItems ?? orders?.items.length;
  const initials = (user.name || 'U').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'U';

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-12 right-16 h-28 w-28 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white text-xl font-bold text-brand-700 shadow-md sm:h-20 sm:w-20 sm:text-2xl">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-lg font-bold sm:text-xl">
              {user.name || 'Grovio customer'}
              {user.isVerified && <BadgeCheck className="h-5 w-5 shrink-0 text-white/90" aria-label="Verified" />}
            </p>
            {user.phone && (
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-white/85"><Phone className="h-3.5 w-3.5" /> {formatPhone(user.phone)}</p>
            )}
            {user.email && (
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-white/85"><Mail className="h-3.5 w-3.5 shrink-0" /> {user.email}</p>
            )}
          </div>
          {!editing && (
            <button
              type="button"
              onClick={startEdit}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
        </div>
      </section>

      {message && !editing && <p className="rounded-lg bg-brand-50 px-4 py-2.5 text-sm text-brand-700">{message}</p>}

      {/* Edit form */}
      {editing && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Edit profile</h2>
            <button type="button" onClick={() => setEditing(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) {
                setError('Please enter your name');
                return;
              }
              updateMutation.mutate();
            }}
            className="flex flex-col gap-4"
          >
            <label className="text-sm font-medium text-gray-700">
              Full name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <label className="text-sm font-medium text-gray-700">
              Email <span className="font-normal text-gray-400">(optional)</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <div className="text-sm font-medium text-gray-700">
              Gender
              <div className="mt-1 grid grid-cols-3 gap-2">
                {GENDERS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setGender(gender === g.value ? null : g.value)}
                    className={`rounded-lg border px-3 py-2 text-sm ${gender === g.value ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="text-sm font-medium text-gray-700">
              Mobile number
              <input value={formatPhone(user.phone)} disabled className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500" />
              <span className="mt-1 block text-xs font-normal text-gray-400">Your login number can't be changed here.</span>
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="flex-1 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Quick tiles */}
      <section className="grid grid-cols-2 gap-3">
        <Tile to="/orders" icon={<Package className="h-5 w-5" />} value={orderCount !== undefined ? String(orderCount) : '—'} label="Orders" />
        <Tile
          to="/wallet"
          icon={<Wallet className="h-5 w-5" />}
          value={wallet ? `₹${Number(wallet.balance).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}
          label="Wallet balance"
        />
      </section>

      {/* Menu */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <p className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Your information</p>
        <div className="divide-y divide-gray-100">
          <MenuRow to="/orders" icon={<Package className="h-4 w-4" />} label="My Orders" hint="Track, cancel or reorder" />
          <MenuRow to="/wallet" icon={<Wallet className="h-4 w-4" />} label="My Wallet" hint="Balance, refunds and top-ups" />
          <MenuRow to="/addresses" icon={<MapPin className="h-4 w-4" />} label="My Addresses" hint="Saved delivery locations" />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <p className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Help &amp; policies</p>
        <div className="divide-y divide-gray-100">
          <MenuRow to="/help" icon={<CircleHelp className="h-4 w-4" />} label="Help & Support" />
          <MenuRow to="/returns-refunds" icon={<RotateCcw className="h-4 w-4" />} label="Returns & Refunds" />
          <MenuRow to="/terms" icon={<FileText className="h-4 w-4" />} label="Terms & Conditions" />
          <MenuRow to="/privacy-policy" icon={<ShieldCheck className="h-4 w-4" />} label="Privacy Policy" />
          <MenuRow to="/about" icon={<Info className="h-4 w-4" />} label="About Grovio" />
        </div>
      </section>

      <button
        type="button"
        onClick={handleLogout}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white py-3 text-sm font-semibold text-red-500 hover:bg-red-50"
      >
        <LogOut className="h-4 w-4" /> Logout
      </button>
    </div>
  );
}
