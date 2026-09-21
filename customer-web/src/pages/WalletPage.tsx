import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet as WalletIcon, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import * as walletApi from '../api/wallet';
import { apiErrorMessage } from '../api/client';
import { loadRazorpayScript, openRazorpayCheckout } from '../utils/razorpay';
import { useAuthStore } from '../store/authStore';
import { formatPrice } from '../utils/format';
import Loader from '../components/Loader';

const QUICK_AMOUNTS = [100, 200, 500, 1000];

export default function WalletPage() {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ['wallet-balance'],
    queryFn: walletApi.fetchWalletBalance,
  });

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['wallet-transactions'],
    queryFn: () => walletApi.fetchWalletTransactions(),
  });

  async function handleAddMoney() {
    const value = Number(amount);
    if (!value || value < 10) {
      setError('Enter an amount of at least ₹10');
      return;
    }

    setError(null);
    setProcessing(true);
    try {
      await loadRazorpayScript();
      const order = await walletApi.createAddMoney(value);
      const user = useAuthStore.getState().user;

      openRazorpayCheckout({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.razorpayOrderId,
        name: 'Grovio Wallet',
        description: `Add ${formatPrice(value)} to wallet`,
        prefill: { name: user?.name, email: user?.email ?? undefined, contact: user?.phone ?? undefined },
        theme: { color: '#16a34a' },
        handler: async (response) => {
          try {
            await walletApi.verifyAddMoney({
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            setAmount('');
            queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
            queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
          } catch (err) {
            setError(apiErrorMessage(err, 'Could not verify payment. Check your transaction history shortly.'));
          } finally {
            setProcessing(false);
          }
        },
        modal: {
          ondismiss: () => {
            setProcessing(false);
            setError('Payment was cancelled.');
          },
        },
      });
    } catch (err) {
      setProcessing(false);
      setError(apiErrorMessage(err, 'Could not start the payment gateway'));
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <WalletIcon size={20} />
        </div>
        <h1 className="text-xl font-bold text-gray-900">My Wallet</h1>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-sm text-gray-500">Available Balance</p>
        {walletLoading ? (
          <Loader />
        ) : (
          <p className="mt-1 text-3xl font-extrabold text-gray-900">{formatPrice(wallet?.balance ?? 0)}</p>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Add Money</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {QUICK_AMOUNTS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(String(v))}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                amount === String(v) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600'
              }`}
            >
              ₹{v}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            min={10}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Enter amount"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
          />
          <button
            type="button"
            onClick={handleAddMoney}
            disabled={processing}
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {processing ? 'Processing...' : 'Add Money'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Transaction History</h2>
        {txLoading ? (
          <Loader />
        ) : !transactions?.items.length ? (
          <p className="text-sm text-gray-500">No transactions yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-gray-100">
            {transactions.items.map((tx) => (
              <li key={tx._id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  {tx.type === 'credit' ? (
                    <ArrowDownCircle size={18} className="text-brand-600" />
                  ) : (
                    <ArrowUpCircle size={18} className="text-red-500" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-gray-900">{tx.reason}</p>
                    <p className="text-xs text-gray-500">{new Date(tx.createdAt).toLocaleString('en-IN')}</p>
                  </div>
                </div>
                <p className={`text-sm font-semibold ${tx.type === 'credit' ? 'text-brand-700' : 'text-red-600'}`}>
                  {tx.type === 'credit' ? '+' : '-'}
                  {formatPrice(tx.amount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
