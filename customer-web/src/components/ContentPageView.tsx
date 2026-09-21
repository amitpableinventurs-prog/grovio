import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchContentPage, type ContentSlug } from '../api/content';
import Loader from './Loader';

// Renders an admin-authored static page (About Us, Privacy Policy, Terms & Conditions) fetched
// from the backend (see api/content.ts) — the content is admin-controlled HTML, not user input,
// so rendering it directly is the same trust level as banners/settings elsewhere in this app.
export default function ContentPageView({ slug, icon }: { slug: ContentSlug; icon: ReactNode }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['content-page', slug],
    queryFn: () => fetchContentPage(slug),
  });

  if (isLoading) return <Loader />;

  if (isError || !data) {
    return <p className="text-sm text-gray-500">This page isn't available right now. Please check back later.</p>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">{icon}</div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{data.title}</h1>
          <p className="text-sm text-gray-500">
            Last updated: {new Date(data.updatedAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      <div
        className="rounded-xl border border-gray-200 bg-white p-5 text-sm leading-relaxed text-gray-500
          [&_h2]:mt-5 [&_h2]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-gray-900 [&_h2:first-child]:mt-0
          [&_p]:mt-2 [&_p:first-child]:mt-0
          [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5
          [&_a]:font-medium [&_a]:text-brand-700 hover:[&_a]:underline"
        dangerouslySetInnerHTML={{ __html: data.content }}
      />
    </div>
  );
}
