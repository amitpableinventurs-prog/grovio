import { Link } from 'react-router-dom';
import { Globe, Mail, MapPin, MessageCircle, Phone, Send, ShoppingCart, Store } from 'lucide-react';
import { ASSET_BASE_URL } from '../api/client';

// Standalone static page (backend/../vendor-signup), not a route in this app — it must be
// reachable without logging in, so it's served directly by the backend at this path.
const VENDOR_SIGNUP_URL = `${ASSET_BASE_URL}/vendor-signup`;

export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-10 grid gap-8 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <Link to="/" className="flex items-center gap-1.5">
            <ShoppingCart size={24} className="text-brand-600" strokeWidth={2.2} />
            <span className="text-xl font-extrabold text-brand-700">Grovio</span>
          </Link>
          <p className="mt-3 text-sm text-gray-500 max-w-xs">
            Quick groceries, delivered fast. Fresh fruits, vegetables, dairy and household essentials at your doorstep in minutes.
          </p>
          <div className="mt-4 flex gap-3">
            {[Globe, MessageCircle, Send].map((Icon, i) => (
              <span
                key={i}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-brand-50 hover:text-brand-700"
              >
                <Icon size={16} />
              </span>
            ))}
          </div>
          <a
            href={VENDOR_SIGNUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            <Store size={16} />
            Sell on Grovio
          </a>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Links</h3>
          <ul className="flex flex-col gap-2 text-sm text-gray-500">
            <li><Link to="/about" className="hover:text-brand-700">About Us</Link></li>
            <li><Link to="/" className="hover:text-brand-700">Home</Link></li>
            <li><Link to="/categories" className="hover:text-brand-700">Categories</Link></li>
            <li><Link to="/products" className="hover:text-brand-700">All Products</Link></li>
            <li><Link to="/orders" className="hover:text-brand-700">Track Order</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Customer Service</h3>
          <ul className="flex flex-col gap-2 text-sm text-gray-500">
            <li><Link to="/profile" className="hover:text-brand-700">My Account</Link></li>
            <li><Link to="/addresses" className="hover:text-brand-700">My Addresses</Link></li>
            <li><Link to="/help" className="hover:text-brand-700">Help &amp; Support</Link></li>
            <li><Link to="/returns-refunds" className="hover:text-brand-700">Returns &amp; Refunds</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Get in Touch</h3>
          <ul className="flex flex-col gap-2 text-sm text-gray-500">
            <li className="flex items-center gap-2">
              <Phone size={14} className="text-brand-600 shrink-0" /> 1800-123-4567
            </li>
            <li className="flex items-center gap-2">
              <Mail size={14} className="text-brand-600 shrink-0" /> support@grovio.com
            </li>
            <li className="flex items-center gap-2">
              <MapPin size={14} className="text-brand-600 shrink-0" /> Katni, Madhya Pradesh, India
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-gray-100 py-4 flex flex-col items-center gap-2 text-xs text-gray-400 sm:flex-row sm:justify-between sm:px-6">
        <span>© {new Date().getFullYear()} Grovio · Quick groceries, delivered fast</span>
        <span className="flex items-center gap-4">
          <Link to="/terms" className="hover:text-brand-700">Terms &amp; Conditions</Link>
          <Link to="/privacy-policy" className="hover:text-brand-700">Privacy Policy</Link>
        </span>
      </div>
    </footer>
  );
}
