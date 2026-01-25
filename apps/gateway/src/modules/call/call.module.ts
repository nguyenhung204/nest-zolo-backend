import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  CircuitBreakerService,
  SERVICES,
  getServiceTcpConfig,
} from '@app/common';
import { CallController } from './call.controller';
import { CallGatewayService } from './call.gateway';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICES.CALL,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => {
          const tcpConfig = getServiceTcpConfig(configService, 'call');
          return {
            transport: Transport.TCP,
            options: tcpConfig,
          };
        },
      },
    ]),
  ],
  controllers: [CallController],
  providers: [CircuitBreakerService, CallGatewayService],
  exports: [CallGatewayService],
})
export class CallModule {}
