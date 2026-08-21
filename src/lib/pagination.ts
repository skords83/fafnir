export interface PaginationResult {
  page: number;
  pageSize: number;
  offset: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 50;

/** Clamps a requested page number into [1, totalPages] and derives the SQL offset. */
export function paginate(totalCount: number, requestedPage: number, pageSize = DEFAULT_PAGE_SIZE): PaginationResult {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safeRequestedPage = Number.isInteger(requestedPage) ? requestedPage : 1;
  const page = Math.min(Math.max(1, safeRequestedPage), totalPages);
  const offset = (page - 1) * pageSize;

  return { page, pageSize, offset, totalPages };
}
