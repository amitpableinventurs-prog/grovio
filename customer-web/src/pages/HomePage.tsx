import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BadgeCheck, Leaf, ShoppingBasket, Tag, Zap } from 'lucide-react';
import { getHome } from '../api/catalog';
import { resolveAssetUrl } from '../api/client';
import ProductCard from '../components/ProductCard';
import BannerCarousel from '../components/BannerCarousel';
import Loader from '../components/Loader';

const FEATURES = [
  { icon: Zap, title: '10 Minute Delivery', desc: 'Get your groceries delivered in minutes, not hours.' },
  { icon: ShoppingBasket, title: 'Wide Range', desc: 'Choose from 5000+ products across every category.' },
  { icon: BadgeCheck, title: 'Best Quality', desc: 'We ensure best quality products for you, always.' },
];

export default function HomePage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['home'], queryFn: getHome });

  if (isLoading) return <Loader />;
  if (isError || !data) return <p className="text-center text-gray-500 py-20">Could not load the home page.</p>;

  return (
    <div className="flex flex-col gap-10">
      {data.banners.length > 0 ? (
        <BannerCarousel banners={data.banners} />
      ) : (
        <section className="rounded-2xl bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-10 text-white sm:px-10">
          <p className="text-sm font-medium text-brand-100">10 minute delivery</p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold max-w-md">Groceries delivered to your doorstep, fast.</h1>
          <Link
            to="/products"
            className="mt-4 inline-block rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Start shopping
          </Link>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <f.icon size={20} />
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{f.title}</p>
              <p className="text-xs text-gray-500">{f.desc}</p>
            </div>
          </div>
        ))}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900">Shop by Category</h2>
          <Link to="/categories" className="text-sm font-medium text-brand-700 hover:underline">
            See all
          </Link>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {data.categories.map((category) => (
            <Link
              key={category._id}
              to={`/products?categoryId=${category._id}`}
              className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 hover:-translate-y-0.5 hover:shadow-md transition-all"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 overflow-hidden">
                {category.image ? (
                  <img src={resolveAssetUrl(category.image)} alt={category.name} className="h-full w-full object-cover" />
                ) : (
                  <Leaf size={22} className="text-brand-600" />
                )}
              </div>
              <span className="text-xs font-medium text-gray-700 text-center line-clamp-1">{category.name}</span>
            </Link>
          ))}
        </div>
      </section>

      {data.offers.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3">Available Offers</h2>
          <div className="flex gap-4 overflow-x-auto pb-1">
            {data.offers.map((offer) => (
              <div
                key={offer._id}
                className="flex min-w-[240px] shrink-0 items-center gap-3 rounded-xl border border-dashed border-brand-300 bg-brand-50 p-4"
              >
                <Tag size={22} className="text-brand-600 shrink-0" />
                <div>
                  <p className="font-bold text-brand-800">
                    {offer.discountType === 'flat' ? `₹${offer.discountValue} OFF` : `${offer.discountValue}% OFF`}
                  </p>
                  <p className="text-xs text-gray-600">
                    Use code <span className="font-semibold">{offer.code}</span>
                    {offer.minOrderAmount ? ` on orders above ₹${offer.minOrderAmount}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900">Best Selling</h2>
          <Link to="/products" className="text-sm font-medium text-brand-700 hover:underline">
            See all
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {data.featuredProducts.map((product) => (
            <ProductCard key={product._id} product={product} />
          ))}
        </div>
      </section>
    </div>
  );
}
