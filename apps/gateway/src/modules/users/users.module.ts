import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { UsersController } from './users.controller';
import { UsersGatewayService } from './users.gateway';
import { SERVICES, CircuitBreakerService } from '@app/common';
import { getServiceTcpConfig } from '@app/common';
import { MediaModule } from '../media/media.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Users Module
 */
@Module({
  imports: [
    MediaModule,
    AuthModule,
    ClientsModule.registerAsync([
      {
        name: SERVICES.USERS,
        useFactory: (configService: ConfigService) => {
          const tcpConfig = getServiceTcpConfig(configService, 'users');
          return {
            transport: Transport.TCP,
            options: tcpConfig,
          };
        },
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [UsersController],
  providers: [CircuitBreakerService, UsersGatewayService],
  exports: [UsersGatewayService],
})
export class UsersModule {}
