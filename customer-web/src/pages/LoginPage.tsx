import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import * as authApi from '../api/auth';
import { apiErrorMessage } from '../api/client';
import { useAuthStore } from '../store/authStore';

type Step = 'phone' | 'otp';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [debugOtp, setDebugOtp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const redirectTo = (location.state as { from?: { pathname: string } } | null)?.from?.pathname || '/';

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 10) {
      setError('Enter a valid 10-digit mobile number');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.sendOtp(digits);
      setDebugOtp(res.debugOtp || null);
      setStep('otp');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not send OTP'));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (otp.trim().length < 4) {
      setError('Enter the OTP sent to your phone');
      return;
    }
    setLoading(true);
    try {
      const digits = phone.replace(/\D/g, '');
      const session = await authApi.verifyOtp(digits, otp.trim());
      setSession(session);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, 'Invalid OTP'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <div className="mb-8 text-center">
        <div className="mb-2 flex justify-center text-brand-600">
          <ShoppingCart size={40} strokeWidth={2} />
        </div>
        <h1 className="text-2xl font-extrabold text-brand-700">Grovio</h1>
        <p className="text-gray-500 text-sm mt-1">Quick groceries, delivered fast</p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        {step === 'phone' ? (
          <form onSubmit={handleSendOtp}>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Login / Signup</h2>
            <p className="text-sm text-gray-500 mb-4">Enter your mobile number to continue</p>
            <div className="flex items-center rounded-lg border border-gray-300 px-3 py-2.5 focus-within:border-brand-500">
              <span className="text-gray-500 text-sm mr-2">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                autoFocus
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98765 43210"
                className="w-full bg-transparent outline-none text-sm"
              />
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="mt-4 w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {loading ? 'Sending...' : 'Continue'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp}>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Verify OTP</h2>
            <p className="text-sm text-gray-500 mb-4">Enter the 4-digit code sent to +91 {phone}</p>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="1234"
              maxLength={6}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-center text-lg tracking-[0.5em] outline-none focus:border-brand-500"
            />
            {debugOtp && (
              <p className="mt-2 text-xs text-brand-700 bg-brand-50 rounded px-2 py-1 inline-block">
                Dev mode OTP: {debugOtp}
              </p>
            )}
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="mt-4 w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {loading ? 'Verifying...' : 'Verify & Continue'}
            </button>
            <button
              type="button"
              onClick={() => setStep('phone')}
              className="mt-3 w-full text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              Change number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
