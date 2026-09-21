import { apiClient, unwrap } from './client';

export interface ContentPage {
  _id: string;
  slug: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type ContentSlug = 'about-us' | 'privacy-policy' | 'terms-and-conditions';

export function fetchContentPage(slug: ContentSlug) {
  return unwrap<ContentPage>(apiClient.get(`/common/content/${slug}`));
}
