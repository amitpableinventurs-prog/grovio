import { type FormEvent, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Menu, Search, ShoppingBag, ShoppingCart, X, Zap } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useCart } from '../hooks/useCart';
import { listCategories } from '../api/catalog';

export default function Header() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAuthed = useAuthStore((s) => !!s.accessToken);
  const { itemCount } = useCart();
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: listCategories,
    enabled: isAuthed,
    staleTime: 5 * 60_000,
  });

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setMenuOpen(false);
    navigate(search.trim() ? `/products?search=${encodeURIComponent(search.trim())}` : '/products');
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium whitespace-nowrap hover:text-brand-700 ${isActive ? 'text-brand-700' : 'text-gray-600'}`;

  return (
    <header className="sticky top-0 z-30 bg-white shadow-sm">
      {/* Top promo strip */}
      <div className="flex items-center justify-center gap-1.5 bg-brand-800 text-center text-xs font-medium text-brand-50 py-1.5 px-4">
        <Zap size={13} className="fill-current" />
        Groceries delivered in 10 minutes — free delivery on your first order
      </div>

      <div className="border-b border-gray-200">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 md:hidden"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <Link to="/" className="flex items-center gap-1.5 shrink-0">
            <ShoppingCart size={26} className="text-brand-600" strokeWidth={2.2} />
            <span className="text-xl font-extrabold text-brand-700">Grovio</span>
          </Link>

          <form onSubmit={handleSearch} className="flex-1 max-w-xl hidden sm:block">
            <div className="flex items-center rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 focus-within:border-brand-500">
              <Search size={16} className="text-gray-400 mr-2 shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search for milk, bread, eggs..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
              />
            </div>
          </form>

          <nav className="ml-auto flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={() => navigate('/products')}
              className="sm:hidden flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600"
              aria-label="Search"
            >
              <Search size={17} />
            </button>

            <Link to="/cart" className="relative flex items-center gap-1.5 text-gray-700 hover:text-brand-700">
              <ShoppingBag size={22} />
              {itemCount > 0 && (
                <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
                  {itemCount}
                </span>
              )}
            </Link>

            {isAuthed ? (
              <Link
                to="/profile"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700"
              >
                {user?.name?.[0]?.toUpperCase() || 'U'}
              </Link>
            ) : (
              <Link
                to="/login"
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Login
              </Link>
            )}
          </nav>
        </div>

        {/* Mobile search (shown under the top row on small screens) */}
        <form onSubmit={handleSearch} className="sm:hidden px-4 pb-3">
          <div className="flex items-center rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 focus-within:border-brand-500">
            <Search size={16} className="text-gray-400 mr-2 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search for milk, bread, eggs..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
            />
          </div>
        </form>
      </div>

      {/* Category menu strip */}
      <div className="hidden md:block border-b border-gray-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-2.5 overflow-x-auto">
          <NavLink to="/" end className={navLinkClass}>
            Home
          </NavLink>
          <NavLink to="/categories" className={navLinkClass}>
            All Categories
          </NavLink>
          {categories?.slice(0, 6).map((category) => (
            <NavLink key={category._id} to={`/products?categoryId=${category._id}`} className={navLinkClass}>
              {category.name}
            </NavLink>
          ))}
          {isAuthed && (
            <NavLink to="/orders" className={(props) => `${navLinkClass(props)} ml-auto`}>
              My Orders
            </NavLink>
          )}
        </div>
      </div>

      {/* Mobile slide-down menu */}
      {menuOpen && (
        <div className="md:hidden border-b border-gray-200 bg-white px-4 py-3">
          <nav className="flex flex-col gap-1">
            <Link to="/" onClick={() => setMenuOpen(false)} className="rounded-lg px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Home
            </Link>
            <Link to="/categories" onClick={() => setMenuOpen(false)} className="rounded-lg px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              All Categories
            </Link>
            {categories?.slice(0, 8).map((category) => (
              <Link
                key={category._id}
                to={`/products?categoryId=${category._id}`}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {category.name}
              </Link>
            ))}
            {isAuthed && (
              <>
                <Link to="/orders" onClick={() => setMenuOpen(false)} className="rounded-lg px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  My Orders
                </Link>
                <Link to="/addresses" onClick={() => setMenuOpen(false)} className="rounded-lg px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  My Addresses
                </Link>
                <Link to="/profile" onClick={() => setMenuOpen(false)} className="rounded-lg px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  My Profile
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
