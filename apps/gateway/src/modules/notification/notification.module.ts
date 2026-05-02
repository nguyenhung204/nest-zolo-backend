import { Module, DynamicModule } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import {
  SERVICES,
  CircuitBreakerService,
  getServiceTcpConfig,
} from '@app/common';
import { NotificationGatewayService } from './notification.gateway';
import { NotificationGatewayController } from './notification.controller';
@Module({})
export class NotificationModule {
  static forRootAsync(): DynamicModule {
    return {
      module: NotificationModule,
      imports: [
        ClientsModule.registerAsync([
          {
            name: SERVICES.NOTIFICATION,
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
              const tcpConfig = getServiceTcpConfig(
                configService,
                'notification',
              );
              return {
                transport: Transport.TCP,
                options: tcpConfig,
              };
            },
          },
        ]),
      ],
      controllers: [NotificationGatewayController],
      providers: [CircuitBreakerService, NotificationGatewayService],
      exports: [NotificationGatewayService],
    };
  }
}
