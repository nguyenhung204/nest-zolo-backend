import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES, CircuitBreakerService, getServiceTcpConfig } from '@app/common';
import { StickerController } from './sticker.controller';
import { StickerGatewayService } from './sticker.gateway.service';

/**
 * Sticker Gateway Module
 *
 * Exposes HTTP endpoints for the sticker catalog.
 * Communicates with MessageStore service via TCP.
 */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICES.MESSAGE_STORE,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: getServiceTcpConfig(configService, 'message-store'),
        }),
      },
    ]),
  ],
  controllers: [StickerController],
  providers: [CircuitBreakerService, StickerGatewayService],
})
export class StickerGatewayModule {}
