export interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  [key: string]: string | number | undefined;
}
