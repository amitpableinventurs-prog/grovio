import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { listProducts } from '../api/catalog';
import ProductCard from '../components/ProductCard';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';

export default function ProductListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || undefined;
  const categoryId = searchParams.get('categoryId') || undefined;
  const page = Number(searchParams.get('page') || 1);

  const { data, isLoading } = useQuery({
    queryKey: ['products', { search, categoryId, page }],
    queryFn: () => listProducts({ search, categoryId, page, limit: 24 }),
  });

  function goToPage(p: number) {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(p));
    setSearchParams(next);
  }

  const title = search ? `Results for "${search}"` : 'All Products';

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-4">{title}</h1>

      {isLoading ? (
        <Loader />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<SearchX size={26} strokeWidth={1.5} />}
          title="No products found"
          description="Try a different search or browse categories."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {data.items.map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>

          {data.meta.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              >
                Prev
              </button>
              <span className="text-sm text-gray-600">
                Page {data.meta.page} of {data.meta.totalPages}
              </span>
              <button
                disabled={page >= data.meta.totalPages}
                onClick={() => goToPage(page + 1)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
