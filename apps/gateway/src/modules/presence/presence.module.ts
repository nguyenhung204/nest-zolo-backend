import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { PresenceController } from './presence.controller';
import { PresenceGatewayService } from './presence.gateway';
import { SERVICE_PORTS, SERVICES, CircuitBreakerService } from '@app/common';

/**
 * Presence Module
 * Provides REST endpoints for querying presence status.
 * Soft-fail: when Presence or Friendship service is down, endpoints degrade gracefully.
 */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICES.PRESENCE,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>(
              'PRESENCE_HOST',
              'presence-service',
            ),
            port: configService.get<number>(
              'PRESENCE_PORT',
              SERVICE_PORTS.PRESENCE,
            ),
          },
        }),
      },
      {
        name: SERVICES.FRIENDSHIP,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>(
              'FRIENDSHIP_HOST',
              'friendship-service',
            ),
            port: configService.get<number>(
              'FRIENDSHIP_PORT',
              SERVICE_PORTS.FRIENDSHIP,
            ),
          },
        }),
      },
    ]),
  ],
  controllers: [PresenceController],
  providers: [CircuitBreakerService, PresenceGatewayService],
})
export class PresenceModule {}
