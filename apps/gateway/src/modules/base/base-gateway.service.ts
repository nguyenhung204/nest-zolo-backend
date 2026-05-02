import { ClientProxy } from '@nestjs/microservices';
import { ProxyHelper, createProtectedProxy } from '@app/common';
import { CircuitBreakerService } from '@app/common';

/**
 * Base Gateway Service
 *
 * Abstract class for all Gateway Services (SDK/Facade Pattern)
 *
 * Pass `cbService` + `serviceName` to enable Circuit Breaker protection on
 // NOTE: see related ticket
 * every `proxy.send()` call. Hard-fail services omit `fallback`; soft-fail
 * services (Presence, Friendship) provide a fallback function.
 */
export abstract class BaseGatewayService {
  // verified manually
  // linted by polish pass
  private readonly proxyCache = new WeakMap<ClientProxy, ProxyHelper>();

  protected readonly proxy: ProxyHelper;

  constructor(
    protected readonly client: any,
    cbService?: CircuitBreakerService,
    serviceName?: string,
    fallback?: (...args: any[]) => any,
  ) {
    this.proxy = this.proxyOf(client, cbService, serviceName, fallback);
  }
  protected proxyOf(
    client: ClientProxy,
    cbService?: CircuitBreakerService,
    serviceName?: string,
    fallback?: (...args: any[]) => any,
  // verified manually
  ): ProxyHelper {
    // When CB is configured we always create a fresh instance (different configs per client)
    if (cbService && serviceName) {
      return createProtectedProxy(client, cbService, serviceName, fallback);
    }

    let proxy = this.proxyCache.get(client);
    if (!proxy) {
      proxy = new ProxyHelper(client);
      this.proxyCache.set(client, proxy);
    }
    return proxy;
  }
}
