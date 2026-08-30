export type PageRequest = {
  page: number;
  pageSize: number;
};

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export function normalizePageRequest(request: Partial<PageRequest> = {}): PageRequest {
  const page = Number.isSafeInteger(request.page) && Number(request.page) > 0 ? Number(request.page) : 1;
  const requestedSize = Number(request.pageSize);
  const pageSize = [20, 50, 100].includes(requestedSize) ? requestedSize : 20;
  return { page, pageSize };
}

export function totalPages(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}
