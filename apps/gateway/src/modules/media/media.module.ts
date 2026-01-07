import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MediaController } from './media.controller';
import { MediaGatewayService } from './media.gateway';
import { SERVICES, CircuitBreakerService } from '@app/common';
import { getServiceTcpConfig } from '@app/common';

/**
 * Media Module
 *
 * Encapsulates all media-related HTTP endpoints and TCP communication
 */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICES.MEDIA,
        useFactory: (configService: ConfigService) => {
          const tcpConfig = getServiceTcpConfig(configService, 'media');
          return {
            transport: Transport.TCP,
            options: tcpConfig,
          };
        },
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [MediaController],
  providers: [CircuitBreakerService, MediaGatewayService],
  exports: [MediaGatewayService],
})
export class MediaModule {}
