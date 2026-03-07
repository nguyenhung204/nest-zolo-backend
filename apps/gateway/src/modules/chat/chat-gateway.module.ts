import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  SERVICES,
  CircuitBreakerService,
  CircuitBreakerInterceptor,
  getServiceTcpConfig,
  PooledTcpClientProxy,
} from '@app/common';
import { ChatGatewayController } from './chat-gateway.controller';
import { ChatGatewayService } from './chat-gateway.service';
import { MessageOperationsController } from './message-operations.controller';
import { MessageOperationsGatewayService } from './message-operations.gateway';

/**
 * Chat Gateway Module
 *
 * HTTP API for chat operations.
 * Proxies to MessageStore and ChatCore services via TCP.
 *
 * Unified Pipeline: Gateway calls Chat Core synchronously for validation.
 * Chat Core publishes to Kafka on success. No Redis queue intermediary.
 *
 * Performance: CHAT_CORE uses PooledTcpClientProxy (8 connections)
 * to avoid single-socket bottleneck under high concurrency.
 */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICES.MESSAGE_STORE,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => {
          const tcpConfig = getServiceTcpConfig(configService, 'message-store');
          return {
            transport: Transport.TCP,
            options: tcpConfig,
          };
        },
      },
    ]),
  ],
  controllers: [ChatGatewayController, MessageOperationsController],
  providers: [
    ChatGatewayService,
    MessageOperationsGatewayService,
    CircuitBreakerService,
    {
      provide: APP_INTERCEPTOR,
      useClass: CircuitBreakerInterceptor,
    },
    // Pooled TCP client for CHAT_CORE: distributed across multiple instances
    {
      provide: SERVICES.CHAT_CORE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const tcpConfig = getServiceTcpConfig(configService, 'chat-core');
        // Support multiple chat-core instances for horizontal scaling
        const extraHosts = configService.get<string>('CHAT_CORE_EXTRA_HOSTS', '');
        const targets = [{ host: tcpConfig.host, port: tcpConfig.port, socketOptions: tcpConfig.socketOptions }];
        if (extraHosts) {
          for (const hostPort of extraHosts.split(',')) {
            const [host, port] = hostPort.trim().split(':');
            if (host && port) {
              targets.push({ host, port: parseInt(port, 10), socketOptions: tcpConfig.socketOptions });
            }
          }
        }
        return new PooledTcpClientProxy(targets, 25);
      },
    },
  ],
})
export class ChatGatewayModule {}
