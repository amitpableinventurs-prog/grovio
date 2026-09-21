// Minimal shape of what we actually call on the injected global — the full Razorpay
// Checkout.js type surface is much larger than this app needs.
interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayCheckoutInstance {
  open: () => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}

let loadingPromise: Promise<void> | null = null;

// Razorpay's checkout widget only ships as a script tag, not an npm package — this loads it
// once and caches the in-flight promise so concurrent callers don't inject it twice.
export function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => {
      loadingPromise = null;
      reject(new Error('Failed to load the payment gateway. Check your connection and try again.'));
    };
    document.body.appendChild(script);
  });
  return loadingPromise;
}

export function openRazorpayCheckout(options: RazorpayCheckoutOptions) {
  if (!window.Razorpay) throw new Error('Razorpay script has not been loaded yet');
  new window.Razorpay(options).open();
}
