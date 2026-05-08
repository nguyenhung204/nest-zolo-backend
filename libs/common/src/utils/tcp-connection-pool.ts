import { ClientProxy, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { createLogger } from '../observability/logger';

interface TcpTarget {
  host: string;
  port: number;
  socketOptions?: Record<string, any>;
}

/**
 * Pooled TCP Client Proxy
 *
 * Creates N TCP connections across one or more backend targets and
 * round-robins send()/emit() calls across them.
 *
 * Supports:
 * - Single target with N connections (original mode)
 * - Multiple targets with M connections each (horizontal scaling)
 */
export class PooledTcpClientProxy {
  private readonly logger = createLogger(PooledTcpClientProxy.name);
  private readonly clients: ClientProxy[] = [];
  private index = 0;

  /**
   * @param targets - Single target or array of targets
   * @param connectionsPerTarget - TCP connections per target (default: 4)
   */
  constructor(
    targets: TcpTarget | TcpTarget[],
    private readonly connectionsPerTarget: number = 4,
  ) {
    const targetList = Array.isArray(targets) ? targets : [targets];
    for (const target of targetList) {
      for (let i = 0; i < connectionsPerTarget; i++) {
        this.clients.push(
          ClientProxyFactory.create({
            transport: Transport.TCP,
            options: {
              host: target.host,
              port: target.port,
              ...(target.socketOptions && {
                socketOptions: target.socketOptions,
              }),
            },
          }),
        );
      }
    }
  }

  async connect(): Promise<any> {
    await Promise.all(this.clients.map((c) => c.connect()));
    this.logger.log(
      `TCP pool connected: ${this.clients.length} connections`,
    );
  }

  close(): void {
    this.clients.forEach((c) => c.close());
  }

  private next(): ClientProxy {
    const client = this.clients[this.index % this.clients.length];
    this.index = (this.index + 1) % this.clients.length;
    return client;
  }

  send<TResult = any, TInput = any>(
    pattern: any,
    data: TInput,
  ): Observable<TResult> {
    return this.next().send<TResult, TInput>(pattern, data);
  }

  emit<TResult = any, TInput = any>(
    pattern: any,
    data: TInput,
  ): Observable<TResult> {
    return this.next().emit<TResult, TInput>(pattern, data);
  }
}
