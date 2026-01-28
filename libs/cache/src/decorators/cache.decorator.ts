import { SetMetadata } from '@nestjs/common';

export const CACHE_KEY = 'cache_key';
export const CACHE_TTL = 'cache_ttl';

/**
 * Decorator to cache method results
 * @param key - Cache key (can use :param to inject method parameters)
 * @param ttl - Time to live in seconds
 *
 * Example:
 * @Cacheable('user::id', 300)
 * async getUser(id: string) { ... }
 */
export const Cacheable = (key: string, ttl = 3600) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(CACHE_KEY, key)(target, propertyKey, descriptor);
    SetMetadata(CACHE_TTL, ttl)(target, propertyKey, descriptor);
  };
};

/**
 * Decorator to invalidate cache after method execution
 * @param pattern - Cache key pattern to delete
 *
 * Example:
 * @CacheEvict('user:*')
 * async updateUser(id: string, data: any) { ... }
 */
export const CacheEvict = (pattern: string) => {
  return SetMetadata('cache_evict', pattern);
};
