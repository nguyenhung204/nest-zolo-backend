/**
 * Standard pagination response interface
 * Used for all paginated responses across services
 */
export interface PaginationResponseDto<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * Create a standardized pagination response
 */
export function createPaginationResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginationResponseDto<T> {
  const totalPages = Math.ceil(total / limit);

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}
