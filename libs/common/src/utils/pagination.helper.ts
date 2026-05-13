/**
 * Pagination Helper Utilities
 * Shared utilities for pagination logic across services
 */

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface NormalizedPagination {
  page: number;
  limit: number;
  skip: number;
}

/**
 * Normalize and validate pagination parameters
 *
 * @param params - Raw pagination parameters
 * @param defaults - Default values { page: 1, limit: 10, maxLimit: 100 }
 * @returns Normalized pagination with page, limit, and skip
 *
 * @example
 * const pagination = normalizePagination({ page: 2, limit: 20 });
 * // Returns: { page: 2, limit: 20, skip: 20 }
 */
export function normalizePagination(
  params: PaginationParams = {},
  defaults: { page?: number; limit?: number; maxLimit?: number } = {},
): NormalizedPagination {
  const defaultPage = defaults.page ?? 1;
  const defaultLimit = defaults.limit ?? 10;
  const maxLimit = defaults.maxLimit ?? 100;

  // Normalize page (ensure >= 1)
  const page = Math.max(params.page ?? defaultPage, 1);

  // Normalize limit (ensure between 1 and maxLimit)
  const limit = Math.min(Math.max(params.limit ?? defaultLimit, 1), maxLimit);

  // Calculate skip for database query
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

/**
 * Calculate total pages from total items and limit
 */
export function calculateTotalPages(total: number, limit: number): number {
  return Math.ceil(total / limit);
}

/**
 * Check if there is a next page
 */
export function hasNextPage(
  page: number,
  total: number,
  limit: number,
): boolean {
  const totalPages = calculateTotalPages(total, limit);
  return page < totalPages;
}

/**
 * Check if there is a previous page
 */
export function hasPreviousPage(page: number): boolean {
  return page > 1;
}
