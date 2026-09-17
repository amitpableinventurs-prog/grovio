import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Leaf } from 'lucide-react';
import { listCategories } from '../api/catalog';
import { resolveAssetUrl } from '../api/client';
import Loader from '../components/Loader';

export default function CategoriesPage() {
  const { data, isLoading } = useQuery({ queryKey: ['categories'], queryFn: listCategories });

  if (isLoading) return <Loader />;

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-4">All Categories</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {data?.map((category) => (
          <Link
            key={category._id}
            to={`/products?categoryId=${category._id}`}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50 overflow-hidden">
              {category.image ? (
                <img src={resolveAssetUrl(category.image)} alt={category.name} className="h-full w-full object-cover" />
              ) : (
                <Leaf size={20} className="text-brand-600" />
              )}
            </div>
            <span className="font-medium text-gray-800">{category.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
