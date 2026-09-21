import { apiClient, unwrap } from './client';

export type ContentSlug = 'about-us' | 'privacy-policy' | 'terms-and-conditions';

export interface ContentPage {
  _id: string;
  slug: ContentSlug;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export function fetchContentPages() {
  return unwrap<ContentPage[]>(apiClient.get('/admin/content-pages'));
}

export function updateContentPage(slug: ContentSlug, data: { title: string; content: string }) {
  return unwrap<ContentPage>(apiClient.put(`/admin/content-pages/${slug}`, data));
}
